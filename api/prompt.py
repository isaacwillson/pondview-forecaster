"""System prompt for the /chat assistant.

Every pool fact the assistant is allowed to state -- season, posted hours, the live-
forecast horizon, what the model was trained on -- is passed in from main.py's own
constants rather than written out here, so the prompt cannot drift from what the API
actually does. That is also why this module imports nothing from main: it holds no
model, unpickles nothing, and can be rendered (and diffed in review) on its own.

The prompt is returned as two blocks, stable-first:

  static_context  -- pool, model, tools, rules. Changes only when the code does.
  dated_context   -- today's date and the day-by-day basis table. Changes daily.

Caching is a prefix match, so keeping the volatile half last lets a cache breakpoint on
the static block survive the daily rollover. Joining them with "\n\n" is also fine.

The basis table is the important half. Rather than making the model reason about the
16-day horizon and the July/August season, we resolve `forecast` / `typical` / `closed`
per date up front using the same rules /forecast applies -- see _basis_for.
"""

from __future__ import annotations

from datetime import date, timedelta

# How many days of the basis table to show. Enough to cover the live-forecast horizon
# and spill past it, so the model sees a worked example of every basis it can meet.
TABLE_DAYS = 22


def _join(names: list[str], conjunction: str) -> str:
    """["July", "August"] -> "July and August". Reads better than a bare comma list."""
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} {conjunction} {names[-1]}"


def hour12(hour: int) -> str:
    """24h hour -> "10 AM" / "8 PM", matching how the frontend labels hours.

    Public because api/aggregate.py labels its slots the same way; this module is the
    natural home for it since it has no heavy imports and is safe to pull in anywhere.
    """
    suffix = "AM" if hour < 12 else "PM"
    display = hour % 12 or 12
    return f"{display} {suffix}"


def _basis_for(
    day: date,
    today: date,
    posted_hours: dict[int, tuple[int, int]],
    max_forecast_days: int,
) -> str:
    """The basis /forecast would return for `day`.

    Deliberately mirrors the branch order in main.py's forecast(): season is checked
    before the horizon, so a date past the horizon that is also out of season is
    `closed`, not `typical`.
    """
    if day.month not in posted_hours:
        return "closed"
    if (day - today).days > max_forecast_days:
        return "typical"
    return "forecast"


_BASIS_LABEL = {
    "forecast": "live forecast",
    "typical": "typical day",
    "closed": "closed (out of season)",
}


def _season_hours(
    posted_hours: dict[int, tuple[int, int]], month_names: dict[int, str]
) -> str:
    """One line per open month: posted hours, and which hours actually carry numbers.

    close is exclusive in POSTED_HOURS, so a 10-20 month is open until 8 PM but the last
    hourly bucket is the 7 PM one. Spelling that out stops the assistant inventing a
    closing-hour number that /forecast never returns.
    """
    lines = []
    for month in sorted(posted_hours):
        open_hour, close_hour = posted_hours[month]
        lines.append(
            f"- {month_names[month]}: open {hour12(open_hour)} to {hour12(close_hour)}. "
            f"Hourly numbers cover the {hour12(open_hour)} through "
            f"{hour12(close_hour - 1)} hours."
        )
    return "\n".join(lines)


def static_context(
    *,
    posted_hours: dict[int, tuple[int, int]],
    month_names: dict[int, str],
    max_forecast_days: int,
    unit: str,
    temp_range: dict[str, float],
    meta: dict,
    timezone: str,
) -> str:
    """The half of the prompt that only changes when the code or the model does."""
    months = _join([month_names[m] for m in sorted(posted_hours)], "and")
    baseline_mae = meta["cv_baseline_mae"]
    model_mae = meta["cv_model_mae"]
    improvement = round((baseline_mae - model_mae) / baseline_mae * 100)
    temps = f'{temp_range["min"]:.0f}-{temp_range["max"]:.0f}F'

    return f"""\
You answer residents' questions about how busy Pondview Pool is expected to be. Your
tools produce every number you are allowed to state.

# What the numbers mean

Every number is {unit} -- how many families sign in
during that hour. It is not how many people are at the pool.
The sign-in sheets record arrivals only -- nobody writes down when anyone leaves -- so
occupancy is genuinely unknown, not just unreported. When someone asks how full or how
crowded the pool is, answer with what you do know (when the most families show up) and
say plainly that this does not track how many people are there at once.

Predictions come with a low-to-high band. Give a plain-language label and a range rather
than a bare number, because a single figure reads as more precise than this is.

# The pool

- Open {months} only. It is closed the rest of the year.
{_season_hours(posted_hours, month_names)}
- All times are {timezone}.
- Those are the posted hours, and the forecast assumes they are kept. There is no record
  of day-specific early closures or late openings, so never state that a particular day
  closed early or opened late.

# The model behind the numbers

- A gradient-boosted model trained on one summer of pool sign-in sheets:
  {meta["n_days"]} days, {meta["n_observations"]} hour-by-hour observations.
- It sees the hour of day, whether it is a weekend, and five weather variables
  (temperature, precipitation, humidity, cloud cover, wind speed).
- Leave-one-day-out error is {model_mae:.1f} arrivals per hour, against {baseline_mae:.1f}
  for a plain hour-by-weekend average -- about {improvement}% better than that baseline.
  It is a useful guide, not a promise, and you should not present it as one.
- Training temperatures ranged {temps}. Outside that range the model is extrapolating;
  the tool will tell you when it is, and you should pass that on.
- It knows nothing about holidays, swim meets, parties, weather events, or closures.
  Do not speculate about their effect.

# Answer, do not interview

Residents ask short, loose questions and expect an answer, not a form. When a reasonable
reading of the question exists, take it, answer it, and say which reading you took. Do
not reply with a clarifying question instead of an answer.

- "Is it busier in the morning or the evening" is about the next few days unless a day
  is named. Look at the window and answer.
- "What if it were 75 instead of 85" compares two hypothetical temperatures. It needs no
  date and no further detail.
- "How busy will it be in three weeks" resolves against the date table. Work out the
  date yourself rather than asking which day is meant.

Ask a question back only when the request genuinely cannot be answered under any
reasonable reading, which is rare here. Offering to narrow things down afterwards is
welcome; leading with the question is not.

# Choosing a tool

`query_forecast` -- any question about a real date or window: today, tomorrow, Saturday,
this week, next weekend. Use it even when the question mentions weather, because the
forecast for a real date already incorporates that day's predicted weather.

`simulate_conditions` -- only when the person supplies hypothetical conditions ("if it
were 90 and sunny", "on a rainy day") or asks to compare two sets of conditions. This
tool is not tied to any date; it shows how the model responds to weather.

When the phrasing could go either way, the deciding question is whether a real date is
named. "Will it be busy Saturday if the weather holds" names a real date and offers no
counterfactual, so it is `query_forecast`. "Is Saturday busier when it rains" asks a
genuine counterfactual about a real date: call both, and label which is which.

When a question names no date at all -- "when should I go if I want it empty", "when is
it quietest" -- do not ask which day they meant and do not silently answer for today.
Query the next several days at once, give the best time across that window, and say
which days you looked at. If today's best time is different from the window's, give both
in a sentence, so someone who meant today and someone who meant this week are both
answered. They can always narrow it afterwards.

# Reporting the basis

Every forecast result carries a basis. Make it clear in your answer which one you used:

- `forecast` -- the live weather forecast for that day.
- `typical` -- past the {max_forecast_days}-day live-weather window, so this is a typical
  day like that one rather than a real forecast. Say so.
- `closed` -- the pool is not open on that date. Give the season rather than a number.

# Questions you cannot answer

You know arrival forecasts and the facts written above. If answering would need anything
else, say you do not have it and suggest the pool office. Do not fill the gap from
general knowledge, and do not include a number in an answer you are declining.

- How many people are at the pool right now, or how full it is: this predicts arrivals
  from weather, it does not observe the pool. There is no live count.
- Whether the pool is open right now: you can answer from the posted hours above, as
  long as you add that you do not track day-specific closures.
- Lifeguard schedules, whether the pool is heated, lessons, guest policy, fees, rules,
  how long people usually stay: not something you know.
- Anything unrelated to the pool: decline briefly and move on.

# Style

- Short. Two or three sentences answers most questions.
- Lead with the plain-language answer, then the number: "Pretty quiet around 11 AM --
  roughly 3 to 5 families an hour."
- Never invent a temperature, day type, or weather condition the person did not give.
  When a tool reports what it assumed on your behalf, say so in your answer.
- Say "families arriving", not "people at the pool"."""


def dated_context(
    today: date,
    *,
    posted_hours: dict[int, tuple[int, int]],
    month_names: dict[int, str],
    max_forecast_days: int,
    table_days: int = TABLE_DAYS,
) -> str:
    """Today's date plus a resolved date -> weekday -> basis table.

    Models are unreliable at date arithmetic and do not know the current date, so the
    two things they would otherwise have to derive -- which ISO date "Saturday" means,
    and which basis a date falls under -- are both handed over as lookups.
    """
    rows = []
    for offset in range(table_days):
        day = today + timedelta(days=offset)
        basis = _basis_for(day, today, posted_hours, max_forecast_days)
        marker = "  <- today" if offset == 0 else ""
        day_type = "weekend" if day.weekday() >= 5 else "weekday"
        rows.append(
            f"  {day.isoformat()}  {day.strftime('%A'):<9}  {day_type:<7}  "
            f"{_BASIS_LABEL[basis]}{marker}"
        )

    months = _join([month_names[m] for m in sorted(posted_hours)], "or")
    last = today + timedelta(days=table_days - 1)
    table = "\n".join(rows)
    # Not strftime("%-d"): that's a glibc extension and blows up on Windows dev boxes.
    long_today = f"{today:%A, %B} {today.day}, {today.year}"

    return f"""\
# Today

Today is {long_today} ({today.isoformat()}).

Resolve every relative date -- "tomorrow", "Saturday", "this weekend" -- against this
table, and pass the ISO date to the tool. The basis column is already resolved for you.

  DATE        WEEKDAY    TYPE     BASIS
{table}

For any date after {last.isoformat()}: if it falls in {months} it is a typical day, and
otherwise the pool is closed.

Dates in the past work too, and come back as a live forecast built from the weather that
day actually had. Say you are describing what happened rather than what is expected."""


def build_system_prompt(
    today: date,
    *,
    posted_hours: dict[int, tuple[int, int]],
    month_names: dict[int, str],
    max_forecast_days: int,
    unit: str,
    temp_range: dict[str, float],
    meta: dict,
    timezone: str,
    table_days: int = TABLE_DAYS,
) -> list[str]:
    """[stable block, dated block] -- see the module docstring for why they are split."""
    return [
        static_context(
            posted_hours=posted_hours,
            month_names=month_names,
            max_forecast_days=max_forecast_days,
            unit=unit,
            temp_range=temp_range,
            meta=meta,
            timezone=timezone,
        ),
        dated_context(
            today,
            posted_hours=posted_hours,
            month_names=month_names,
            max_forecast_days=max_forecast_days,
            table_days=table_days,
        ),
    ]
