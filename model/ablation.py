"""Feature ablation: does weather actually earn its place in the model?

The binding constraint of this project is that a four-week mid-summer window holds
very little weather variance (only a handful of open hours saw measurable rain). So
before trusting any weather-driven result, we have to answer: is the model's edge
over the baseline coming from *weather*, or just from `day_of_week` structure the
baseline can't represent? And is `day_of_week` even pulling its weight?

This script answers both by re-running the exact leave-one-day-out harness from
train.py over different feature subsets, so every row is directly comparable. It is
evaluation only -- it trains nothing that gets saved. Findings drive the feature
choice encoded in train.py (`day_of_week` is excluded from the model).

Predicting FAMILY ARRIVALS PER HOUR -- not occupancy.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import mean_absolute_error

# Reuse train.py's harness verbatim so the numbers here match its report exactly.
from train import load_data, baseline_predict, make_model, TARGET

CALENDAR = ["hour", "day_of_week", "is_weekend"]
WEATHER = [
    "temperature_2m", "precipitation", "relative_humidity_2m",
    "cloud_cover", "wind_speed_10m",
]


def loo_model_mae(df, features: list[str]) -> np.ndarray:
    """Per-fold LOO MAE for an HGB model on a given feature subset."""
    maes = []
    for day in sorted(df["date"].unique()):
        test_mask = df["date"] == day
        train, test = df[~test_mask], df[test_mask]
        model = make_model()
        model.fit(train[features], train[TARGET])
        pred = np.clip(model.predict(test[features]), 0, None)
        maes.append(mean_absolute_error(test[TARGET], pred))
    return np.array(maes)


def loo_baseline_mae(df) -> np.ndarray:
    """Per-fold LOO MAE for the (hour, is_weekend) mean baseline."""
    maes = []
    for day in sorted(df["date"].unique()):
        test_mask = df["date"] == day
        train, test = df[~test_mask], df[test_mask]
        maes.append(mean_absolute_error(test[TARGET], baseline_predict(train, test)))
    return np.array(maes)


def main() -> None:
    df = load_data()

    configs = {
        "baseline: hour x is_weekend": loo_baseline_mae(df),
        "HGB: weather only (5)": loo_model_mae(df, WEATHER),
        "HGB: calendar only (3)": loo_model_mae(df, CALENDAR),
        "HGB: calendar + weather (8)": loo_model_mae(df, CALENDAR + WEATHER),
        "HGB: hour+is_weekend + weather (7, chosen)": loo_model_mae(
            df, ["hour", "is_weekend"] + WEATHER
        ),
    }

    print(f"{'config':<44}{'MAE':>8}{'+/- std':>10}")
    print("-" * 62)
    for name, maes in configs.items():
        print(f"{name:<44}{maes.mean():>8.3f}{maes.std():>10.3f}")

    base = configs["baseline: hour x is_weekend"]
    cal_only = configs["HGB: calendar only (3)"]
    full = configs["HGB: calendar + weather (8)"]
    chosen = configs["HGB: hour+is_weekend + weather (7, chosen)"]

    # 1) Does weather earn its place? Compare calendar-only vs calendar+weather.
    weather_gain = cal_only.mean() - full.mean()
    print(
        f"\nWeather's marginal value (calendar-only -> +weather): "
        f"{weather_gain:+.3f} arrivals/hr ({weather_gain / cal_only.mean() * 100:+.1f}%)."
    )
    # calendar-only is worse than baseline, so weather accounts for >100% of the net
    # gain over baseline: day_of_week alone is a liability weather has to pay back.
    print(
        f"  calendar-only ({cal_only.mean():.3f}) is "
        f"{'worse' if cal_only.mean() > base.mean() else 'better'} than the baseline "
        f"({base.mean():.3f}) -> the model's whole edge is weather, not day_of_week."
    )

    # 2) Is day_of_week dead weight even inside the full model? Report the direction
    #    from the numbers rather than asserting a fixed conclusion -- on a small,
    #    changing dataset this comparison can flip, and a hardcoded verdict would lie.
    d_mae = chosen.mean() - full.mean()  # positive => dropping day_of_week hurt
    if abs(d_mae) < 0.05:
        verdict = "a wash (well within fold-to-fold noise)"
    elif d_mae < 0:
        verdict = "a small improvement -> drop it"
    else:
        verdict = "slightly worse -> keeping it is defensible too"
    print(
        f"\nDropping day_of_week (8 -> 7): {full.mean():.3f} -> {chosen.mean():.3f} MAE "
        f"(delta {d_mae:+.3f}), std {full.std():.3f} -> {chosen.std():.3f}. On this dataset: {verdict}."
    )


if __name__ == "__main__":
    main()
