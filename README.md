# Pondview pool arrival forecaster

Predicts how many families will arrive at a community pool in each open hour of a given
day, from the day's weather — and lets you explore what the model learned, or just ask it
in plain language. See the [live forecast page](https://pondviewforecast.vercel.app). The
model is a scikit-learn regressor served from AWS Lambda (a container image) behind a
small FastAPI service; the frontend is a Next.js app on Vercel. A Claude-backed assistant
sits on top, answering questions by calling the same forecast endpoints — with an eval
suite that checks it routes, extracts arguments, and refuses out-of-scope questions
correctly.

## Screenshots

Forecast view (live page):

<img src="docs/Screenshot 2026-08-07 111455.png"/>

What-if view:

<div>
  <img src="docs/what-if-g.gif"/>
</div>

## What it predicts — arrivals, not occupancy

The target is **family arrivals per hour**: the number of sign-in lines recorded in each
clock hour. It is deliberately **not occupancy**. The pool logs arrivals on paper
sign-in sheets but never records when a family leaves, so how many people are present at
any moment is unknown and unmodeled. Everything here — the data, the metrics, the API
response — is counts of arrivals, not people in the water.

## How it fits together

One repo, three tiers, deployed independently:

```
paper sign-in sheets
  model/  transcribe -> hourly table (arrivals + Open-Meteo weather) -> scikit-learn
          -> model.joblib + model_context.json (leave-one-day-out error, baseline, ranges)
  api/    FastAPI on AWS Lambda (container): GET /forecast, POST /whatif, POST /chat
          the assistant calls the two forecast paths in-process as tools
  evals/  graded cases for the assistant: routing, argument extraction, refusals
  web/    Next.js on Vercel: Forecast + What-if + Ask views, calling the Lambda URL
```

## The model (`model/`)

**Data.** The training table covers **250 observed hours across 29 days**, from
**2026-07-08 to 2026-08-16** — a few weeks of a single summer at one site. Those hours
hold **1,589 arrivals**, a mean of **6.36 arrivals/hour**, and **31 zero-arrival hours
(12.4%)**.

The hour grid comes from the day log, not from the arrivals, and that choice is the
intellectual core of the project. The zeros are informative. A day is included only when
its open and close hours are verified; **days the pool was closed, and days whose
sign-in sheet was lost, are left out entirely**, because we cannot say what happened
during them. But days the pool was open and *nobody came* are kept as genuine
zero-turnout hours. Dropping those would delete exactly the bad-weather signal the model
is meant to learn; inventing zeros for lost-sheet days would fabricate turnout that never
happened. Keeping only verified-open days — busy or empty — is the honest middle.

**Results.** Evaluated with leave-one-day-out cross-validation (29 folds, one per day);
MAE is mean absolute error in family arrivals per hour, lower is better.

| model | MAE (families/hour) |
| --- | --- |
| baseline (hour-of-day × weekend mean) | 3.86 (±1.54) |
| gradient-boosting model | 2.97 (±0.99) |
| improvement | 23.2% |

The baseline — a lookup table of average arrivals by hour and weekend/weekday — is
reported alongside the model every time; beating it by a modest, honest margin is the
result, not a disappointment. That margin **narrowed** when the season's data grew from
24 to 29 days: the model held roughly steady (2.91 → 2.97) while the baseline improved
markedly (4.24 → 3.86). More days make an hour × weekend lookup table more reliable, so
the bar the model has to clear rises — which is what you would expect, and worth stating
rather than quietly reporting the older, flattering number. The model's largest gains are
on **cool hours** (MAE **1.21** families/hour lower) and **weekends** (1.09 lower). A
feature ablation
([`model/ablation.py`](model/ablation.py)) confirms the edge comes from weather, not the
calendar: a weather-only model already beats the baseline, a calendar-only model does not.

**Method notes.** We split by day (never by row): hours in one afternoon share weather
and crowd, so a row-level split would leak a day's conditions into training. The deployed
artifact is fit on **all** rows — the folds exist only to evaluate honestly. Retraining
happens offline (`model/train.py`), roughly once a season; the model is baked into the
image, so the Lambda only ever predicts.

## The API (`api/`)

- `GET /forecast?day=YYYY-MM-DD` → per-hour `{hour, predicted, low, high}` plus a `basis`:
  - `forecast` — live Open-Meteo weather (in season, within ~16 days).
  - `typical` — in season but beyond the forecast horizon: the historical
    hour × weekend baseline, banded from its own spread. Returned instead of an error.
  - `closed` — outside the pool season: a calm closed state, no per-hour numbers.
- `POST /whatif` → the hourly curve under supplied conditions (weekend, temperature, rain
  on/off), with an `extrapolating` flag when the temperature is outside the observed range.
- `POST /chat` → a plain-language answer, plus the tools used and the `basis` behind it.
  See [the assistant](#the-assistant-apichatpy) below.
- `GET /health`, `GET /` — status and a self-describing landing payload.

The uncertainty bands are the model's **actual leave-one-day-out error per hour**, not
quantile-regression intervals — on 29 days those couldn't be calibrated, so we report the
error we can defend. Only genuinely malformed input returns `422`; season and horizon are
legitimate states, not client errors.

Weather comes from [Open-Meteo](https://open-meteo.com/) under their free API — see
Attribution below.

## The assistant (`api/chat.py`)

`POST /chat` answers questions like *"when is it least busy tomorrow?"* by calling the
same forecast logic the endpoints use — in-process, so season and horizon rules can't
drift between the two. It runs on **Claude Haiku 4.5** and is given two tools:

- **`query_forecast`** — a real date or range. The tool does the ranking and averaging;
  the model's job is turning a vague question into a window and a criterion, not
  arithmetic over seventy banded numbers.
- **`simulate_conditions`** — one or two hypothetical weather scenarios, compared. Any
  condition the asker didn't supply is filled from the season's averages and reported
  back in `defaults_applied`, so the assistant can't quietly adopt a temperature nobody
  gave it.

The system prompt is generated from the same constants `main.py` serves from — season,
posted hours, forecast horizon, and the model's own error — so its claims about the model
cannot drift from the model. Dates are pre-resolved into a table it reads rather than
computed, since date arithmetic is a reliable way for a small model to go wrong.

**What it won't answer.** Occupancy is the interesting refusal: this project predicts
arrivals and has no departure data, so "how many people are there right now?" is
redirected to the sibling [status dashboard](https://pondviewpool.vercel.app) that
actually observes the pool. Lifeguards, heating, and pool rules are declined outright
rather than guessed at.

**Evals (`evals/`).** 24 graded cases across routing, argument extraction, boundaries,
phrasing, and out-of-scope refusal. They assert on the **tool-call trace**, not just the
prose — which tool ran, with which arguments — because that is where the failures that
matter show up. One check verifies every number in an answer traces back to a tool result,
which is how a fabricated *"roughly a 75% drop"* got caught and fixed at the source.

```bash
.venv311\Scripts\python -m evals.run_evals --verbose        # the default model
.venv311\Scripts\python -m evals.run_evals --model claude-sonnet-5 --repeat 2
```

`--model` sweeps the same suite across models, which is the honest way to answer whether
the cheap one holds up; the runner reports pass rate by category and cost per question.

## The frontend (`web/`)

A Next.js + TypeScript app with three views behind a segmented control:

- **Forecast** — pick a day, see the banded hourly bar chart, with a real cold-start
  loading state for the Lambda. Suggested questions underneath carry the selected day
  through to the assistant, so the door to it sits where the question actually occurs.
- **What-if** — toggle weekend, drag a temperature slider (which shades the observed
  training range and flags extrapolation), and turn rain on/off, to watch the model's
  learned response live. Rain sharply lowers predicted turnout.
- **Ask** — the assistant, with example questions in the empty state (one of which it
  will decline, which teaches the boundary faster than a paragraph explaining it).

All three stay mounted so a conversation and the selected day survive tab switches. The
Ask view caps questions per day in the browser; that limit is a courtesy to stop honest
overuse, **not** a security control — the API URL ships in the bundle, so the real bounds
are the server's rate limit, the function's concurrency cap, and the account spend cap.

Busyness colours are theme-aware CSS variables split into `fill` (vivid, for bars) and
`ink` (contrast-safe, for text); a single palette failed WCAG AA as small text on the
light theme.

The frontend calls the backend by its deployed **Lambda URL** (an env var), and deploys
separately from the API — a `web/**` commit does not redeploy the Lambda (see
`.github/workflows/deploy-api.yml`).

## Limitations

- **One site.** A single community pool; nothing here is validated to transfer elsewhere.
- **One partial season.** 29 days of one summer — no holidays, no full-season arc, no
  year-over-year signal to learn from.
- **Arrivals, not occupancy.** No departure data, so nothing about how full the pool is.
- **Thin weather variance.** Temperature spans just 67–90 °F (std 4.4), and only **32 of
  250 hours (12.8%)** had measurable rain. The bands are rough typical error from
  cross-validation, **not** statistical confidence intervals, and the site assumes normal
  posted hours — it does not model day-specific early closures.
- **The assistant is only as good as the model underneath.** It phrases the same
  predictions more accessibly; it does not know anything the endpoints don't. The eval
  suite checks that it routes, extracts, and refuses correctly — not that the underlying
  forecast is right.

## Reproducing it

Requires **Python 3.11** (it matches the Lambda base image, and the model is pinned to
libraries with compatible Linux wheels). From the repository root:

```bash
py -3.11 -m venv .venv311
.venv311\Scripts\python -m pip install -r requirements.txt

# Only needed to run the assistant's eval suite:
.venv311\Scripts\python -m pip install -r requirements-dev.txt
```

The real sign-in data is resident pool data and is **not** in this repo. A small
**synthetic sample** (`model/data/sample/`) stands in so the pipeline runs end-to-end:
`build_dataset.py` uses the real data when present and otherwise falls back to the sample
(writing `hourly_sample.csv`, so it never touches the committed real aggregate).

```bash
# Build the hourly table. With the real data absent, this reads model/data/sample/.
.venv311\Scripts\python model\build_dataset.py

# Train + evaluate (baseline vs model), write model.joblib + model_context.json.
# Runs from the committed model/data/processed/hourly.csv -- no raw data needed.
.venv311\Scripts\python model\train.py

# Serve the API locally (ALLOWED_ORIGINS enables CORS for a browser frontend).
.venv311\Scripts\python -m uvicorn api.main:app --reload --port 8000
```

`curl "http://127.0.0.1:8000/forecast?day=2026-08-06"` returns a banded forecast; `/docs`
is the interactive UI.

**The assistant is optional.** `/chat` needs an Anthropic API key; without one it returns
`503` and every other endpoint is unaffected, so a deployment that omits it degrades
rather than breaks. The key is read from the environment and is deliberately **not** set
in the Dockerfile — an `ENV` line would bake the secret into an image layer. Set it on
the Lambda function (or export it locally):

```bash
set ANTHROPIC_API_KEY=sk-ant-...
.venv311\Scripts\python -m evals.run_evals
```

The chat path also needs a longer Lambda timeout than the default (~30s covers two model
round trips plus a weather fetch), and — because every request costs money — reserved
concurrency on the function plus a spend cap on the Anthropic account.

## Repository layout

```
model/  fetch_weather.py     pull hourly weather from Open-Meteo
        build_dataset.py     join arrivals + weather into the hourly table
        train.py             baseline, leave-one-day-out eval, model + context sidecar
        ablation.py          does weather (vs the calendar) earn its place?
        model.joblib         the deployed model (fit on all rows)
        model_context.json   LOO error per hour, baseline, seasonal ranges
        data/processed/hourly.csv   the committed de-identified aggregate
        data/sample/                synthetic stand-in for the resident data
        notebooks/findings.ipynb    narrative walkthrough with charts
api/    main.py              FastAPI service: /forecast, /whatif, /chat
        aggregate.py         pure ranking/filtering over forecast payloads (no model,
                             no network -- testable against fabricated days)
        prompt.py            the assistant's system prompt, built from main.py's
                             constants so its claims can't drift from the API's
        tools.py             tool schemas + dispatch
        chat.py              the agent loop; returns the tool trace, not just text
        Dockerfile requirements.txt        Lambda container image
evals/  cases.yaml           24 graded cases for the assistant
        run_evals.py         asserts on the tool trace; --model sweeps models
web/    Next.js frontend (Forecast + What-if + Ask)
```

## Attribution and license

Weather data by [Open-Meteo.com](https://open-meteo.com/), used under their terms
([CC BY 4.0](https://open-meteo.com/en/license)). This project is released under the MIT
License (see `LICENSE`).
