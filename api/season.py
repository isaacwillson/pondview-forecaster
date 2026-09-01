"""When the pool is open: the season, the posted hours, and Labor Day.

Its own module because three places need the same answer -- /forecast's basis, the
assistant's pre-resolved date table, and the closed-state message -- and a date rule
copied into three files is a rule that will eventually disagree with itself.

Pure: imports nothing but datetime, holds no model and touches no network, so it can be
imported from anywhere (including api/prompt.py, which must render without unpickling
the model) and tested on its own.
"""

from __future__ import annotations

from datetime import date, timedelta

# Posted seasonal hours, month -> (open_hour, close_hour), close EXCLUSIVE: a 10-20
# month is open until 8 PM and its last hourly bucket is the 7 PM one.
#
# September keeps August's hours. The season ends mid-month on Labor Day rather than at
# a month boundary, so month alone can no longer answer "is the pool open" -- see
# open_hours() below, which takes a full date for exactly that reason.
POSTED_HOURS: dict[int, tuple[int, int]] = {
    7: (10, 20),
    8: (11, 19),
    9: (11, 19),
}
MONTH_NAMES: dict[int, str] = {7: "July", 8: "August", 9: "September"}

# The month the season ends in. Days in this month after Labor Day are closed; every
# other month in POSTED_HOURS is open throughout.
SEASON_LAST_MONTH = 9


def labor_day(year: int) -> date:
    """The first Monday in September -- the pool's last open day of the season.

    Computed, never hardcoded: the date moves every year (2025-09-01, 2026-09-07,
    2027-09-06). `weekday()` is Monday=0, so the modulo lands on September 1 itself
    when the 1st is already a Monday.
    """
    first = date(year, 9, 1)
    return first + timedelta(days=(7 - first.weekday()) % 7)


def open_hours(day: date) -> list[int] | None:
    """Posted open hours for a DATE, or None if the pool is closed that day.

    Takes a date rather than a month because the season does not end on a month
    boundary -- September is open only through Labor Day.
    """
    posted = POSTED_HOURS.get(day.month)
    if posted is None:
        return None
    if day.month == SEASON_LAST_MONTH and day > labor_day(day.year):
        return None
    return list(range(posted[0], posted[1]))


def is_open(day: date) -> bool:
    """Whether the pool operates at all on `day`, ignoring the time."""
    return open_hours(day) is not None


def season_description() -> str:
    """How to name the season in prose, e.g. "July through Labor Day"."""
    first = MONTH_NAMES[min(POSTED_HOURS)]
    return f"{first} through Labor Day"
