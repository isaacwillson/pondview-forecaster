"""Tool schemas the assistant sees, and the dispatch that runs them.

One registry, two consumers: the schema list goes to the API in `tools`, and the same
entries carry the Python callable used to execute a call. Adding a tool means adding one
TOOL entry -- there is no second place to remember.

Descriptions here are contracts, not steering. They say precisely what the tool returns
and when to reach for it; the behavioural rules (how to phrase an answer, what to refuse)
live in api/prompt.py, because a tool description is the wrong channel for them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

try:
    from api.main import MAX_QUERY_DAYS, query_forecast, simulate_conditions
except ImportError:  # pragma: no cover - only taken inside the Lambda image
    from main import MAX_QUERY_DAYS, query_forecast, simulate_conditions


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict
    run: Callable[..., Any]

    def schema(self) -> dict:
        """The wire form: what actually goes in the request's `tools` array."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


QUERY_FORECAST = Tool(
    name="query_forecast",
    description=(
        "Predicted family arrivals per hour at Pondview Pool for a real date or date "
        "range, already ranked. Call this for any question about an actual day or "
        "window -- today, tomorrow, a named weekday, this week, a specific date -- "
        "including when the question mentions weather, because the forecast for a real "
        "date already accounts for that day's predicted weather.\n\n"
        "Returns, per day: the basis (forecast / typical / closed), and that day's "
        "busiest and quietest hour. Across the whole window it returns the overall "
        "busiest and quietest hour, the mean, and a morning/afternoon/evening "
        "breakdown. Every hour carries a low-high band and a plain-language level "
        "(quiet, easygoing, steady, busy, packed).\n\n"
        "The ranking and averaging are done for you -- do not recompute them. "
        "Hour-by-hour detail is included only for windows of 2 days or fewer; for "
        "longer windows use the summary fields, or ask about one day to see every "
        "hour. Dates outside the pool season come back with basis 'closed' and no "
        "numbers, which is a real answer rather than a failure."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "start_date": {
                "type": "string",
                "description": (
                    "First day of the window, ISO YYYY-MM-DD. Resolve relative dates "
                    "such as 'tomorrow' or 'Saturday' against the date table in the "
                    "system prompt; never pass a relative phrase."
                ),
            },
            "end_date": {
                "type": "string",
                "description": (
                    "Last day of the window, ISO YYYY-MM-DD, inclusive. Omit for a "
                    f"single day. At most {MAX_QUERY_DAYS} days per call."
                ),
            },
            "part_of_day": {
                "type": "string",
                "enum": ["morning", "afternoon", "evening"],
                "description": (
                    "Restrict to one part of the day. Omit unless the question is "
                    "about a specific part -- omitting it also returns the "
                    "morning/afternoon/evening comparison."
                ),
            },
            "rank": {
                "type": "string",
                "enum": ["quietest", "busiest"],
                "description": (
                    "Add a ranked list of individual hours across the window, best "
                    "first. Use for 'when should I go', 'quietest hour', 'when is it "
                    "worst'."
                ),
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 20,
                "description": "How many ranked hours to return. Defaults to 5.",
            },
        },
        "required": ["start_date"],
        "additionalProperties": False,
    },
    run=query_forecast,
)


SIMULATE_CONDITIONS = Tool(
    name="simulate_conditions",
    description=(
        "Predicted family arrivals per hour under HYPOTHETICAL weather, to show how the "
        "model responds to conditions. Not tied to any date. Call this only when the "
        "person supplies imagined conditions ('if it were 90 and sunny', 'on a rainy "
        "day') or asks to compare two sets of conditions. For a real date -- today, "
        "Saturday, next week -- use query_forecast instead, even if the question "
        "mentions weather, because that forecast already includes the real weather.\n\n"
        "Pass two scenarios to compare them: the result then includes an hour-by-hour "
        "difference and which one is busier. This is the right shape for 'does rain "
        "keep people away' and 'what if it were 75 instead of 85'.\n\n"
        "Do NOT invent conditions the person did not mention. Leave them out and the "
        "tool fills them from the season's averages and reports exactly what it "
        "assumed in `defaults_applied` -- state those assumptions in your answer. It "
        "also reports `extrapolating` when a temperature falls outside the range the "
        "model was actually trained on."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "scenarios": {
                "type": "array",
                "minItems": 1,
                "maxItems": 2,
                "description": (
                    "One scenario to describe it, or two to compare them. When "
                    "comparing, vary only what the question varies and leave the rest "
                    "out so both sides share the same assumptions."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "temperature": {
                            "type": "number",
                            "description": (
                                "Air temperature in Fahrenheit. Omit if the person did "
                                "not give one -- do not guess."
                            ),
                        },
                        "is_weekend": {
                            "type": "boolean",
                            "description": (
                                "True for a weekend day. Omit if unstated; the tool "
                                "assumes a weekday and says so."
                            ),
                        },
                        "rain": {
                            "type": "boolean",
                            "description": (
                                "True for a rainy day. Omit if unstated; the tool "
                                "assumes dry and says so."
                            ),
                        },
                    },
                    "additionalProperties": False,
                },
            }
        },
        "required": ["scenarios"],
        "additionalProperties": False,
    },
    run=simulate_conditions,
)


TOOLS: tuple[Tool, ...] = (QUERY_FORECAST, SIMULATE_CONDITIONS)

BY_NAME: dict[str, Tool] = {tool.name: tool for tool in TOOLS}


def schemas() -> list[dict]:
    """The `tools` array for the Messages API request."""
    return [tool.schema() for tool in TOOLS]


def run_tool(name: str, arguments: dict) -> tuple[Any, bool]:
    """Execute a tool call. Returns (result, is_error).

    Errors are returned rather than raised: a bad argument is something the model can
    see and correct on the next turn, so it goes back as an is_error tool result instead
    of collapsing the conversation. Only genuinely unexpected failures are surfaced as
    error text too -- there is nothing useful the assistant could do with a traceback.
    """
    tool = BY_NAME.get(name)
    if tool is None:
        return f"No tool named {name!r}. Available: {sorted(BY_NAME)}.", True
    try:
        return tool.run(**arguments), False
    except ValueError as exc:
        return f"Invalid arguments for {name}: {exc}", True
    except TypeError as exc:
        return f"Wrong arguments for {name}: {exc}", True
    except Exception as exc:  # pragma: no cover - defensive
        return f"{name} failed: {type(exc).__name__}: {exc}", True
