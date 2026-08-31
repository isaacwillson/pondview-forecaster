"""The assistant loop: a question in, an answer plus its full tool trace out.

The trace is the point. Judging this feature on its final prose alone hides the failures
that actually matter -- routing a what-if question to the forecast tool, inventing a
temperature nobody supplied, answering an out-of-scope question confidently. Those are
visible in which tools were called with which arguments, so run_chat returns that
alongside the text and the evals assert against it.

Runs still vary between calls even at temperature 0, which is allowed on the default
model but is not a guarantee of identical output -- and is rejected outright on the Opus
and Sonnet 5 comparison profiles. Treat a single eval run as a sample, not a verdict.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import anthropic

try:
    from api.main import chat_system_prompt
    from api import tools as tool_registry
except ImportError:  # pragma: no cover - only taken inside the Lambda image
    from main import chat_system_prompt
    import tools as tool_registry

logger = logging.getLogger(__name__)

# A question needing more than this many rounds of tool calls is one the assistant has
# lost the thread on; stop rather than burn tokens in a loop.
MAX_ROUNDS = 4

# PostHog AI observability. The project token that lets the server report model, latency,
# token counts, cost, errors, trace IDs and tool calls to PostHog. Optional: with it
# unset the assistant answers exactly as before and reports nothing, the same way /chat
# already degrades without an Anthropic key.
POSTHOG_ENV_VAR = "POSTHOG_PROJECT_API_KEY"

_posthog_client: Any = None
_posthog_ready = False


def posthog_client() -> Any:
    """The process-wide PostHog client, or None when the project token is unset.

    Built once and reused: a fresh client per request would start a new background sender
    each time. A missing token never breaks the assistant, but it is loud on a local run
    -- where it is almost always a mistake -- and silent in the Lambda, which the runtime
    marks with AWS_LAMBDA_FUNCTION_NAME.
    """
    global _posthog_client, _posthog_ready
    if _posthog_ready:
        return _posthog_client
    _posthog_ready = True

    token = os.environ.get(POSTHOG_ENV_VAR)
    if not token:
        if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
            logger.error(
                "%s variable required by PostHog is missing or un-configured, this "
                "causes events to be silently missed. This error stops appearing once "
                "%s is configured",
                POSTHOG_ENV_VAR,
                POSTHOG_ENV_VAR,
            )
        return None

    from posthog import Posthog

    _posthog_client = Posthog(
        token, host=os.environ.get("POSTHOG_HOST", "https://us.i.posthog.com")
    )
    return _posthog_client


@dataclass(frozen=True)
class ModelProfile:
    """Which request parameters a model actually accepts.

    These are not stylistic choices -- sending the wrong one is a 400. `effort` is an
    Opus-4.5-and-later feature and is REJECTED on Haiku 4.5 and Sonnet 4.5; the sampling
    parameters are the mirror image, accepted on Haiku 4.5 but rejected on Opus 5 and
    Sonnet 5. Adaptive thinking only exists from the 4.6 family on, so Haiku 4.5 either
    runs without thinking or uses the older explicit token budget.

    Keeping this as data is what lets the eval suite sweep models with --model instead of
    us editing request code every time we want to compare one against another.
    """

    name: str
    max_tokens: int
    effort: str | None = None
    thinking: dict | None = None
    temperature: float | None = None

    def request_kwargs(self) -> dict:
        """The model-specific half of a messages.create() call."""
        kwargs: dict = {"model": self.name, "max_tokens": self.max_tokens}
        if self.effort is not None:
            kwargs["output_config"] = {"effort": self.effort}
        if self.thinking is not None:
            kwargs["thinking"] = self.thinking
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        return kwargs


PROFILES: dict[str, ModelProfile] = {
    # The default: cheapest of the current models at $1/$5 per Mtok. No effort parameter
    # (400s here), no thinking -- this is routing and parameter extraction, and the eval
    # suite is how we find out whether that costs us accuracy. temperature=0 is allowed
    # on this model and trims run-to-run variance in the evals; it never guarantees
    # identical output, so --repeat still earns its keep.
    "claude-haiku-4-5": ModelProfile(
        name="claude-haiku-4-5", max_tokens=2000, temperature=0.0
    ),
    # Comparison targets. Both reject temperature and take effort instead; thinking is on
    # by default and shares the max_tokens budget with the reply, hence the headroom.
    "claude-sonnet-5": ModelProfile(
        name="claude-sonnet-5", max_tokens=4000, effort="low"
    ),
    "claude-opus-5": ModelProfile(name="claude-opus-5", max_tokens=4000, effort="low"),
}

DEFAULT_MODEL = "claude-haiku-4-5"


@dataclass
class ToolCall:
    name: str
    arguments: dict
    result: Any
    is_error: bool


@dataclass
class ChatResult:
    question: str
    text: str
    model: str = DEFAULT_MODEL
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str | None = None
    rounds: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    messages: list[dict] = field(default_factory=list)

    @property
    def tool_names(self) -> list[str]:
        return [call.name for call in self.tool_calls]


def normalize_history(history: list[dict] | None) -> list[dict]:
    """Client-supplied prior turns, reduced to plain alternating text.

    Only `role` and a text `content` survive. The tool_use / tool_result blocks from
    earlier turns are deliberately NOT reconstructed from client input: accepting them
    would let a caller fabricate a tool result and have the assistant quote invented
    numbers as though the model had produced them. Each request re-runs whatever tools
    it needs, so the only thing lost is a little repeated work.

    The API requires the first message to be `user`, so leading assistant turns are
    dropped rather than rejected -- a client replaying a greeting shouldn't 400.
    """
    turns = []
    for turn in history or []:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            turns.append({"role": role, "content": content})
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return turns


def run_chat(
    question: str,
    *,
    history: list[dict] | None = None,
    today: date | None = None,
    client: anthropic.Anthropic | None = None,
    model: str = DEFAULT_MODEL,
    distinct_id: str | None = None,
) -> ChatResult:
    """Answer one question, running tools until the model stops asking for them.

    `today` is threaded through to the system prompt's date table so evals can pin a
    date and assert on resolved ISO arguments instead of chasing a moving today.

    `distinct_id` links each generation to the person who asked, when the caller knows
    it. When PostHog is configured and the caller does not inject its own `client`, the
    Anthropic call is wrapped so PostHog records the model, latency, token counts, cost,
    errors and tool calls. The question and answer stay out of PostHog: privacy mode
    redacts them until the team approves that content for AI observability. An injected
    client -- the eval suite passes one -- is left untraced.
    """
    profile = PROFILES.get(model)
    if profile is None:
        raise ValueError(f"unknown model {model!r}; known: {sorted(PROFILES)}")

    ph = None
    if client is None:
        ph = posthog_client()
        if ph is not None:
            from posthog.ai.anthropic import Anthropic as TracedAnthropic

            client = TracedAnthropic(posthog_client=ph)
        else:
            client = anthropic.Anthropic()

    # One trace groups this question's generations and tool spans. Spans need a distinct
    # id too, so fall back to the trace id when the caller is anonymous -- that keeps the
    # generations and spans under one person node without inventing a lasting identity.
    trace_id = str(uuid.uuid4())
    event_distinct_id = distinct_id or trace_id

    # Constant for the whole trace, and empty when nothing is traced so the plain client
    # never sees a posthog_* kwarg it would reject. Privacy mode drops the question and
    # the answer; lift it once the team approves capturing chat content for observability.
    trace_kwargs: dict = {}
    if ph is not None:
        trace_kwargs = dict(
            posthog_distinct_id=event_distinct_id,
            posthog_trace_id=trace_id,
            posthog_privacy_mode=True,
            posthog_properties={"$ai_span_name": "pool-chat"},
        )

    stable, dated = chat_system_prompt(today)
    system = [
        # Breakpoint on the stable half only: the dated half rolls over daily and would
        # drag the whole prefix with it. See api/prompt.py.
        #
        # Inert on the default model: Haiku 4.5's minimum cacheable prefix is 4096 tokens
        # and the stable block is well under that, so this silently caches nothing rather
        # than erroring. Kept because the minimum is 512 on Opus 5 / 1024 on Sonnet 5,
        # where the same breakpoint does pay off.
        {"type": "text", "text": stable, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": dated},
    ]

    messages: list[dict] = normalize_history(history)
    messages.append({"role": "user", "content": question})
    result = ChatResult(question=question, text="", model=model, messages=messages)

    try:
        for round_index in range(MAX_ROUNDS):
            response = client.messages.create(
                system=system,
                tools=tool_registry.schemas(),
                messages=messages,
                **profile.request_kwargs(),
                **trace_kwargs,
            )
            result.rounds = round_index + 1
            result.stop_reason = response.stop_reason
            result.input_tokens += response.usage.input_tokens
            result.output_tokens += response.usage.output_tokens

            # A safety decline arrives as a normal 200 with an empty or partial body, so
            # check before reading content.
            if response.stop_reason == "refusal":
                result.text = "[the model declined to answer this request]"
                return result

            text = "".join(b.text for b in response.content if b.type == "text")
            if text:
                result.text = text

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                return result

            messages.append({"role": "assistant", "content": response.content})

            # All results for one assistant turn go back in a single user message --
            # splitting them trains the model out of calling tools in parallel.
            tool_results = []
            for block in tool_uses:
                arguments = dict(block.input)
                started = time.monotonic()
                output, is_error = tool_registry.run_tool(block.name, arguments)
                if ph is not None:
                    _capture_tool_span(
                        ph,
                        event_distinct_id,
                        trace_id,
                        block.name,
                        arguments,
                        output,
                        is_error,
                        time.monotonic() - started,
                    )
                result.tool_calls.append(
                    ToolCall(
                        name=block.name,
                        arguments=arguments,
                        result=output,
                        is_error=is_error,
                    )
                )
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": _as_text(output),
                        "is_error": is_error,
                    }
                )
            messages.append({"role": "user", "content": tool_results})

        result.text = result.text or (
            f"[gave up after {MAX_ROUNDS} rounds of tool calls without a final answer]"
        )
        return result
    finally:
        # Lambda freezes the container the moment the response returns, so the batched
        # events have to be on the wire before then; flush is a no-op when nothing traced.
        if ph is not None:
            ph.flush()


def _capture_tool_span(
    ph: Any,
    distinct_id: str,
    trace_id: str,
    name: str,
    arguments: dict,
    output: Any,
    is_error: bool,
    latency: float,
) -> None:
    """Record one tool call as an `$ai_span` under the trace.

    This is the tool-call quality signal the generation alone cannot show: which tool
    ran, with which arguments, to what result, how long it took, and whether it failed.
    The arguments are the model's own extraction, not the resident's question, so this
    stays clear of the content held back by privacy mode.
    """
    ph.capture(
        "$ai_span",
        distinct_id=distinct_id,
        properties={
            "$ai_trace_id": trace_id,
            "$ai_span_id": str(uuid.uuid4()),
            "$ai_span_name": name,
            "$ai_input_state": arguments,
            "$ai_output_state": output,
            "$ai_latency": latency,
            "$ai_is_error": is_error,
        },
    )


def _as_text(output: Any) -> str:
    """Tool results cross the wire as text; dicts go as compact JSON."""
    if isinstance(output, str):
        return output
    import json

    return json.dumps(output, separators=(",", ":"), default=str)
