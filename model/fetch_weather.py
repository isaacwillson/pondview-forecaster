"""Fetch hourly historical weather for the pool site from the Open-Meteo archive.

Weather is a *feature* for the arrival-volume model, never an inclusion
criterion for observations. This script only pulls and caches the raw weather
series; deciding which hours exist happens later, in build_dataset.py, and is
driven solely by day_log.csv. Keeping the fetch dumb keeps that boundary clean.

Run once; the result is cached to data/interim/weather.csv (gitignored).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import requests

# --- Site + query configuration (edit these constants rather than passing CLI args) ---

# Open-Meteo *archive* (reanalysis) endpoint. We use the archive rather than the
# forecast endpoint because we are labelling historical sign-in data: we want the
# weather that actually occurred on each past day, not a forecast issued back then.
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

LATITUDE = 40.91822
LONGITUDE = -74.59974

# The observed season. Inclusive on both ends for the Open-Meteo archive API.
START_DATE = "2026-07-08"
END_DATE = "2026-08-04"

# Order here is the order of columns we persist. These are the six predictors the
# modeling table is allowed to draw from (build_dataset.py may drop redundant ones).
HOURLY_VARIABLES = [
    "temperature_2m",
    "apparent_temperature",
    "precipitation",
    "relative_humidity_2m",
    "cloud_cover",
    "wind_speed_10m",
]

# timezone is NON-NEGOTIABLE. Omit it and Open-Meteo returns timestamps in UTC.
# The pool runs on America/New_York (UTC-4 in summer), so a UTC join would shift
# every weather row four hours from the sign-in hour it is supposed to describe —
# a silent, plausible-looking error that would poison the whole model.
TIMEZONE = "America/New_York"

OUTPUT_PATH = Path(__file__).resolve().parent / "data" / "interim" / "weather.csv"

# The three low-turnout days I want to eyeball before deciding whether to keep them.
DAYS_TO_INSPECT = ["2026-07-09", "2026-07-29", "2026-08-02"]


def fetch_weather() -> pd.DataFrame:
    """Pull the hourly archive series for the site and season into a tidy frame.

    Returns one row per hour with a parsed ``datetime`` column (local, tz-naive so
    it joins cleanly against the floored sign-in hours) plus the six weather vars.
    """
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": START_DATE,
        "end_date": END_DATE,
        "hourly": ",".join(HOURLY_VARIABLES),
        "temperature_unit": "fahrenheit",
        "precipitation_unit": "inch",
        "timezone": TIMEZONE,
    }

    response = requests.get(ARCHIVE_URL, params=params, timeout=60)
    response.raise_for_status()
    payload = response.json()

    hourly = payload["hourly"]
    frame = pd.DataFrame(hourly)
    # Open-Meteo's "time" is already local because we passed timezone=. Parse to a
    # tz-naive local timestamp; build_dataset.py floors sign-ins the same way, so
    # the two align on wall-clock hour with no offset arithmetic anywhere.
    frame = frame.rename(columns={"time": "datetime"})
    frame["datetime"] = pd.to_datetime(frame["datetime"])
    frame = frame[["datetime"] + HOURLY_VARIABLES]
    return frame


def summarize_inspection_days(frame: pd.DataFrame) -> pd.DataFrame:
    """Daily max temperature and total precipitation for the flagged low days.

    These three days had anomalously low turnout; the point of the summary is to
    show whether they were rain days, which is a judgment input for whether to keep
    them — not a filtering step (we never drop rows on weather).
    """
    daily = frame.copy()
    daily["date"] = daily["datetime"].dt.strftime("%Y-%m-%d")
    subset = daily[daily["date"].isin(DAYS_TO_INSPECT)]
    summary = subset.groupby("date").agg(
        max_temp_f=("temperature_2m", "max"),
        total_precip_in=("precipitation", "sum"),
    )
    return summary.reindex(DAYS_TO_INSPECT)


def main() -> None:
    frame = fetch_weather()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(OUTPUT_PATH, index=False)

    n_missing = frame[HOURLY_VARIABLES].isna().any(axis=1).sum()
    print(f"Fetched {len(frame)} hourly rows -> {OUTPUT_PATH}")
    print(f"Date span: {frame['datetime'].min()} .. {frame['datetime'].max()}")
    if n_missing:
        # Loud, but not fatal here: the fetch is a cache step. build_dataset.py is
        # where a null weather value is a hard assertion failure.
        print(f"WARNING: {n_missing} rows have at least one null weather value.")

    print("\nInspection days (anomalous low turnout):")
    summary = summarize_inspection_days(frame)
    with pd.option_context("display.float_format", lambda v: f"{v:.2f}"):
        print(summary.to_string())


if __name__ == "__main__":
    main()
