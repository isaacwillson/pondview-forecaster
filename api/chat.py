"""The assistant loop: a question in, an answer plus its full tool trace out.

The trace is the point. Judging this feature on its final prose alone hides the failures
that actually matter -- routing a what-if question to the forecast tool, inventing a
temperature nobody supplied, answering an out-of-scope question confidently. Those are
visible in which tools were called with which arguments, so run_chat returns that
alongside the text and the evals assert against it.

Note there is no determinism knob: temperature and top_p are rejected on this model
family, so repeated runs vary. Treat a single eval run as a sample, not a verdict.
"""

from __future__ import annotations

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

MODEL = "claude-opus-5"

# Routing and parameter extraction, not deep reasoning: low effort keeps the answer
# quick and cheap. Thinking is on by default on this model and shares the max_tokens
# budget with the reply, so the cap has headroom rather than hugging the answer length.
EFFORT = "low"
MAX_TOKENS = 2000

# A question needing more than this many rounds of tool calls is one the assistant has
# lost the thread on; stop rather than burn tokens in a loop.
MAX_ROUNDS = 4


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
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str | None = None
    rounds: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    messages: list[dict] = field(default_factory=list)

    @property
    def tool_names(self) -> list[str]:
        return [call.name for call in self.tool_calls]


def run_chat(
    question: str,
    *,
    today: date | None = None,
    client: anthropic.Anthropic | None = None,
    model: str = MODEL,
    effort: str = EFFORT,
) -> ChatResult:
    """Answer one question, running tools until the model stops asking for them.

    `today` is threaded through to the system prompt's date table so evals can pin a
    date and assert on resolved ISO arguments instead of chasing a moving today.
    """
    client = client or anthropic.Anthropic()
    stable, dated = chat_system_prompt(today)
    system = [
        # Breakpoint on the stable half only: the dated half rolls over daily and would
        # drag the whole prefix with it. See api/prompt.py.
        {"type": "text", "text": stable, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": dated},
    ]

    messages: list[dict] = [{"role": "user", "content": question}]
    result = ChatResult(question=question, text="", messages=messages)

    for round_index in range(MAX_ROUNDS):
        response = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            system=system,
            tools=tool_registry.schemas(),
            output_config={"effort": effort},
            messages=messages,
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
            output, is_error = tool_registry.run_tool(block.name, dict(block.input))
            result.tool_calls.append(
                ToolCall(
                    name=block.name,
                    arguments=dict(block.input),
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


def _as_text(output: Any) -> str:
    """Tool results cross the wire as text; dicts go as compact JSON."""
    if isinstance(output, str):
        return output
    import json

    return json.dumps(output, separators=(",", ":"), default=str)
