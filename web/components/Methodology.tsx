"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";
import { LIVE_OCCUPANCY_DAYS, SOURCE_REPO_URL, STATUS_DASHBOARD_URL } from "@/lib/site";

/**
 * The model card.
 *
 * All of this project's actual rigour -- the baseline it has to beat, the leave-one-day-out
 * split, the ablation, the limits -- used to live only in the README, which means anyone
 * who opened the deployed link saw a pretty forecast and no evidence that any of it was
 * done carefully. This panel puts the evidence on the page.
 *
 * The figures are read from `GET /health`, which reports the metadata of the artifact the
 * service actually loaded, rather than being typed in here. That is the difference between
 * a claim and a measurement: retrain the model and this panel moves with it, and it cannot
 * quietly keep advertising a number the deployed model no longer earns.
 */

/**
 * Show an error figure exactly as the service reports it, trimming only trailing zeros.
 *
 * Deliberately NOT `toFixed(2)`. The stored value is 2.965, whose nearest double is
 * 2.96499..., so `toFixed(2)` renders "2.96" while the README's table -- rounded from the
 * full-precision value -- says 2.97. Two of this project's own surfaces disagreeing in the
 * last digit of its headline metric is exactly the detail that costs you the benefit of
 * the doubt. Printing the stored number makes the rounding question disappear.
 */
function formatMae(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

/** API feature names -> what to call them in front of a reader. */
const FEATURE_LABELS: Record<string, string> = {
  hour: "hour of day",
  is_weekend: "weekend",
  temperature_2m: "temperature",
  precipitation: "rain",
  relative_humidity_2m: "humidity",
  cloud_cover: "cloud cover",
  wind_speed_10m: "wind speed",
};

export function Methodology() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then(setHealth)
      .catch(() => {
        // Leave the figures out rather than showing placeholders. The prose below is
        // true whether or not the service answered.
      });
    return () => controller.abort();
  }, []);

  const meta = health?.trained_on ?? null;
  const improvement = meta
    ? ((meta.cv_baseline_mae - meta.cv_model_mae) / meta.cv_baseline_mae) * 100
    : null;
  const features = (health?.model_features ?? []).map((f) => FEATURE_LABELS[f] ?? f);

  return (
    <section className="mt-6 rounded-card border border-line bg-surface lg:mt-10">
      <div className="border-b border-line px-5 py-4 lg:px-8 lg:py-6">
        <h2 className="text-base font-semibold tracking-tight text-ink lg:text-lg">
          How this works
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted lg:text-[0.95rem]">
          A gradient-boosting regressor predicts how many families{" "}
          <strong className="font-medium text-ink-2">arrive each hour</strong>, from the
          hour, the day type, and the day&rsquo;s weather. It was trained on a season of
          pool sign-in sheets. The figures below are read live from the deployed model.
        </p>
      </div>

      {meta && improvement !== null ? (
        <dl className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
          <Metric
            label="Model error"
            value={formatMae(meta.cv_model_mae)}
            note="mean absolute error, arrivals/hour"
          />
          <Metric
            label="Baseline error"
            value={formatMae(meta.cv_baseline_mae)}
            note="hour × weekend lookup table"
          />
          <Metric
            label="Improvement"
            value={`${improvement.toFixed(1)}%`}
            note="over that baseline"
          />
          <Metric
            label="Training data"
            value={meta.n_observations.toLocaleString()}
            note={`open hours across ${meta.n_days} days`}
          />
        </dl>
      ) : null}

      <div className="grid gap-px bg-line lg:grid-cols-3">
        <Panel title="How it was validated">
          <p>
            Leave-one-day-out cross-validation
            {meta ? ` — ${meta.n_days} folds, one per day` : ""}. Splitting by row would
            leak: hours in the same afternoon share weather and the same crowd, so a
            random split lets the model train on part of the day it is being scored on
            and reports a flattering number.
          </p>
          <p>
            The baseline is reported next to the model every single time. Beating a
            sensible lookup table by a modest, honest margin is the result — and that
            margin <em>narrowed</em> as the season grew, because more days make the
            lookup table better too.
          </p>
        </Panel>

        <Panel title="What it uses">
          <p>
            {features.length > 0 ? (
              <>
                Seven features: <span className="text-ink-2">{features.join(", ")}</span>.
              </>
            ) : (
              "Hour of day and weekend flag, plus the day's weather."
            )}
          </p>
          <p>
            An ablation settles whether the weather earns its place: a weather-only model
            already beats the baseline, and a calendar-only model does not. The gains are
            largest exactly where a lookup table has nothing to say — cool hours (1.21
            arrivals/hour better) and weekends (1.09 better).
          </p>
        </Panel>

        <Panel title="What it can't do">
          <p>
            It predicts <strong className="font-medium text-ink-2">arrivals</strong>, not
            occupancy — people leave whenever they like, and the sign-in sheets never
            recorded that. For how full the pool is right now, the{" "}
            <a
              className="text-accent-ink underline underline-offset-2"
              href={STATUS_DASHBOARD_URL}
              target="_blank"
              rel="noreferrer"
            >
              live dashboard
            </a>{" "}
            counts people, on {LIVE_OCCUPANCY_DAYS}.
          </p>
          <p>
            One pool, one season, and temperatures between 67 and 90°F — outside that
            range it is extrapolating and says so. The line through each bar is the
            model&rsquo;s typical error for that hour, not a calibrated confidence
            interval. Past the 15-day weather horizon it falls back to a typical day
            rather than inventing one.
          </p>
        </Panel>
      </div>

      <p className="px-5 py-4 text-xs text-muted lg:px-8 lg:py-5">
        Weather by{" "}
        <a
          className="text-accent-ink underline underline-offset-2"
          href="https://open-meteo.com"
          target="_blank"
          rel="noreferrer"
        >
          Open-Meteo
        </a>{" "}
        (CC BY 4.0). Data, notebook, training code and evals are on{" "}
        <a
          className="text-accent-ink underline underline-offset-2"
          href={SOURCE_REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        {meta ? ` · scikit-learn ${meta.sklearn_version}` : ""}.
      </p>
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    // Proportional figures on purpose: tabular digits give every glyph the width of a
    // zero, which makes a value like 23.2% look loosely spaced at this size. Tabular is
    // for the axis ticks and table rows, where numbers stack vertically.
    <div className="border-b border-line px-5 py-4 last:border-b-0 odd:border-r lg:border-b-0 lg:border-r lg:px-8 lg:py-6 lg:last:border-r-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-ink lg:text-3xl">
        {value}
      </dd>
      <dd className="mt-1.5 text-xs leading-snug text-muted">{note}</dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-5 lg:px-8 lg:py-6">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2.5 text-sm leading-relaxed text-muted">{children}</div>
    </div>
  );
}
