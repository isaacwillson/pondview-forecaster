"""Assemble the hourly modeling table: family arrivals per hour + features.

The target is FAMILY ARRIVALS PER HOUR -- the count of sign-in lines that begin
in a given clock hour. It is emphatically NOT occupancy: the paper sheets record
arrivals only, never departures, so we cannot know how many families were present
at a moment. Every name here reflects that.

The single most important rule in this file: the hour grid is generated from
day_log.csv (open_hour .. close_hour-1 per observed day), NOT from the hours that
happen to contain sign-ins. Hours with zero arrivals are real observations -- the
pool was open and nobody came -- and they carry most of the bad-weather signal.
Building the grid from sign-ins would delete exactly those hours.

Output data/processed/hourly.csv IS committed, so it must contain no identifiers:
just a timestamp, the arrival count, and features.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

# Paths resolve relative to this file (model/), so the script runs from anywhere. Prefer
# the real resident data (gitignored -- maintainer's machine only); fall back to the
# committed synthetic sample so anyone who clones the public repo can run the pipeline
# end-to-end. A sample run writes hourly_sample.csv and reads its own bundled weather, so
# it needs no network and never clobbers the committed real aggregate.
_DATA = Path(__file__).resolve().parent / "data"
if (_DATA / "raw" / "signins.csv").exists():
    USING_SAMPLE = False
    _SRC = _DATA / "raw"
    WEATHER_PATH = _DATA / "interim" / "weather.csv"
    OUTPUT_PATH = _DATA / "processed" / "hourly.csv"
else:
    USING_SAMPLE = True
    _SRC = _DATA / "sample"
    WEATHER_PATH = _DATA / "sample" / "weather.csv"
    OUTPUT_PATH = _DATA / "processed" / "hourly_sample.csv"
SIGNINS_PATH = _SRC / "signins.csv"
DAY_LOG_PATH = _SRC / "day_log.csv"

# Six weather variables arrive from fetch_weather.py. With only a couple hundred rows we
# want 6-8 features total, so we prune near-duplicate predictors: two collinear features
# give the model no new information but two more chances to overfit noise.
WEATHER_VARIABLES = [
    "temperature_2m",
    "apparent_temperature",
    "precipitation",
    "relative_humidity_2m",
    "cloud_cover",
    "wind_speed_10m",
]

# |r| above this counts as redundant. 0.95 is strict enough that we only drop a
# feature when it is almost a linear copy of one we keep.
REDUNDANCY_THRESHOLD = 0.95


def count_arrivals() -> pd.DataFrame:
    """Count sign-ins per clock hour (the target), keyed by hour-floored datetime.

    Flooring to the hour is the definition of the target: a family that signs in at
    13:47 is an arrival in the 13:00 hour. Sign-ins that fall outside the day_log
    grid (before open, or in a partial closing hour we exclude) are simply not
    matched later -- the grid, not the sign-ins, decides which hours exist.
    """
    signins = pd.read_csv(SIGNINS_PATH, dtype={"date": str, "time_in": str})
    stamped = pd.to_datetime(signins["date"] + " " + signins["time_in"])
    hour = stamped.dt.floor("h")
    arrivals = hour.value_counts().rename("arrivals").rename_axis("datetime")
    return arrivals.reset_index()


def build_grid() -> pd.DataFrame:
    """Every open hour of every observed day, from day_log -- the backbone of the table.

    close_hour is exclusive, so range(open, close) also enforces the documented
    partial-hour exclusions (e.g. the 07-19 early close drops the 17:00 stub hour).
    """
    day_log = pd.read_csv(DAY_LOG_PATH)
    # open_hour must be plain integer hours; a non-integer here means the source was
    # mangled (e.g. a spreadsheet turned "10" into a serial date) and the grid would
    # be silently wrong. Fail loudly rather than build a corrupt backbone.
    for col in ("open_hour", "close_hour"):
        assert pd.api.types.is_integer_dtype(day_log[col]), (
            f"{col} is not integer-typed ({day_log[col].dtype}); check day_log.csv"
        )

    hours: list[pd.Timestamp] = []
    for row in day_log.itertuples(index=False):
        midnight = pd.Timestamp(row.date)
        for h in range(int(row.open_hour), int(row.close_hour)):
            hours.append(midnight + pd.Timedelta(hours=h))
    return pd.DataFrame({"datetime": hours})


def drop_redundant_weather(table: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Drop near-duplicate weather predictors, returning the survivors we keep.

    Decisions are data-driven off the correlation on the modeling rows themselves
    (the distribution the model actually sees), and printed so they can be defended.
    """
    present = [c for c in WEATHER_VARIABLES if c in table.columns]
    corr = table[present].corr().abs()

    dropped: list[str] = []

    # apparent_temperature ("feels like") is a derived heat-index blend of
    # temperature_2m, relative_humidity_2m and wind_speed_10m -- all three of which
    # we keep -- so it is informationally redundant regardless of the exact pairwise
    # r, and it stays strongly collinear with raw temperature (r printed below;
    # ~0.96 on the full series, ~0.92 on the daytime hours the model actually sees --
    # the gap is the heat-index effect on hot, humid afternoons). Dropping it also
    # keeps us at the 8-feature target for a 173-row table. We keep temperature_2m
    # over apparent because raw air temperature is the more standard, interpretable
    # predictor; a tree can still recover a heat-index-like response from temp+humidity.
    r_apparent = corr.loc["apparent_temperature", "temperature_2m"]
    dropped.append("apparent_temperature")
    print(
        f"  drop apparent_temperature: r={r_apparent:.3f} with temperature_2m, and it is a"
        f" derived blend of temperature/humidity/wind (all kept) -> redundant"
    )

    # humidity and cloud cover describe different things; only collapse them if this
    # particular four-week window happens to make them near-identical.
    if corr.loc["relative_humidity_2m", "cloud_cover"] > REDUNDANCY_THRESHOLD:
        dropped.append("cloud_cover")
        print(
            f"  drop cloud_cover: r={corr.loc['relative_humidity_2m','cloud_cover']:.3f}"
            f" with relative_humidity_2m (> {REDUNDANCY_THRESHOLD})"
        )
    else:
        print(
            f"  keep both relative_humidity_2m & cloud_cover: r="
            f"{corr.loc['relative_humidity_2m','cloud_cover']:.3f} (<= {REDUNDANCY_THRESHOLD})"
        )

    kept = [c for c in present if c not in dropped]
    return table.drop(columns=dropped), kept


def main() -> None:
    if USING_SAMPLE:
        print(
            "NOTE: real resident data not found -- building from the synthetic "
            "model/data/sample/ (output -> hourly_sample.csv).\n"
        )
    grid = build_grid()
    arrivals = count_arrivals()
    weather = pd.read_csv(WEATHER_PATH, parse_dates=["datetime"])

    # Left join FROM the grid: the grid is authoritative. Unmatched arrivals (outside
    # open hours) drop out here; unmatched grid hours get NaN -> 0, i.e. true zeros.
    table = grid.merge(arrivals, on="datetime", how="left")
    n_signins_placed = int(table["arrivals"].sum())
    table["arrivals"] = table["arrivals"].fillna(0).astype(int)

    table = table.merge(weather, on="datetime", how="left")

    # Calendar features. is_weekend is what the baseline conditions on; day_of_week
    # gives the model finer structure (e.g. Friday != Sunday) without a holiday flag
    # (there are none in this window) or a day-of-season index (a four-week span has
    # no seasonal arc -- that feature would be a pure overfitting surface).
    table["hour"] = table["datetime"].dt.hour
    table["day_of_week"] = table["datetime"].dt.dayofweek
    table["is_weekend"] = (table["day_of_week"] >= 5).astype(int)

    # --- Loud integrity checks: cheaper to crash here than to trust a broken table ---
    # Row count must equal the day_log-derived grid exactly. Deriving it from `grid`
    # (rather than a hardcoded number) keeps this honest when day_log changes -- e.g.
    # adding verified open-but-empty days -- while still catching a merge that
    # silently duplicated or dropped rows.
    assert len(table) == len(grid), (
        f"row count {len(table)} != grid size {len(grid)} -- the arrivals/weather merge "
        f"changed the row count; the grid must stay authoritative"
    )
    null_weather = table[WEATHER_VARIABLES].isna().sum().sum()
    assert null_weather == 0, (
        f"{null_weather} null weather cells -- weather.csv does not cover every grid hour"
    )

    print("Feature pruning (redundancy check on modeling rows):")
    table, kept_weather = drop_redundant_weather(table)

    ordered = ["datetime", "arrivals", "hour", "day_of_week", "is_weekend", *kept_weather]
    table = table[ordered].sort_values("datetime").reset_index(drop=True)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(OUTPUT_PATH, index=False)

    total_signins = len(pd.read_csv(SIGNINS_PATH))
    zero_share = (table["arrivals"] == 0).mean()
    print(f"\nWrote {len(table)} rows -> {OUTPUT_PATH}")
    print(f"Features ({len(ordered) - 2}): {ordered[2:]}")
    print(f"Zero-arrival hours: {(table['arrivals'] == 0).sum()} ({zero_share:.1%})")
    print(f"Mean arrivals/hour: {table['arrivals'].mean():.2f}")
    print(
        f"Sign-ins placed in grid: {n_signins_placed} of {total_signins} "
        f"({total_signins - n_signins_placed} fell outside open hours, e.g. partial closing hours)"
    )


if __name__ == "__main__":
    main()
