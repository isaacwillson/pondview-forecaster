"""Turn a run of /forecast payloads into an answer-shaped summary for the assistant.

The design rule behind this module: the model's job is turning vague phrasing into a
time window and a ranking criterion, NOT doing arithmetic. So "the quietest hour this
week" is resolved here, in Python, over exact numbers -- the model reads one already-
ranked answer instead of eyeballing seventy banded values and hoping it picks the min.

It is deliberately pure. It takes payloads that GET /forecast already produced rather
than importing main, which keeps it free of the model pickle and the network, makes it
testable against fabricated days, and leaves no import cycle when /chat wires it up.
"""

from __future__ import annotations

from datetime import date

try:
    from api.prompt import hour12
except ImportError:  # pragma: no cover - only taken inside the Lambda image
    from prompt import hour12

# Above this many days the per-hour arrays are dropped and only the per-day and overall
# summaries survive. A fortnight of open hours is ~150 rows; spending thousands of tokens
# on them to answer "when is it quietest" is exactly the arithmetic this module removes.
HOURLY_DETAIL_DAYS = 2

# Hour buckets for "is it busier in the morning or the evening". Ends are open-ended so
# the buckets stay correct for both months' posted hours without special-casing them.
PARTS_OF_DAY: dict[str, range] = {
    "morning": range(0, 12),
    "afternoon": range(12, 17),
    "evening": range(17, 24),
}

# Mirrors web/lib/busyness.ts so the chat and the web UI call the same hour the same
# thing. If you retune one, retune the other -- these thresholds are the pair.
_LEVELS: list[tuple[float, int, str]] = [
    (2.5, 0, "quiet"),
    (5.0, 1, "easygoing"),
    (8.5, 2, "steady"),
    (12.0, 3, "busy"),
    (float("inf"), 4, "packed"),
]


def level_for(predicted: float) -> tuple[int, str]:
    """Arrivals/hour -> (level, plain-language label), same cuts as the web UI."""
    for ceiling, level, label in _LEVELS:
        if predicted < ceiling:
            return level, label
    return _LEVELS[-1][1], _LEVELS[-1][2]


def _slot(day: dict, prediction: dict) -> dict:
    """One hour, flattened with enough context to be quoted on its own.

    Carries its date and weekday because the ranked lists mix days together -- a bare
    hour out of `overall` would otherwise be unattributable.
    """
    day_date = date.fromisoformat(day["day"])
    level, label = level_for(prediction["predicted"])
    return {
        "date": day["day"],
        "weekday": day_date.strftime("%A"),
        "hour": prediction["hour"],
        "time": hour12(prediction["hour"]),
        "predicted": prediction["predicted"],
        "low": prediction["low"],
        "high": prediction["high"],
        "level": level,
        "label": label,
    }


def _mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 1)


# Below this gap in mean arrivals per hour, two scenarios are reported as materially the
# same rather than one being "busier". The model's own leave-one-day-out error is about
# 2.9 arrivals/hour, so calling a 0.4 difference a difference would be false precision.
SAME_WITHIN = 0.5


def describe_conditions(conditions: dict) -> str:
    """"a rainy weekend at 90F" -- a label a person can check against what they asked."""
    weather = "rainy" if conditions["precipitation"] else "dry"
    day = "weekend" if conditions["is_weekend"] else "weekday"
    return f"a {weather} {day} at {conditions['temperature']:g}F"


def summarize_scenarios(payloads: list[dict], defaults: list[dict]) -> dict:
    """Summarize one or two /whatif payloads, comparing them when there are two.

    `defaults[i]` records which conditions the CALLER never supplied and the tool chose,
    and is carried through to the result untouched. That is the whole mechanism behind
    "never invent a temperature the user didn't give": the assistant cannot quietly
    adopt a number, because the tool reports every value it filled in and the system
    prompt requires those to be stated.
    """
    scenarios = []
    for payload, applied in zip(payloads, defaults):
        slots = [
            {
                "hour": p["hour"],
                "time": hour12(p["hour"]),
                "predicted": p["predicted"],
                "low": p["low"],
                "high": p["high"],
                **dict(zip(("level", "label"), level_for(p["predicted"]))),
            }
            for p in payload["predictions"]
        ]
        scenarios.append(
            {
                "description": describe_conditions(payload["conditions"]),
                "conditions": {
                    "temperature": payload["conditions"]["temperature"],
                    "is_weekend": payload["conditions"]["is_weekend"],
                    "rain": payload["conditions"]["precipitation"],
                },
                "defaults_applied": applied,
                "extrapolating": payload["extrapolating"],
                "weather_fed_to_model": payload["conditions"]["assumed"],
                "busiest": max(slots, key=lambda s: s["predicted"]),
                "quietest": min(slots, key=lambda s: s["predicted"]),
                "mean": _mean([s["predicted"] for s in slots]),
                "hours": slots,
            }
        )

    summary: dict = {
        "unit": payloads[0]["unit"],
        "observed_temperature_range": payloads[0]["temp_range"],
        "scenarios": scenarios,
        "notes": [],
    }

    for scenario in scenarios:
        if scenario["defaults_applied"]:
            summary["notes"].append(
                f"For {scenario['description']}, these were not specified and were "
                f"assumed: {scenario['defaults_applied']}. Say so in your answer."
            )
        if scenario["extrapolating"]:
            summary["notes"].append(
                f"{scenario['description']} is outside the observed temperature range "
                f"({payloads[0]['temp_range']['min']}-{payloads[0]['temp_range']['max']}F); "
                f"the model is extrapolating and the answer should say so."
            )

    if len(scenarios) == 2:
        first, second = scenarios
        difference = round(second["mean"] - first["mean"], 1)
        if abs(difference) < SAME_WITHIN:
            verdict = "about the same"
        else:
            busier = second if difference > 0 else first
            verdict = f"{busier['description']} is busier"
        summary["comparison"] = {
            "verdict": verdict,
            "mean_difference": difference,
            # Computed here because the assistant will otherwise work it out itself:
            # the first real eval run had it divide 1.4 by 5.3 and report "roughly a 75%
            # drop", which is arithmetic this module exists to keep out of the model.
            "percent_change": (
                round(difference / first["mean"] * 100)
                if first["mean"] > 0
                else None
            ),
            "per_hour": [
                {
                    "time": a["time"],
                    "first": a["predicted"],
                    "second": b["predicted"],
                    "difference": round(b["predicted"] - a["predicted"], 1),
                }
                for a, b in zip(first["hours"], second["hours"])
            ],
        }
    return summary


def summarize(
    payloads: list[dict],
    *,
    part_of_day: str | None = None,
    rank: str | None = None,
    limit: int = 5,
) -> dict:
    """Summarize /forecast payloads into per-day, overall, and ranked views.

    `payloads` are day payloads in the order they should be reported. `part_of_day`
    restricts which hours count; `rank` ("quietest"/"busiest") adds a cross-day ranked
    list of `limit` hours. Raises ValueError on bad arguments -- the chat layer turns
    that into an is_error tool result so the model can correct itself.
    """
    if part_of_day is not None and part_of_day not in PARTS_OF_DAY:
        raise ValueError(
            f"part_of_day must be one of {sorted(PARTS_OF_DAY)}, got {part_of_day!r}"
        )
    if rank is not None and rank not in ("quietest", "busiest"):
        raise ValueError(f"rank must be 'quietest' or 'busiest', got {rank!r}")
    if not 1 <= limit <= 20:
        raise ValueError(f"limit must be between 1 and 20, got {limit}")

    wanted_hours = PARTS_OF_DAY.get(part_of_day)
    detailed = len(payloads) <= HOURLY_DETAIL_DAYS

    days: list[dict] = []
    all_slots: list[dict] = []
    closed_dates: list[str] = []

    for payload in payloads:
        day_date = date.fromisoformat(payload["day"])
        entry = {
            "date": payload["day"],
            "weekday": day_date.strftime("%A"),
            "is_weekend": payload["is_weekend"],
            "basis": payload["basis"],
        }

        if payload["basis"] == "closed":
            entry["message"] = payload["message"]
            closed_dates.append(payload["day"])
            days.append(entry)
            continue

        slots = [
            _slot(payload, p)
            for p in payload.get("predictions", [])
            if wanted_hours is None or p["hour"] in wanted_hours
        ]
        if not slots:
            # A real state, not an error: e.g. asking about the evening in a month whose
            # posted hours end before it. Say so rather than returning an empty day.
            entry["message"] = (
                f"The pool has no {part_of_day} hours on this date; "
                f"it is open {hour12(payload['open_hours'][0])} to "
                f"{hour12(payload['open_hours'][-1] + 1)}."
            )
            days.append(entry)
            continue

        entry["busiest"] = max(slots, key=lambda s: s["predicted"])
        entry["quietest"] = min(slots, key=lambda s: s["predicted"])
        if detailed:
            entry["hours"] = slots
        all_slots.extend(slots)
        days.append(entry)

    summary: dict = {
        "window": {
            "start": payloads[0]["day"],
            "end": payloads[-1]["day"],
            "days": len(payloads),
        },
        "unit": payloads[0]["unit"],
        # Echoed back so the assistant can state what was actually asked of the model
        # rather than what it believes it asked.
        "filters": {"part_of_day": part_of_day, "rank": rank},
        "days": days,
        "notes": [],
    }

    if closed_dates:
        summary["notes"].append(
            f"{len(closed_dates)} of {len(payloads)} dates are outside the pool season "
            f"and have no numbers: {', '.join(closed_dates)}."
        )

    if not all_slots:
        summary["overall"] = None
        summary["notes"].append(
            "No open hours matched this window, so there is nothing to rank."
        )
        return summary

    summary["overall"] = {
        "busiest": max(all_slots, key=lambda s: s["predicted"]),
        "quietest": min(all_slots, key=lambda s: s["predicted"]),
        "mean": _mean([s["predicted"] for s in all_slots]),
        "hours_counted": len(all_slots),
    }

    if rank is not None:
        ordered = sorted(
            all_slots,
            key=lambda s: s["predicted"],
            reverse=(rank == "busiest"),
        )
        summary["ranked"] = ordered[:limit]

    # Only useful when nothing has already been filtered down to one part of the day.
    if part_of_day is None:
        by_part: dict[str, dict] = {}
        for name, hours in PARTS_OF_DAY.items():
            part_slots = [s for s in all_slots if s["hour"] in hours]
            if not part_slots:
                continue
            by_part[name] = {
                "hours": f"{hour12(min(s['hour'] for s in part_slots))}"
                f"-{hour12(max(s['hour'] for s in part_slots))}",
                "mean": _mean([s["predicted"] for s in part_slots]),
                "busiest": max(part_slots, key=lambda s: s["predicted"]),
                "hours_counted": len(part_slots),
            }
        summary["by_part_of_day"] = by_part

    if not detailed:
        summary["notes"].append(
            f"Hour-by-hour detail is omitted for windows longer than "
            f"{HOURLY_DETAIL_DAYS} days; ask about a specific day to see every hour."
        )

    return summary
