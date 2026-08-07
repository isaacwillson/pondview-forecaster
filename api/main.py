"""FastAPI service: hourly family-arrival forecasts for the pool, with what-if.

Given a date, GET /forecast returns a per-hour prediction with an uncertainty band,
plus a `basis` telling the caller how the numbers were produced:

  forecast -- live Open-Meteo weather (in season, within the ~16-day horizon)
  typical  -- in season but beyond the horizon: the historical (hour x is_weekend)
              baseline, banded from its historical spread (NOT an error)
  closed   -- outside the pool season: no per-hour numbers, just the closed state

POST /whatif drives the model directly from supplied conditions (weekend/temperature/
rain) to expose its learned behaviour. Bands come from the model's own leave-one-day-out
error (model_context.json), never from quantile regression -- 24 days can't calibrate
those. "Arrivals", never "occupancy": the model knows nothing about how long anyone stays.

Deployed as an AWS Lambda container image; `handler` at the bottom is the entry point.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel

# --- Site + service configuration ---
LATITUDE = 40.91822
LONGITUDE = -74.59974
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEZONE = "America/New_York"  # mandatory: omit it and Open-Meteo returns UTC (4h off)
TEMPERATURE_UNIT = "fahrenheit"
PRECIPITATION_UNIT = "inch"

ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
]
UNIT = "family arrivals per hour"

# Posted seasonal pool hours, month -> (open_hour, close_hour), close exclusive. The
# keys define the SEASON. We assume normal posted hours and never invent day-specific
# early closures (the frontend methodology copy says so).
POSTED_HOURS = {7: (10, 20), 8: (11, 19)}
MONTH_NAMES = {7: "July", 8: "August"}

# Open-Meteo's forecast reaches ~16 days ahead; beyond that we serve the "typical"
# baseline instead of erroring.
MAX_FORECAST_DAYS = 16

# --- Artifacts (model + context sidecar), resolved to the repo layout by default and
#     overridable via env so the Lambda image can point at /var/task (see api/Dockerfile).
_MODEL_DIR = Path(__file__).resolve().parent.parent / "model"
MODEL_PATH = Path(os.environ.get("MODEL_PATH", _MODEL_DIR / "model.joblib"))
CONTEXT_PATH = Path(os.environ.get("CONTEXT_PATH", _MODEL_DIR / "model_context.json"))

# Load once at import (Lambda cold start), not per request.
_bundle = joblib.load(MODEL_PATH)
MODEL = _bundle["model"]
FEATURES: list[str] = _bundle["features"]
WEATHER_VARS = [f for f in FEATURES if f not in ("hour", "is_weekend")]

CONTEXT = json.loads(CONTEXT_PATH.read_text())
HOUR_RESIDUAL: dict[str, float] = CONTEXT["hour_residual"]  # band half-width per hour
BASELINE: dict[str, dict[str, dict[str, float]]] = CONTEXT["baseline"]  # [is_weekend][hour]
SEASONAL_MEANS: dict[str, float] = CONTEXT["seasonal_means"]
TEMP_RANGE: dict[str, float] = CONTEXT["temp_range"]
# Dry- vs wet-hour condition profiles. /whatif's rain toggle swaps between them because
# the model's rain response lives in the (correlated) humidity/cloud, not precipitation.
WHATIF_CONDITIONS: dict[str, dict[str, float]] = CONTEXT["whatif_conditions"]
_DEFAULT_RESIDUAL = float(np.mean(list(HOUR_RESIDUAL.values())))

# What-if is date-agnostic, so it spans the widest posted open hours across the season.
_min_open = min(o for o, _ in POSTED_HOURS.values())
_max_close = max(c for _, c in POSTED_HOURS.values())
WHATIF_HOURS = list(range(_min_open, _max_close))

app = FastAPI(
    title="Pondview Pool arrival forecaster",
    description="Hourly family-arrival forecasts (not occupancy), with a what-if explorer.",
    version="2.0.0",
)

# GET for /forecast, POST for /whatif; the browser origins come from ALLOWED_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    # MUST be a LIST of full origins (scheme + host). A bare string is iterated
    # character-by-character by Starlette and matches nothing -> CORS silently blocks.
    allow_origins=["https://pondview-forecast.vercel.app", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class WhatIfRequest(BaseModel):
    """Conditions for /whatif.

    The rain toggle swaps the whole condition profile (dry-hour vs wet-hour means),
    since the model reads rain through humidity/cloud, not the precipitation value.
    """

    is_weekend: bool = False
    temperature: float
    precipitation: bool = False  # rain on/off


def _open_hours(month: int) -> list[int] | None:
    """Posted open hours for a month, or None if the pool is out of season that month."""
    posted = POSTED_HOURS.get(month)
    return None if posted is None else list(range(posted[0], posted[1]))


def _band(hour: int, predicted: float) -> dict:
    """One per-hour prediction with its uncertainty band (the model's CV error)."""
    residual = HOUR_RESIDUAL.get(str(hour), _DEFAULT_RESIDUAL)
    return {
        "hour": hour,
        "predicted": round(predicted, 1),
        "low": round(max(0.0, predicted - residual), 1),  # arrivals can't be negative
        "high": round(predicted + residual, 1),
    }


def _predict(rows: list[dict]) -> np.ndarray:
    """Clip-at-zero model predictions for a list of feature rows (order = FEATURES)."""
    return np.clip(MODEL.predict(pd.DataFrame(rows)[FEATURES]), 0, None)


def fetch_forecast_weather(day: date) -> pd.DataFrame:
    """Return one row per hour of `day` with the weather variables the model needs."""
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "hourly": ",".join(WEATHER_VARS),
        "temperature_unit": TEMPERATURE_UNIT,
        "precipitation_unit": PRECIPITATION_UNIT,
        "timezone": TIMEZONE,
        "start_date": day.isoformat(),
        "end_date": day.isoformat(),
    }
    response = requests.get(FORECAST_URL, params=params, timeout=30)
    response.raise_for_status()
    hourly = response.json().get("hourly")
    if not hourly or "time" not in hourly:
        raise HTTPException(status_code=502, detail="weather API returned no hourly data")
    frame = pd.DataFrame(hourly).rename(columns={"time": "datetime"})
    frame["datetime"] = pd.to_datetime(frame["datetime"])
    frame["hour"] = frame["datetime"].dt.hour
    return frame


@app.get("/")
def root() -> dict:
    """Landing payload so the base URL is self-describing instead of a bare 404."""
    return {
        "service": "Pondview Pool arrival forecaster",
        "unit": UNIT,
        "endpoints": {
            "/forecast?day=YYYY-MM-DD": "banded hourly forecast with a basis (forecast/typical/closed)",
            "/whatif": "POST conditions -> hourly curve under those conditions",
            "/health": "service status + what the model was trained on",
            "/docs": "interactive API documentation",
        },
    }


@app.get("/health")
def health() -> dict:
    """Liveness check that also reports what the loaded model expects + was trained on."""
    return {
        "status": "ok",
        "model_features": FEATURES,
        "unit": UNIT,
        "trained_on": CONTEXT["meta"],
    }


@app.get("/forecast")
def forecast(
    day: str = Query(..., description="Target day, YYYY-MM-DD", examples=["2026-08-06"])
) -> dict:
    """Banded hourly forecast for `day`, with a `basis` of forecast / typical / closed."""
    try:
        target = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        # The ONLY 422: genuinely malformed input. Season/horizon never 422 -- they are
        # legitimate states (closed / typical), not client errors.
        raise HTTPException(status_code=422, detail="day must be formatted YYYY-MM-DD")

    is_weekend = int(target.weekday() >= 5)  # Mon=0 .. Sun=6
    open_hours = _open_hours(target.month)

    # closed -- outside the season. No per-hour numbers, just an honest closed state.
    if open_hours is None:
        months = ", ".join(MONTH_NAMES[m] for m in sorted(POSTED_HOURS))
        return {
            "basis": "closed",
            "day": day,
            "is_weekend": bool(is_weekend),
            "unit": UNIT,
            "open_hours": None,
            "message": f"Closed for the season (the pool is open {months}).",
        }

    days_ahead = (target - date.today()).days

    # typical -- in season but past the live-forecast window: historical baseline,
    # banded from its own historical spread (this is expected variability, not error).
    if days_ahead > MAX_FORECAST_DAYS:
        cells = BASELINE.get(str(is_weekend), {})
        predictions = []
        for hour in open_hours:
            cell = cells.get(str(hour))
            if cell is None:
                continue  # no historical observations for this (hour, is_weekend)
            mean, spread = cell["mean"], cell["spread"]
            predictions.append(
                {
                    "hour": hour,
                    "predicted": round(mean, 1),
                    "low": round(max(0.0, mean - spread), 1),
                    "high": round(mean + spread, 1),
                }
            )
        return {
            "basis": "typical",
            "day": day,
            "is_weekend": bool(is_weekend),
            "unit": UNIT,
            "open_hours": open_hours,
            "predictions": predictions,
        }

    # forecast -- live weather is available.
    try:
        weather = fetch_forecast_weather(target)
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"weather fetch failed: {exc}") from exc

    weather_by_hour = weather.set_index("hour")
    missing = [h for h in open_hours if h not in weather_by_hour.index]
    if missing:
        raise HTTPException(
            status_code=502, detail=f"forecast weather missing hours {missing} for {day}"
        )

    rows = []
    for hour in open_hours:
        w = weather_by_hour.loc[hour]
        row = {"hour": hour, "is_weekend": is_weekend}
        row.update({var: float(w[var]) for var in WEATHER_VARS})
        rows.append(row)

    preds = _predict(rows)
    return {
        "basis": "forecast",
        "day": day,
        "is_weekend": bool(is_weekend),
        "unit": UNIT,
        "open_hours": open_hours,
        "predictions": [_band(h, float(p)) for h, p in zip(open_hours, preds)],
    }


@app.post("/whatif")
def whatif(req: WhatIfRequest) -> dict:
    """Hourly curve under supplied conditions -- to make the model's behaviour visible.

    Only weekend / temperature / rain are user-driven. Rain on/off selects the wet- or
    dry-hour condition profile (humidity, cloud, wind, precip); temperature is applied on
    top. `assumed` echoes the full weather actually fed to the model, for honesty.
    """
    is_weekend = int(req.is_weekend)
    profile = WHATIF_CONDITIONS["wet" if req.precipitation else "dry"]
    assumed = {"temperature_2m": req.temperature, **profile}

    rows = [{"hour": h, "is_weekend": is_weekend, **assumed} for h in WHATIF_HOURS]
    preds = _predict(rows)

    # Honest signal for the frontend: is the requested temperature outside what we trained on?
    extrapolating = (
        req.temperature < TEMP_RANGE["min"] or req.temperature > TEMP_RANGE["max"]
    )
    return {
        "conditions": {
            "is_weekend": req.is_weekend,
            "temperature": req.temperature,
            "precipitation": req.precipitation,
            "assumed": assumed,
        },
        "temp_range": TEMP_RANGE,
        "extrapolating": bool(extrapolating),
        "unit": UNIT,
        "predictions": [_band(h, float(p)) for h, p in zip(WHATIF_HOURS, preds)],
    }


# AWS Lambda entry point. API Gateway / Function URL -> Mangum -> this ASGI app.
handler = Mangum(app)
