"""Run the chat eval suite and report per-category pass rates.

    python -m evals.run_evals                  # every case, once
    python -m evals.run_evals --case saturday  # only cases whose id contains "saturday"
    python -m evals.run_evals --repeat 3       # three runs per case, to see variance
    python -m evals.run_evals --verbose        # print each answer and tool call

Needs credentials: export ANTHROPIC_API_KEY, or run `ant auth login`.

What it asserts, and why in this order: the tool trace is checked before the prose,
because the failures that matter here are structural. Routing a what-if question to the
forecast tool, inventing an argument nobody supplied, or answering an out-of-scope
question at all are all visible in `tool_calls` without reading a word of the reply.
Text matching is deliberately loose and used only where behaviour has no structural
signature -- a refusal has to be recognised by what it says.

There is no temperature control on this model family, so runs vary. --repeat exists so a
flake is distinguishable from a real regression; treat a single run as a sample.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import anthropic
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.chat import ChatResult, run_chat  # noqa: E402

CASES_PATH = Path(__file__).with_name("cases.yaml")

# Numbers written as times or dates are not arrival figures; strip them before the
# grounding check so "2 PM" and "August 15" don't read as invented quantities.
_TIME = re.compile(r"\b\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)\b", re.I)
_ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_ORDINAL = re.compile(r"\b\d{1,2}(?:st|nd|rd|th)\b", re.I)
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _numbers_in(value: Any, into: set[float]) -> set[float]:
    """Every numeric value anywhere in a nested tool result."""
    if isinstance(value, bool):
        return into
    if isinstance(value, (int, float)):
        into.add(float(value))
    elif isinstance(value, dict):
        for item in value.values():
            _numbers_in(item, into)
    elif isinstance(value, list):
        for item in value:
            _numbers_in(item, into)
    elif isinstance(value, str):
        for match in _NUMBER.findall(value):
            into.add(float(match))
    return into


def ungrounded_numbers(result: ChatResult, system_text: str) -> list[float]:
    """Numbers in the answer that trace to nothing the assistant was given.

    Allowed: anything in a tool result (and its rounded forms, since the assistant is
    told to round), anything in the question, and anything in the system prompt -- the
    horizon, the season, the training-set sizes are all legitimately quotable.
    """
    allowed: set[float] = set()
    for call in result.tool_calls:
        _numbers_in(call.result, allowed)
    _numbers_in(result.question, allowed)
    _numbers_in(system_text, allowed)
    for number in list(allowed):
        allowed.add(round(number))
        allowed.add(float(int(number)))

    text = _ISO_DATE.sub(" ", result.text)
    text = _TIME.sub(" ", text)
    text = _ORDINAL.sub(" ", text)

    loose = []
    for match in _NUMBER.findall(text):
        value = float(match)
        if not any(abs(value - ok) < 0.051 for ok in allowed):
            loose.append(value)
    return loose


def check(case: dict, result: ChatResult, system_text: str) -> list[str]:
    """Return a list of failure descriptions; empty means the case passed."""
    expect = case.get("expect", {})
    failures: list[str] = []
    text_lower = result.text.lower()

    if "tools" in expect:
        actual = result.tool_names
        if actual != list(expect["tools"]):
            failures.append(f"tools: expected {expect['tools']}, got {actual}")

    if "args" in expect:
        target = expect.get("tools", ["query_forecast"])[0] if expect.get("tools") else "query_forecast"
        call = next((c for c in result.tool_calls if c.name == target), None)
        if call is None:
            failures.append(f"args: {target} was never called")
        else:
            for key, want in expect["args"].items():
                got = call.arguments.get(key)
                if str(got) != str(want):
                    failures.append(f"args.{key}: expected {want!r}, got {got!r}")

    if "args_absent" in expect:
        call = next((c for c in result.tool_calls if c.name == "query_forecast"), None)
        if call is not None:
            for key in expect["args_absent"]:
                if key in call.arguments:
                    failures.append(
                        f"args.{key}: should have been omitted, got {call.arguments[key]!r}"
                    )

    if expect.get("no_numbers"):
        stripped = _ORDINAL.sub(" ", _TIME.sub(" ", _ISO_DATE.sub(" ", result.text)))
        found = _NUMBER.findall(stripped)
        if found:
            failures.append(f"no_numbers: answer contains {found}")

    for needle in expect.get("text_none", []):
        if needle.lower() in text_lower:
            failures.append(f"text_none: answer contains {needle!r}")

    if "text_any" in expect:
        if not any(n.lower() in text_lower for n in expect["text_any"]):
            failures.append(f"text_any: none of {expect['text_any']} appeared")

    if expect.get("grounded", True):
        loose = ungrounded_numbers(result, system_text)
        if loose:
            failures.append(f"grounded: numbers with no source in any tool result: {loose}")

    for call in result.tool_calls:
        if call.is_error:
            failures.append(f"tool error: {call.name} -> {call.result}")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", help="only run cases whose id contains this")
    parser.add_argument("--repeat", type=int, default=1, help="runs per case")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    spec = yaml.safe_load(CASES_PATH.read_text(encoding="utf-8"))
    today = date.fromisoformat(str(spec["today"]))
    cases = spec["cases"]
    if args.case:
        cases = [c for c in cases if args.case in c["id"]]
    if not cases:
        print("no cases matched")
        return 1

    from api.main import chat_system_prompt

    system_text = "\n\n".join(chat_system_prompt(today))

    # One client for the whole suite: reuses the connection pool, and surfaces a missing
    # credential as one readable line instead of a stack trace per case.
    try:
        client = anthropic.Anthropic()
    except Exception as exc:  # pragma: no cover - configuration, not logic
        print(f"could not create an Anthropic client: {exc}", file=sys.stderr)
        return 2

    by_category: dict[str, list[bool]] = defaultdict(list)
    failed_details: list[tuple[str, int, list[str]]] = []
    tool_call_counts: list[int] = []
    total_in = total_out = 0

    print(f"today pinned to {today} | {len(cases)} cases | {args.repeat} run(s) each\n")

    for case in cases:
        for run_index in range(args.repeat):
            try:
                result = run_chat(case["question"], today=today, client=client)
            except (anthropic.AuthenticationError, TypeError) as exc:
                print(
                    f"\nauthentication failed: {exc}\n\n"
                    "The eval suite calls the live API. Set ANTHROPIC_API_KEY in your "
                    "environment, or run `ant auth login`, then re-run.",
                    file=sys.stderr,
                )
                return 2
            failures = check(case, result, system_text)
            passed = not failures
            by_category[case["category"]].append(passed)
            tool_call_counts.append(len(result.tool_calls))
            total_in += result.input_tokens
            total_out += result.output_tokens

            mark = "PASS" if passed else "FAIL"
            suffix = f" (run {run_index + 1})" if args.repeat > 1 else ""
            print(f"  [{mark}] {case['id']}{suffix}")
            if not passed:
                failed_details.append((case["id"], run_index + 1, failures))
                for failure in failures:
                    print(f"         - {failure}")
            if args.verbose:
                for call in result.tool_calls:
                    print(f"         tool {call.name}({json.dumps(call.arguments)})")
                print(f"         answer: {result.text.strip()[:400]}")

    print("\n" + "=" * 64)
    print(f"{'category':<16}{'pass':>6}{'total':>7}{'rate':>8}")
    overall_pass = overall_total = 0
    for category in sorted(by_category):
        outcomes = by_category[category]
        passes = sum(outcomes)
        overall_pass += passes
        overall_total += len(outcomes)
        print(
            f"{category:<16}{passes:>6}{len(outcomes):>7}"
            f"{passes / len(outcomes):>7.0%}"
        )
    print("-" * 64)
    print(
        f"{'OVERALL':<16}{overall_pass:>6}{overall_total:>7}"
        f"{overall_pass / overall_total:>7.0%}"
    )
    print(
        f"\nmean tool calls/question {sum(tool_call_counts) / len(tool_call_counts):.2f}"
        f" | tokens in {total_in:,} out {total_out:,}"
    )

    if failed_details:
        print(f"\n{len(failed_details)} failing run(s):")
        for case_id, run_index, failures in failed_details:
            print(f"  {case_id} (run {run_index}): {failures[0]}")
    return 1 if failed_details else 0


if __name__ == "__main__":
    raise SystemExit(main())
