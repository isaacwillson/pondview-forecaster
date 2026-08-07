"""Train and honestly evaluate the hourly arrival-volume model.

Two rules drive this file:

1. Baseline before model. The baseline is mean arrivals by (hour, is_weekend),
   fit on the training fold only. A gradient-boosted model that cannot beat a
   lookup table of hourly averages is not worth deploying, so we always report
   both side by side and let the numbers speak -- a tie is a real finding, not a
   failure to tune away.

2. Split by day, never by row. Hours from the same afternoon share weather and
   crowd conditions, so a row-level split would leak. We use leave-one-day-out
   CV grouped on date (one fold per observed day); the dataset is tiny, so this is
   cheap and far more stable than 5-fold.

Predicting FAMILY ARRIVALS PER HOUR -- not occupancy.

`FEATURES`, `make_model`, and `baseline_predict` are the public surface: train.py,
ablation.py, and the findings notebook all import them so there is one source of truth.
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

# Paths are resolved relative to this file (model/), so the script runs from anywhere.
_HERE = Path(__file__).resolve().parent
DATA_PATH = _HERE / "data" / "processed" / "hourly.csv"
MODEL_PATH = _HERE / "model.joblib"
# Sidecar the API reads for uncertainty bands, the "typical" fallback, and /whatif
# defaults. A readable JSON so anyone browsing the repo can see exactly what the API
# uses. Baked into the image next to model.joblib (see api/Dockerfile).
CONTEXT_PATH = _HERE / "model_context.json"

TARGET = "arrivals"
BASELINE_KEYS = ["hour", "is_weekend"]

# The model's input columns. day_of_week is present in hourly.csv (it's useful for
# exploration) but is deliberately excluded here: the ablation (src/ablation.py) shows
# a tree given day_of_week overfits day-level noise -- a calendar-only model that
# includes it scores WORSE than the time-only baseline, and adding it to the full model
# is a statistical wash (a paired test across folds cannot separate 7 from 8 features).
# So we keep the simpler 7-feature model: the baseline's (hour, is_weekend) structure
# plus weather.
FEATURES = [
    "hour",
    "is_weekend",
    "temperature_2m",
    "precipitation",
    "relative_humidity_2m",
    "cloud_cover",
    "wind_speed_10m",
]

# Shallow on purpose: only ~190 training rows per fold cannot support a deep model
# without memorizing folds. These are deliberate, not grid-searched -- at this sample
# size a hard search would just overfit the CV itself.
MODEL_PARAMS = dict(
    max_depth=3,
    min_samples_leaf=10,
    l2_regularization=1.0,
    random_state=42,
)


def make_model() -> HistGradientBoostingRegressor:
    """Construct the (unfitted) model.

    A single factory so training, cross-validation, and the notebook all build the
    exact same estimator -- there is no second place to change a hyperparameter.
    """
    return HistGradientBoostingRegressor(**MODEL_PARAMS)


def load_data() -> pd.DataFrame:
    """Load the modeling table and add a normalized `date` column for grouping."""
    df = pd.read_csv(DATA_PATH, parse_dates=["datetime"])
    df["date"] = df["datetime"].dt.normalize()
    missing = [f for f in FEATURES if f not in df.columns]
    assert not missing, f"hourly.csv is missing model features: {missing}"
    return df


def baseline_predict(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Predict each test hour with the train-fold mean for its (hour, is_weekend).

    Fitting on the TRAIN fold only is the whole point -- using the test day's own
    hours would leak. If a (hour, is_weekend) cell never appears in training (a
    rare hour on a held-out day), fall back to the global train mean so we never
    emit NaN.
    """
    cell_means = train.groupby(BASELINE_KEYS)[TARGET].mean()
    global_mean = train[TARGET].mean()
    keys = list(zip(test["hour"], test["is_weekend"]))
    preds = np.array([cell_means.get(k, global_mean) for k in keys], dtype=float)
    # Baseline means are already >= 0; clip anyway so both predictors obey the same
    # "arrivals cannot be negative" contract.
    return np.clip(preds, 0, None)


def model_predict(
    train: pd.DataFrame, test: pd.DataFrame, features: list[str] = FEATURES
) -> np.ndarray:
    """Fit the gradient-boosted model on the train fold and predict the test day."""
    model = make_model()
    model.fit(train[features], train[TARGET])
    # Negative arrivals are impossible; clip the regressor's output at zero.
    return np.clip(model.predict(test[features]), 0, None)


def run_loo_cv(df: pd.DataFrame, features: list[str] = FEATURES) -> pd.DataFrame:
    """Leave-one-day-out CV; return the table with out-of-fold predictions attached.

    Each day is held out exactly once. We keep the per-row OOF predictions so error
    can later be sliced by segment (weekend, temperature) on genuinely held-out data.
    """
    out = df.copy()
    out["pred_baseline"] = np.nan
    out["pred_model"] = np.nan

    fold_mae_baseline: list[float] = []
    fold_mae_model: list[float] = []

    for day in sorted(df["date"].unique()):
        test_mask = df["date"] == day
        train, test = df[~test_mask], df[test_mask]

        pred_b = baseline_predict(train, test)
        pred_m = model_predict(train, test, features)

        out.loc[test_mask, "pred_baseline"] = pred_b
        out.loc[test_mask, "pred_model"] = pred_m

        fold_mae_baseline.append(mean_absolute_error(test[TARGET], pred_b))
        fold_mae_model.append(mean_absolute_error(test[TARGET], pred_m))

    out.attrs["fold_mae_baseline"] = np.array(fold_mae_baseline)
    out.attrs["fold_mae_model"] = np.array(fold_mae_model)
    return out


def report_headline(out: pd.DataFrame) -> None:
    """Print the baseline and model MAE side by side -- baseline first."""
    mb = out.attrs["fold_mae_baseline"]
    mm = out.attrs["fold_mae_model"]
    improvement = (mb.mean() - mm.mean()) / mb.mean() * 100

    print("=" * 60)
    print(f"Leave-one-day-out CV  ({len(mb)} folds, grouped on date)")
    print("MAE = mean absolute error in family arrivals / hour")
    print("-" * 60)
    print(f"  baseline (hour x is_weekend):  {mb.mean():.3f}  +/- {mb.std():.3f}")
    print(f"  model    (HistGradientBoost):  {mm.mean():.3f}  +/- {mm.std():.3f}")
    print(f"  improvement over baseline:     {improvement:+.1f}%")
    print("=" * 60)


def report_segments(out: pd.DataFrame) -> None:
    """Slice out-of-fold error by weekend and by temperature bucket.

    Segment MAE is computed by pooling out-of-fold predictions (per-fold slices
    would be too small to read), then comparing baseline vs model within each slice.
    """
    err_b = (out[TARGET] - out["pred_baseline"]).abs()
    err_m = (out[TARGET] - out["pred_model"]).abs()

    seg = out.copy()
    seg["abs_err_baseline"] = err_b
    seg["abs_err_model"] = err_m
    seg["temp_bucket"] = pd.qcut(
        seg["temperature_2m"], 3, labels=["cool", "mild", "warm"]
    )

    def block(title: str, group_col: str) -> tuple[str, float]:
        print(f"\n{title}")
        print(f"  {'segment':<16}{'n':>5}{'baseline':>11}{'model':>9}{'delta':>9}")
        best_label, best_delta = "", -np.inf
        grouped = seg.groupby(group_col, observed=True)
        for label, g in grouped:
            b, m = g["abs_err_baseline"].mean(), g["abs_err_model"].mean()
            delta = b - m  # positive = model better
            name = {0: "weekday", 1: "weekend"}.get(label, str(label))
            print(f"  {name:<16}{len(g):>5}{b:>11.3f}{m:>9.3f}{delta:>+9.3f}")
            if delta > best_delta:
                best_delta, best_label = delta, name
        return best_label, best_delta

    wknd_best = block("By weekend/weekday:", "is_weekend")
    temp_best = block("By temperature bucket:", "temp_bucket")

    # One-sentence read on where the model earns its keep most.
    overall_best = max([wknd_best, temp_best], key=lambda x: x[1])
    if overall_best[1] <= 0:
        print(
            "\nThe model does not beat the baseline in any segment -- the time-only "
            "lookup is hard to improve on in this window."
        )
    else:
        print(
            f"\nThe model beats the baseline most on {overall_best[0]} hours "
            f"(MAE lower by {overall_best[1]:.2f} arrivals/hour)."
        )


def save_final_model(df: pd.DataFrame, features: list[str] = FEATURES) -> None:
    """Refit on ALL rows and persist model + feature order for the API to reuse.

    The deployed artifact is fit on the whole dataset -- the leave-one-day-out folds
    exist only for honest evaluation and are never the thing we ship.
    """
    model = make_model()
    model.fit(df[features], df[TARGET])   # all rows, not a CV fold
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": features}, MODEL_PATH)
    print(f"\nSaved final model -> {MODEL_PATH}  (fit on all {len(df)} rows, not a fold)")
    print(f"  features ({len(features)}): {features}")
    # The API must pin this exact version: a scikit-learn mismatch can silently
    # change or refuse to load a pickled estimator.
    print(f"  trained with scikit-learn {sklearn.__version__}")


def save_context(df: pd.DataFrame, out: pd.DataFrame) -> None:
    """Write model_context.json: everything the API needs beyond the model itself.

    All of it is derived from the training data and the leave-one-day-out out-of-fold
    predictions -- deliberately NOT from quantile regression, which 24 days cannot
    calibrate. The band is the model's own CV error, which is what we can honestly claim.
    """
    # Per-hour band half-width = mean absolute out-of-fold error for that hour. The most
    # defensible "how far off are we, typically" number: the model's actual CV error.
    residual = (out[TARGET] - out["pred_model"]).abs()
    hour_residual = residual.groupby(out["hour"]).mean()

    # What-if condition profiles. The model's rain response is carried by humidity and
    # cloud (which co-occur with rain), NOT by the precipitation value -- so /whatif's
    # "rain on/off" must swap the whole rainy-vs-dry condition profile, or the toggle is
    # inert. These are the mean conditions on measurable-rain hours vs dry hours.
    wet_rows = df[df["precipitation"] >= 0.01]
    dry_rows = df[df["precipitation"] < 0.01]

    def _conditions(sub: pd.DataFrame, with_precip: bool) -> dict[str, float]:
        prof = {
            v: round(float(sub[v].mean()), 3)
            for v in ("relative_humidity_2m", "cloud_cover", "wind_speed_10m")
        }
        prof["precipitation"] = round(float(sub["precipitation"].mean()), 3) if with_precip else 0.0
        return prof

    # Historical baseline for the "typical" fallback: mean arrivals by (is_weekend, hour)
    # over ALL rows, plus the historical spread (std) used to band it.
    grp = df.groupby(["is_weekend", "hour"])[TARGET]
    means, spreads = grp.mean(), grp.std().fillna(0.0)
    baseline: dict[str, dict[str, dict[str, float]]] = {}
    for (wknd, hr), mean in means.items():
        baseline.setdefault(str(int(wknd)), {})[str(int(hr))] = {
            "mean": round(float(mean), 3),
            "spread": round(float(spreads[(wknd, hr)]), 3),
        }

    context = {
        "meta": {
            "n_observations": int(len(df)),
            "n_days": int(df["date"].nunique()),
            "features": FEATURES,
            "cv_baseline_mae": round(float(out.attrs["fold_mae_baseline"].mean()), 3),
            "cv_model_mae": round(float(out.attrs["fold_mae_model"].mean()), 3),
            "sklearn_version": sklearn.__version__,
        },
        # Band half-width per hour (forecast + what-if bands).
        "hour_residual": {str(int(h)): round(float(v), 3) for h, v in hour_residual.items()},
        # baseline[is_weekend][hour] = {mean, spread} for the "typical" basis.
        "baseline": baseline,
        # Overall seasonal means (reference / transparency).
        "seasonal_means": {
            v: round(float(df[v].mean()), 3)
            for v in ("relative_humidity_2m", "cloud_cover", "wind_speed_10m")
        },
        # /whatif swaps between these when the rain toggle flips (see note above).
        "whatif_conditions": {
            "dry": _conditions(dry_rows, with_precip=False),
            "wet": _conditions(wet_rows, with_precip=True),
        },
        # Observed training temperature range -> /whatif flags extrapolation outside it.
        "temp_range": {
            "min": round(float(df["temperature_2m"].min()), 1),
            "max": round(float(df["temperature_2m"].max()), 1),
        },
    }
    CONTEXT_PATH.write_text(json.dumps(context, indent=2, sort_keys=True) + "\n")
    print(f"Saved context sidecar -> {CONTEXT_PATH}")
    print(
        f"  per-hour residuals for hours {min(context['hour_residual'])}-"
        f"{max(context['hour_residual'])}; temp range "
        f"{context['temp_range']['min']}-{context['temp_range']['max']} F"
    )


def main() -> None:
    df = load_data()
    out = run_loo_cv(df, FEATURES)
    report_headline(out)      # baseline + model, before anything else
    report_segments(out)
    save_final_model(df, FEATURES)   # 1a: deployed artifact is the full-data fit
    save_context(df, out)            # 1b: LOO-residual + baseline + /whatif context


if __name__ == "__main__":
    main()
