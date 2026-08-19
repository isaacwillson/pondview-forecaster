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

Runs vary even at temperature 0 (allowed on the default model, rejected on the Opus and
Sonnet 5 profiles), so --repeat exists to distinguish a flake from a real regression;
treat a single run as a sample. --model sweeps the same suite across models, which is
the honest way to answer "does the cheap model hold up on this workload".
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

from api.chat import DEFAULT_MODEL, PROFILES, ChatResult, run_chat  # noqa: E402
from api.main import pinned_today  # noqa: E402

CASES_PATH = Path(__file__).with_name("cases.yaml")

# Numbers written as times or dates are not arrival figures; strip them before the
# grounding check so "2 PM" and "August 15" don't read as invented quantities.
_TIME = re.compile(r"\b\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)\b", re.I)
_ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_ORDINAL = re.compile(r"\b\d{1,2}(?:st|nd|rd|th)\b", re.I)
# Assistants write dates as prose ("September 2", "Aug 31"), not ISO. Without this the
# day number reads as an invented arrival figure -- which is exactly what it did on the
# first real run of the three-weeks-out case.
_MONTH = (
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
)
_PROSE_DATE = re.compile(rf"\b{_MONTH}\.?\s+\d{{1,2}}\b|\b\d{{1,2}}\s+{_MONTH}\b", re.I)
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _strip_non_quantities(text: str) -> str:
    """Remove everything numeric that is a date, time or year rather than a quantity."""
    for pattern in (_ISO_DATE, _PROSE_DATE, _TIME, _ORDINAL, _YEAR):
        text = pattern.sub(" ", text)
    return text


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
        # Prose carries direction in words, not signs: a tool result of -74 is quoted as
        # "a 74% drop". Accept the magnitude, or every signed field reads as invented.
        allowed.add(abs(number))
        allowed.add(round(abs(number)))

    text = _strip_non_quantities(result.text)

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

    if "args_window_includes" in expect:
        call = next((c for c in result.tool_calls if c.name == "query_forecast"), None)
        if call is None:
            failures.append("args_window_includes: query_forecast was never called")
        else:
            wanted = date.fromisoformat(expect["args_window_includes"])
            start = date.fromisoformat(call.arguments["start_date"])
            end_raw = call.arguments.get("end_date")
            end = date.fromisoformat(end_raw) if end_raw else start
            if not start <= wanted <= end:
                failures.append(
                    f"args_window_includes: {wanted} not covered by {start}..{end}"
                )

    if "scenario_args" in expect:
        call = next((c for c in result.tool_calls if c.name == "simulate_conditions"), None)
        if call is None:
            failures.append("scenario_args: simulate_conditions was never called")
        else:
            got = call.arguments.get("scenarios", [])
            want = expect["scenario_args"]
            if len(got) != len(want):
                failures.append(
                    f"scenario_args: expected {len(want)} scenario(s), got {len(got)}"
                )
            else:
                # Order-insensitive: "75 instead of 85" does not fix which comes first.
                unmatched = list(got)
                for wanted in want:
                    match = next(
                        (g for g in unmatched
                         if all(g.get(k) == v for k, v in wanted.items())),
                        None,
                    )
                    if match is None:
                        failures.append(f"scenario_args: no scenario matching {wanted} in {got}")
                    else:
                        unmatched.remove(match)

    if expect.get("no_invented_temperature"):
        for call in result.tool_calls:
            if call.name != "simulate_conditions":
                continue
            for index, scenario in enumerate(call.arguments.get("scenarios", [])):
                if "temperature" in scenario:
                    failures.append(
                        f"no_invented_temperature: scenario {index} passed "
                        f"temperature={scenario['temperature']} which the question "
                        "never supplied"
                    )

    if expect.get("args_multi_day"):
        call = next((c for c in result.tool_calls if c.name == "query_forecast"), None)
        if call is None:
            failures.append("args_multi_day: query_forecast was never called")
        elif not call.arguments.get("end_date"):
            failures.append(
                "args_multi_day: queried a single day; an undated question should span "
                "several days"
            )
        elif call.arguments["end_date"] <= call.arguments["start_date"]:
            failures.append(
                f"args_multi_day: end_date {call.arguments['end_date']} does not extend "
                f"past start_date {call.arguments['start_date']}"
            )

    if expect.get("no_fractional_counts"):
        fractional = re.findall(r"\d+\.\d+", _strip_non_quantities(result.text))
        if fractional:
            failures.append(
                f"no_fractional_counts: families are whole, but the answer quotes "
                f"{fractional}"
            )

    if expect.get("no_numbers"):
        found = _NUMBER.findall(_strip_non_quantities(result.text))
        if found:
            failures.append(f"no_numbers: answer contains {found}")

    for needle in expect.get("text_none", []):
        if needle.lower() in text_lower:
            failures.append(f"text_none: answer contains {needle!r}")

    if "text_any" in expect:
        if not any(n.lower() in text_lower for n in expect["text_any"]):
            failures.append(f"text_any: none of {expect['text_any']} appeared")

    for needle in expect.get("text_all", []):
        if needle.lower() not in text_lower:
            failures.append(f"text_all: answer is missing {needle!r}")

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
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        choices=sorted(PROFILES),
        help="which model to evaluate (default: %(default)s)",
    )
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

    print(
        f"model {args.model} | today pinned to {today} | {len(cases)} cases | "
        f"{args.repeat} run(s) each\n"
    )

    for case in cases:
        for run_index in range(args.repeat):
            try:
                # Pin the date for the TOOLS as well as the prompt. Without this the
                # date table said one thing and basis_for() asked the real calendar,
                # so a case's expected basis drifted as real days passed.
                with pinned_today(today):
                    result = run_chat(
                        case["question"],
                        history=case.get("history"),
                        today=today,
                        client=client,
                        model=args.model,
                    )
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
    # Per-1M rates, for the cost-per-question line that makes a model comparison concrete.
    rates = {
        "claude-haiku-4-5": (1.00, 5.00),
        "claude-sonnet-5": (3.00, 15.00),
        "claude-opus-5": (5.00, 25.00),
    }
    rate_in, rate_out = rates[args.model]
    cost = (total_in * rate_in + total_out * rate_out) / 1_000_000
    print(
        f"\nmodel {args.model} | mean tool calls/question "
        f"{sum(tool_call_counts) / len(tool_call_counts):.2f}"
        f" | tokens in {total_in:,} out {total_out:,}"
        f" | ${cost:.4f} total, ${cost / overall_total:.5f}/question"
    )

    if failed_details:
        print(f"\n{len(failed_details)} failing run(s):")
        for case_id, run_index, failures in failed_details:
            print(f"  {case_id} (run {run_index}): {failures[0]}")
    return 1 if failed_details else 0


if __name__ == "__main__":
    raise SystemExit(main())
