# Pondview pool arrival forecaster

Predicts how many families will arrive at a community pool in each open hour of a
given day, from the day's weather. See the [live forecast page]([FILL: Vercel URL]).
The model is a scikit-learn regressor packaged as a container image and served from
AWS Lambda behind a small FastAPI service.

## Screenshots

Live forecast page:

![live forecast page]([FILL: path])

FastAPI interactive docs (`/docs`):

![FastAPI docs]([FILL: path])

## What this predicts

The target is **family arrivals per hour** -- the number of sign-in lines recorded in
each clock hour. It is deliberately **not occupancy**: the pool logs arrivals on paper
sign-in sheets but never records when a family leaves, so the number present at any
moment is unknown and unmodeled. Everything here -- the data, the metrics, the API
response -- is counts of arrivals, not people in the water.

## Architecture

```
paper sign-in sheets
   -> transcribed CSV (one row per arrival) + a day log (verified open/close hours)
   -> pandas builds an hourly table: arrivals joined to Open-Meteo weather
   -> scikit-learn HistGradientBoostingRegressor, saved as a joblib artifact
   -> Docker image (the model is baked in) on public.ecr.aws/lambda/python:3.11
   -> AWS Lambda + FastAPI: GET /forecast?day=YYYY-MM-DD
   -> Next.js page on Vercel calls the endpoint and renders the hourly forecast
```

A diagram of the same flow lives at `docs/[FILL: path]` (architecture.png).

## Data

The training table covers **197 observed hours across 24 days**, from **2026-07-08 to
2026-08-04** -- a few weeks of a single summer at one site. Those hours hold **1,166
arrivals**, a mean of **5.92 arrivals/hour**, and **39 zero-arrival hours (19.8%)**.

The hour grid comes from the day log, not from the arrivals, and that choice is the
intellectual core of the project. The zeros are informative. A day is included only when
its open and close hours are verified; **days the pool was closed, and days whose
sign-in sheet was lost, are left out entirely**, because we cannot say what happened
during them. But days the pool was open and *nobody came* are kept as genuine
zero-turnout hours. Dropping those would delete exactly the bad-weather signal the model
is meant to learn; inventing zeros for lost-sheet days would fabricate turnout that never
happened. Keeping only verified-open days -- busy or empty -- is the honest middle.

## Results

Evaluated with leave-one-day-out cross-validation (24 folds, one per day). MAE is mean
absolute error in family arrivals per hour; lower is better.

| model | MAE (families/hour) |
| --- | --- |
| baseline (hour-of-day x weekend mean) | 4.24 (±1.94) |
| gradient-boosting model | 2.91 (±1.63) |
| improvement | 31.4% |

The baseline is a lookup table of average arrivals by hour and weekend/weekday, and it
is reported alongside the model every time -- beating it by a modest, honest margin is
the result, not a disappointment. The model's largest gains are on **cool hours** (MAE
**1.40 families/hour** lower than the baseline) and **weekends** (1.27 lower). A feature
ablation (`src/ablation.py`) confirms the edge comes from weather rather than the
calendar: a weather-only model already beats the baseline, while a calendar-only model
does not.

## Methodology

**Leave-one-day-out, grouped by date.** Hours within the same afternoon share the same
weather and the same crowd, so splitting individual hours into train and test would
leak: the model could see a rainy day's other hours while predicting one of them, and
report an accuracy it would never achieve on a genuinely unseen day. Holding out whole
days removes that leak, and with only 24 days it is cheap and more stable than k-fold.

**Model baked in at build time, not trained per request.** Training happens offline;
`src/train.py` writes `models/model.joblib`, and the Docker image copies that artifact
in. The Lambda function loads it once on cold start and only ever predicts. The model is
retrained roughly once a season, when a new batch of sign-in sheets is transcribed. The
tradeoff is deliberate: fast cold starts and a reproducible image, at the cost of the
model being only as fresh as its last retrain rather than continuously updated.

## Limitations

- **One site.** A single community pool; nothing here is validated to transfer elsewhere.
- **One partial season.** 24 days of a single summer. Patterns from a longer record --
  holidays, a full-season arc, year-over-year change -- cannot be learned from this.
- **Arrivals, not occupancy.** No departure data exists, so the model says nothing about
  how full the pool is at a given moment, only how many families arrive.
- **Little weather variance in mid-summer.** Temperature spans just 67-90 F (std 4.3 F),
  so temperature cannot explain much; the usable weather signal is mostly rain, and only
  **23 of 197 hours (11.7%)** had measurable precipitation. Large weather-driven gains
  are not on the table with this window, and the results should be read with that in mind.

## Running it

Requires **Python 3.11** (it matches the Lambda base image, and the model is pinned to
libraries with compatible Linux wheels). From the repository root:

```bash
py -3.11 -m venv .venv311
.venv311\Scripts\python -m pip install -r requirements.txt
```

Then:

```bash
# 1. Fetch historical weather for the season (needs internet) -> data/interim/weather.csv
.venv311\Scripts\python src\fetch_weather.py

# 2. Build the hourly modeling table -> data/processed/hourly.csv
#    Needs the raw sign-in CSVs, which are resident pool data and are NOT in this repo.
.venv311\Scripts\python src\build_dataset.py

# 3. Train + evaluate (baseline vs model) and write models/model.joblib
#    Runs from the committed data/processed/hourly.csv -- no raw data required.
.venv311\Scripts\python src\train.py

# 4. Serve the API locally
.venv311\Scripts\python -m uvicorn api.main:app --reload --port 8000
```

The processed table (`data/processed/hourly.csv`) and the trained model
(`models/model.joblib`) are committed, so steps 3 and 4 reproduce the results and run the
service without the raw data. `curl "http://127.0.0.1:8000/forecast?day=2026-08-06"`
returns the hourly forecast; `/docs` is the interactive UI.

## Repository layout

```
src/fetch_weather.py       pull hourly weather from the Open-Meteo archive
src/build_dataset.py       join arrivals + weather into the hourly table
src/train.py               baseline, leave-one-day-out evaluation, final model
src/ablation.py            does weather (vs the calendar) actually earn its place?
api/main.py                FastAPI service: /forecast and /health
api/Dockerfile             Lambda container image
notebooks/findings.ipynb   narrative walkthrough with charts
```
