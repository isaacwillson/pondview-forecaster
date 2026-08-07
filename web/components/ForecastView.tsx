"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getForecast } from "@/lib/api";
import type { ForecastResponse, HourPrediction } from "@/lib/types";
import { hourLabel, longDate, nextOpenDay } from "@/lib/format";
import { ArrivalsChart } from "./ArrivalsChart";
import { BasisBadge } from "./BasisBadge";
import { ChartSkeleton } from "./ChartSkeleton";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ForecastResponse };

export function ForecastView() {
  const [day, setDay] = useState<string>(() => nextOpenDay(new Date()));
  const [state, setState] = useState<State>({ kind: "loading" });
  const [slow, setSlow] = useState(false);

  const load = useCallback((target: string) => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    getForecast(target, controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof ApiError ? err.message : "Something went wrong.",
        });
      })
      .finally(() => clearTimeout(slowTimer));
    return () => {
      controller.abort();
      clearTimeout(slowTimer);
    };
  }, []);

  useEffect(() => load(day), [day, load]);

  const ready = state.kind === "ready" ? state.data : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="flex flex-col gap-1 text-sm text-muted">
          <span>Forecast for</span>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="w-[11rem] rounded-md border border-line bg-surface px-3 py-1.5 font-sans text-base text-ink"
          />
        </label>
        {ready ? <BasisBadge basis={ready.basis} /> : null}
      </div>

      <div className="mt-6 rounded-lg border border-line bg-surface p-5">
        {state.kind === "loading" ? (
          <ChartSkeleton
            hint={
              slow
                ? "Waking the forecast service — the first request can take a few seconds."
                : undefined
            }
          />
        ) : state.kind === "error" ? (
          <ErrorPanel message={state.message} onRetry={() => load(day)} />
        ) : state.data.basis === "closed" ? (
          <ClosedPanel data={state.data} />
        ) : (
          <ForecastReady data={state.data} />
        )}
      </div>
    </div>
  );
}

function ForecastReady({ data }: { data: ForecastResponse }) {
  const predictions: HourPrediction[] = data.predictions ?? [];
  const busiest = predictions.reduce<HourPrediction | null>(
    (best, p) => (best === null || p.predicted > best.predicted ? p : best),
    null,
  );
  const total = Math.round(predictions.reduce((s, p) => s + p.predicted, 0));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <h2 className="font-display text-lg text-ink">{longDate(data.day)}</h2>
        <dl className="flex gap-8 text-sm">
          <div>
            <dt className="text-muted">Busiest hour</dt>
            <dd className="tnum font-medium text-ink">
              {busiest ? `${hourLabel(busiest.hour)} · ${busiest.predicted.toFixed(1)}/hr` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Day total</dt>
            <dd className="tnum font-medium text-ink">≈ {total}</dd>
          </div>
        </dl>
      </div>
      <ArrivalsChart
        predictions={predictions}
        ariaLabel={`Predicted family arrivals per hour for ${longDate(data.day)}.`}
      />
      <p className="mt-3 text-xs text-muted">
        Bars are predicted family arrivals per hour; the soft band is the model&rsquo;s
        typical cross-validation error.
      </p>
    </div>
  );
}

function ClosedPanel({ data }: { data: ForecastResponse }) {
  return (
    <div className="py-6">
      <BasisBadge basis="closed" />
      <p className="mt-4 max-w-[48ch] text-ink">
        {data.message ?? "The pool is closed on this date."}
      </p>
      <p className="mt-2 text-sm text-muted">
        Pick a date in season to see an hourly forecast.
      </p>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-6" role="alert">
      <p className="font-medium text-ink">Couldn&rsquo;t load the forecast</p>
      <p className="mt-1 max-w-[48ch] text-sm text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md border border-line bg-paper px-3.5 py-1.5 text-sm font-medium text-ink hover:border-muted"
      >
        Try again
      </button>
    </div>
  );
}
