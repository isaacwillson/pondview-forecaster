"""FastAPI service that forecasts hourly family arrivals for a requested day.

Given a date, it pulls that day's hourly weather *forecast* from Open-Meteo, builds
the same feature frame the model was trained on, and returns predicted family
arrivals per hour. "Arrivals", never "occupancy" -- the model was trained on
sign-in counts and knows nothing about how long anyone stays.

Deployed as an AWS Lambda container image; `handler` at the bottom is the entry
point (Mangum translates API Gateway events into ASGI calls for FastAPI).
"""

from __future__ import annotations

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

# --- Site + service configuration ---
LATITUDE = 40.91822
LONGITUDE = -74.59974
# The *forecast* endpoint (not the archive): we want the predicted weather for an
# upcoming day. Same site, same units, same mandatory timezone as training data --
# omit timezone and Open-Meteo returns UTC, shifting every hour four hours off.
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEZONE = "America/New_York"
TEMPERATURE_UNIT = "fahrenheit"
PRECIPITATION_UNIT = "inch"

# Allowed browser origins are read from the environment (comma-separated) so one image
# can serve prod / staging / local without a code change. Blank entries are dropped, so
# an unset var yields [] (no cross-origin access) rather than a bogus [""] origin.
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
]
UNIT = "family arrivals per hour"

# Posted seasonal pool hours, month -> (open_hour, close_hour) with close exclusive.
# These are the *scheduled* hours a forecast can assume; day-specific early closures
# (which the training day_log records after the fact) are unknowable in advance, so
# the service forecasts a normally-operating day. The keys also define the pool SEASON:
# a request for any other month is rejected rather than silently guessed.
POSTED_HOURS = {7: (10, 20), 8: (11, 19)}

# Open-Meteo's forecast endpoint only reaches ~16 days ahead; past that it has no data,
# so we reject the request rather than round-trip to a guaranteed failure.
MAX_FORECAST_DAYS = 16

# Resolve the model beside the repo by default; overridable so the Lambda image can
# point at wherever the artifact is copied (see api/Dockerfile).
MODEL_PATH = Path(
    os.environ.get(
        "MODEL_PATH", Path(__file__).resolve().parent.parent / "models" / "model.joblib"
    )
)

# Load once at import (Lambda cold start), not per request.
_bundle = joblib.load(MODEL_PATH)
MODEL = _bundle["model"]
FEATURES: list[str] = _bundle["features"]
# Weather variables to request are derived from the model's own feature list, so the
# API and model can never drift out of sync (e.g. if apparent_temperature is re-added).
WEATHER_VARS = [f for f in FEATURES if f not in ("hour", "is_weekend")]

app = FastAPI(
    title="Pondview Pool arrival forecaster",
    description="Hourly family-arrival forecasts (not occupancy).",
    version="1.0.0",
)

# Browser origins come from ALLOWED_ORIGINS (env); GET is the only verb we expose.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def fetch_forecast_weather(day: date) -> pd.DataFrame:
    """Return one row per hour of `day` with the weather variables the model needs.

    Requesting start_date == end_date scopes the response to the single local day.
    """
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
            "/forecast?day=YYYY-MM-DD": "hourly family-arrival forecast for a day",
            "/health": "service status + the model's feature contract",
            "/docs": "interactive API documentation",
        },
    }


@app.get("/health")
def health() -> dict:
    """Liveness check that also reports what the loaded model expects."""
    return {"status": "ok", "model_features": FEATURES, "unit": UNIT}


@app.get("/forecast")
def forecast(
    day: str = Query(..., description="Target day, YYYY-MM-DD", examples=["2026-08-06"])
) -> dict:
    """Predict family arrivals for each open hour of `day`."""
    try:
        target = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="day must be formatted YYYY-MM-DD")

    # Reject well-formed but unservable dates up front (fail fast + clearly) rather than
    # round-tripping to Open-Meteo for a guaranteed miss. 422 = well-formed, unprocessable.
    if target.month not in POSTED_HOURS:
        raise HTTPException(
            status_code=422,
            detail=f"{day} is outside the pool season (open months: {sorted(POSTED_HOURS)})",
        )
    days_ahead = (target - date.today()).days
    if days_ahead > MAX_FORECAST_DAYS:
        raise HTTPException(
            status_code=422,
            detail=f"{day} is {days_ahead} days out; forecasts reach only "
            f"{MAX_FORECAST_DAYS} days ahead",
        )

    open_hour, close_hour = POSTED_HOURS[target.month]
    hours = list(range(open_hour, close_hour))
    is_weekend = int(target.weekday() >= 5)  # Mon=0 .. Sun=6

    try:
        weather = fetch_forecast_weather(target)
    except (requests.RequestException, ValueError) as exc:
        # Network failure, a non-2xx status, or an unparseable/JSON-broken body -- return
        # a clean 502 instead of letting it surface as an opaque 500.
        raise HTTPException(status_code=502, detail=f"weather fetch failed: {exc}") from exc

    weather_by_hour = weather.set_index("hour")
    missing = [h for h in hours if h not in weather_by_hour.index]
    if missing:
        raise HTTPException(
            status_code=502, detail=f"forecast weather missing hours {missing} for {day}"
        )

    rows = []
    for hour in hours:
        w = weather_by_hour.loc[hour]
        row = {"hour": hour, "is_weekend": is_weekend}
        row.update({var: float(w[var]) for var in WEATHER_VARS})
        rows.append(row)

    # Column order must match training; build the frame explicitly from FEATURES.
    features_frame = pd.DataFrame(rows)[FEATURES]
    # Clip at zero: the regressor can emit small negatives, but arrivals cannot be < 0.
    predictions = np.clip(MODEL.predict(features_frame), 0, None)

    return {
        "day": day,
        "is_weekend": bool(is_weekend),
        "unit": UNIT,
        "forecast": [
            {"hour": hour, "predicted_arrivals": round(float(pred), 1)}
            for hour, pred in zip(hours, predictions)
        ],
    }


# AWS Lambda entry point. API Gateway -> Mangum -> this ASGI app.
handler = Mangum(app)
