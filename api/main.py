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
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

import anthropic
import joblib
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel

# Two layouts, one module. Locally this runs as `uvicorn api.main:app` from the repo
# root, so prompt.py is `api.prompt`; in the Lambda image both files sit flat at
# /var/task (the handler is "main.handler"), so it is bare `prompt`. Same trick as
# MODEL_PATH below: default to the repo layout, tolerate the image's.
try:
    from api.aggregate import summarize, summarize_scenarios
    from api.prompt import build_system_prompt
except ImportError:  # pragma: no cover - only taken inside the Lambda image
    from aggregate import summarize, summarize_scenarios
    from prompt import build_system_prompt

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

# Open-Meteo's forecast covers 16 days INCLUSIVE of today, i.e. offsets 0..15, so 15 is
# the last day live weather exists for; beyond it we serve the "typical" baseline instead
# of erroring. This is an offset, not a count: at 16 Open-Meteo 400s the range request,
# which used to surface as a 502 on the one date sitting exactly on the boundary.
MAX_FORECAST_DAYS = 15

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
    allow_origins=[
        "https://pondviewforecast.vercel.app",
        "http://localhost:3000",
    ],
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


def fetch_forecast_weather(start: date, end: date) -> pd.DataFrame:
    """One row per hour between `start` and `end` inclusive, with the model's variables.

    Takes a range rather than a single day so a multi-day question costs ONE Open-Meteo
    round trip instead of one per day -- /chat asks about whole weeks, and the per-day
    version turned that into seven sequential network calls.
    """
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "hourly": ",".join(WEATHER_VARS),
        "temperature_unit": TEMPERATURE_UNIT,
        "precipitation_unit": PRECIPITATION_UNIT,
        "timezone": TIMEZONE,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    response = requests.get(FORECAST_URL, params=params, timeout=30)
    response.raise_for_status()
    hourly = response.json().get("hourly")
    if not hourly or "time" not in hourly:
        raise HTTPException(status_code=502, detail="weather API returned no hourly data")
    frame = pd.DataFrame(hourly).rename(columns={"time": "datetime"})
    frame["datetime"] = pd.to_datetime(frame["datetime"])
    frame["hour"] = frame["datetime"].dt.hour
    frame["date"] = frame["datetime"].dt.date
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
            "/chat": "POST a question -> a plain-language answer built from the above",
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


# Bound on how many days /chat may ask about at once. Caps both the Open-Meteo range and
# the tokens a single tool result can spend; the assistant is told to narrow instead.
MAX_QUERY_DAYS = 21


def query_forecast(
    start_date: str,
    end_date: str | None = None,
    part_of_day: str | None = None,
    rank: str | None = None,
    limit: int = 5,
) -> dict:
    """The assistant's forecast tool: a date window in, a ranked summary out.

    Wires window parsing to forecast_days() (one batched weather fetch) and then to
    aggregate.summarize() (all the ranking and filtering). Everything it can reject, it
    rejects with a ValueError phrased for the model to act on -- the chat layer returns
    those as is_error tool results so it can retry with better arguments.
    """
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date) if end_date else start
    except ValueError as exc:
        raise ValueError(
            f"dates must be ISO YYYY-MM-DD; got start_date={start_date!r}, "
            f"end_date={end_date!r}"
        ) from exc

    if end < start:
        raise ValueError(f"end_date {end} is before start_date {start}")
    span = (end - start).days + 1
    if span > MAX_QUERY_DAYS:
        raise ValueError(
            f"window is {span} days; ask about {MAX_QUERY_DAYS} days or fewer at a time"
        )

    targets = [start + timedelta(days=offset) for offset in range(span)]
    payloads = forecast_days(targets)
    return summarize(payloads, part_of_day=part_of_day, rank=rank, limit=limit)


def simulate_conditions(scenarios: list[dict]) -> dict:
    """The assistant's what-if tool: one or two hypothetical condition sets.

    Anything the caller leaves out is filled from the season's observed averages and
    recorded in `defaults_applied`, rather than being refused or silently invented. That
    keeps "does rain keep people away?" answerable -- it needs no temperature to be
    meaningful, only the same temperature on both sides -- while still making every
    assumed value visible in the result.
    """
    if not isinstance(scenarios, list) or not 1 <= len(scenarios) <= 2:
        raise ValueError("scenarios must be a list of one or two condition sets")

    payloads, defaults = [], []
    for index, scenario in enumerate(scenarios):
        if not isinstance(scenario, dict):
            raise ValueError(f"scenario {index} must be an object")
        unknown = set(scenario) - {"temperature", "is_weekend", "rain"}
        if unknown:
            raise ValueError(
                f"scenario {index} has unknown keys {sorted(unknown)}; allowed: "
                "temperature, is_weekend, rain"
            )

        applied: dict[str, str] = {}
        temperature = scenario.get("temperature")
        if temperature is None:
            temperature = TEMP_RANGE["mean"]
            applied["temperature"] = f"{temperature:g}F, the season's observed average"
        if not isinstance(temperature, (int, float)) or isinstance(temperature, bool):
            raise ValueError(f"scenario {index}: temperature must be a number")
        if not 0 <= temperature <= 130:
            raise ValueError(
                f"scenario {index}: temperature {temperature} is not a plausible "
                "Fahrenheit air temperature"
            )

        is_weekend = scenario.get("is_weekend")
        if is_weekend is None:
            is_weekend = False
            applied["is_weekend"] = "weekday"

        rain = scenario.get("rain")
        if rain is None:
            rain = False
            applied["rain"] = "dry"

        payloads.append(whatif_payload(bool(is_weekend), float(temperature), bool(rain)))
        defaults.append(applied)

    return summarize_scenarios(payloads, defaults)


# --- /chat limits -------------------------------------------------------------------
# Unlike /forecast, every /chat request spends money at the model provider, so the input
# is bounded before it reaches the API rather than after.
MAX_MESSAGE_CHARS = 500  # a resident's question, not an essay
MAX_HISTORY_TURNS = 10  # follow-ups keep working; token growth stays bounded
RATE_LIMIT_REQUESTS = 10  # per client, per window
RATE_LIMIT_WINDOW_SECONDS = 60

# Per-process request timestamps, keyed by client. This is a speed bump, NOT a real rate
# limit: Lambda runs concurrent instances that share no memory, so a distributed caller
# gets one bucket per instance. The controls that actually bound spend are outside this
# file -- reserved concurrency on the function, and a spend cap on the Anthropic account.
_recent_requests: dict[str, list[float]] = defaultdict(list)


def _client_key(request: Request) -> str:
    """Best-effort caller identity. X-Forwarded-For first: behind a Lambda function URL
    the socket peer is the proxy, so request.client would bucket everyone together."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(key: str) -> bool:
    now = time.monotonic()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    seen = [t for t in _recent_requests[key] if t > cutoff]
    seen.append(now)
    _recent_requests[key] = seen
    if len(_recent_requests) > 10_000:  # bound memory on a long-lived warm container
        for stale in [k for k, v in _recent_requests.items() if not v or v[-1] < cutoff]:
            del _recent_requests[stale]
    return len(seen) > RATE_LIMIT_REQUESTS


def _run_chat(*args, **kwargs):
    """Call the assistant loop, importing it on first use.

    Deferred because the dependency runs the other way at import time: chat.py imports
    this module for the system prompt, and tools.py imports it for the tool functions.
    A module-level import here would close that cycle. Python caches the module after
    the first call, so this costs one dict lookup per request thereafter.
    """
    try:
        from api.chat import run_chat
    except ImportError:  # pragma: no cover - only taken inside the Lambda image
        from chat import run_chat
    return run_chat(*args, **kwargs)


class ChatTurn(BaseModel):
    """One prior turn, as the browser remembers it. Text only -- see normalize_history."""

    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []


@app.post("/chat")
def chat(req: ChatRequest, request: Request) -> dict:
    """Ask the assistant a question about how busy the pool is expected to be.

    Stateless: the browser sends back the turns it wants remembered, because there is no
    session store to keep them in. The reply carries the tool trace alongside the text so
    the frontend can show which basis the answer rests on -- forecast, typical or closed
    -- the same honesty the web UI already shows for a day.

    No streaming: Mangum buffers the whole response, so the caller waits and then gets
    the full answer. That is a property of running under Lambda, not a design choice.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="The chat assistant is not configured on this deployment.",
        )

    # Rate limit BEFORE validating: an invalid request never reaches the model, but it
    # does cost a Lambda invocation, so a flood of junk has to be bounded too. Ordering
    # these the other way round meant a caller could hammer the endpoint indefinitely as
    # long as every request was malformed.
    if _rate_limited(_client_key(request)):
        raise HTTPException(
            status_code=429,
            detail="Too many questions just now -- give it a minute and try again.",
        )

    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="message must not be empty")
    if len(message) > MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=422,
            detail=f"message must be {MAX_MESSAGE_CHARS} characters or fewer",
        )

    history = [turn.model_dump() for turn in req.history][-MAX_HISTORY_TURNS:]
    try:
        result = _run_chat(message, history=history)
    except anthropic.APIStatusError as exc:
        # The provider's status is not this API's status: a 401 there is a deployment
        # problem here, not something the caller can fix by changing their question.
        raise HTTPException(
            status_code=429 if exc.status_code == 429 else 502,
            detail="The assistant is unavailable right now. Please try again shortly.",
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(
            status_code=502, detail="Could not reach the assistant."
        ) from exc

    return {
        "answer": result.text,
        "tools_used": result.tool_names,
        # Which basis the numbers rest on, for the frontend to label the answer with.
        "basis": sorted(
            {
                day["basis"]
                for call in result.tool_calls
                if isinstance(call.result, dict)
                for day in call.result.get("days", [])
            }
        ),
        "unit": UNIT,
    }


def chat_system_prompt(today: date | None = None) -> list[str]:
    """System prompt blocks for the /chat assistant, built from THIS module's constants.

    api/prompt.py deliberately imports nothing from here (it must render without loading
    the model), so this is the single wiring point -- the assistant's stated season,
    hours, horizon and model provenance can only ever be what the endpoints above use.
    """
    return build_system_prompt(
        today or date.today(),
        posted_hours=POSTED_HOURS,
        month_names=MONTH_NAMES,
        max_forecast_days=MAX_FORECAST_DAYS,
        unit=UNIT,
        temp_range=TEMP_RANGE,
        meta=CONTEXT["meta"],
        timezone=TIMEZONE,
    )


def basis_for(target: date, today: date | None = None) -> str:
    """Which of forecast / typical / closed `target` falls under.

    Season is checked before the horizon, so a far-future out-of-season date is `closed`,
    not `typical`. api/prompt.py mirrors this to pre-resolve the assistant's date table --
    keep the two in step.
    """
    if _open_hours(target.month) is None:
        return "closed"
    if (target - (today or date.today())).days > MAX_FORECAST_DAYS:
        return "typical"
    return "forecast"


def _closed_payload(target: date) -> dict:
    """The `closed` state: no per-hour numbers, just an honest out-of-season answer."""
    months = ", ".join(MONTH_NAMES[m] for m in sorted(POSTED_HOURS))
    return {
        "basis": "closed",
        "day": target.isoformat(),
        "is_weekend": target.weekday() >= 5,
        "unit": UNIT,
        "open_hours": None,
        "message": f"Closed for the season (the pool is open {months}).",
    }


def _typical_payload(target: date, open_hours: list[int]) -> dict:
    """In season but past the live-weather window: the historical hour x is_weekend
    baseline, banded from its own historical spread (expected variability, not error)."""
    is_weekend = int(target.weekday() >= 5)
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
        "day": target.isoformat(),
        "is_weekend": bool(is_weekend),
        "unit": UNIT,
        "open_hours": open_hours,
        "predictions": predictions,
    }


def _forecast_payload(
    target: date, open_hours: list[int], weather: pd.DataFrame
) -> dict:
    """Live-weather forecast for one day, given that day's slice of the weather frame."""
    is_weekend = int(target.weekday() >= 5)
    weather_by_hour = weather.set_index("hour")
    missing = [h for h in open_hours if h not in weather_by_hour.index]
    if missing:
        raise HTTPException(
            status_code=502,
            detail=f"forecast weather missing hours {missing} for {target.isoformat()}",
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
        "day": target.isoformat(),
        "is_weekend": bool(is_weekend),
        "unit": UNIT,
        "open_hours": open_hours,
        "predictions": [_band(h, float(p)) for h, p in zip(open_hours, preds)],
    }


def forecast_days(targets: list[date]) -> list[dict]:
    """Per-day forecast payloads for `targets`, in the order given.

    The batching point: every day needing live weather is served from ONE Open-Meteo
    range request spanning the earliest to the latest of them, so a week-long question
    costs one round trip. Days that are closed or past the horizon never touch the
    network at all. Each payload is exactly what GET /forecast returns for that day.
    """
    bases = {target: basis_for(target) for target in targets}
    live = sorted(t for t, b in bases.items() if b == "forecast")

    weather = None
    if live:
        try:
            weather = fetch_forecast_weather(live[0], live[-1])
        except (requests.RequestException, ValueError) as exc:
            raise HTTPException(
                status_code=502, detail=f"weather fetch failed: {exc}"
            ) from exc

    payloads = []
    for target in targets:
        basis = bases[target]
        if basis == "closed":
            payloads.append(_closed_payload(target))
            continue
        open_hours = _open_hours(target.month)
        if basis == "typical":
            payloads.append(_typical_payload(target, open_hours))
            continue
        day_weather = weather[weather["date"] == target]
        payloads.append(_forecast_payload(target, open_hours, day_weather))
    return payloads


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

    return forecast_days([target])[0]


def whatif_payload(
    is_weekend: bool, temperature: float, precipitation: bool
) -> dict:
    """Hourly curve under supplied conditions -- to make the model's behaviour visible.

    Only weekend / temperature / rain are user-driven. Rain on/off selects the wet- or
    dry-hour condition profile (humidity, cloud, wind, precip); temperature is applied on
    top. `assumed` echoes the full weather actually fed to the model, for honesty.
    """
    profile = WHATIF_CONDITIONS["wet" if precipitation else "dry"]
    assumed = {"temperature_2m": temperature, **profile}

    rows = [{"hour": h, "is_weekend": int(is_weekend), **assumed} for h in WHATIF_HOURS]
    preds = _predict(rows)

    # Honest signal for the frontend: is the requested temperature outside what we trained on?
    extrapolating = temperature < TEMP_RANGE["min"] or temperature > TEMP_RANGE["max"]
    return {
        "conditions": {
            "is_weekend": is_weekend,
            "temperature": temperature,
            "precipitation": precipitation,
            "assumed": assumed,
        },
        "temp_range": TEMP_RANGE,
        "extrapolating": bool(extrapolating),
        "unit": UNIT,
        "predictions": [_band(h, float(p)) for h, p in zip(WHATIF_HOURS, preds)],
    }


@app.post("/whatif")
def whatif(req: WhatIfRequest) -> dict:
    """Hourly curve under supplied conditions (see whatif_payload)."""
    return whatif_payload(req.is_weekend, req.temperature, req.precipitation)


# AWS Lambda entry point. API Gateway / Function URL -> Mangum -> this ASGI app.
handler = Mangum(app)
