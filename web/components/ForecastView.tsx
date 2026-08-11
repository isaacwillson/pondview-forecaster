"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getForecast } from "@/lib/api";
import type { ForecastResponse, HourPrediction } from "@/lib/types";
import { longDate, toISODate, upcomingDays, hour12 } from "@/lib/format";
import { busyness } from "@/lib/busyness";
import { DaySelector } from "./DaySelector";
import { HourlyStrip } from "./HourlyStrip";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ForecastResponse };

export function ForecastView() {
  const days = useMemo(() => upcomingDays(new Date(), 8), []);
  const [selected, setSelected] = useState<string>(() => toISODate(new Date()));
  const [state, setState] = useState<State>({ kind: "loading" });
  const [slow, setSlow] = useState(false);

  const load = useCallback((iso: string) => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    getForecast(iso, controller.signal)
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

  useEffect(() => load(selected), [selected, load]);

  return (
    <div className="space-y-4">
      <DaySelector days={days} selected={selected} onSelect={setSelected} />

      {state.kind === "loading" ? (
        <LoadingCard slow={slow} />
      ) : state.kind === "error" ? (
        <ErrorCard message={state.message} onRetry={() => load(selected)} />
      ) : state.data.basis === "closed" ? (
        <ClosedCard day={state.data.day} message={state.data.message} />
      ) : (
        <ReadyCard data={state.data} />
      )}
    </div>
  );
}

function ReadyCard({ data }: { data: ForecastResponse }) {
  const preds: HourPrediction[] = data.predictions ?? [];
  const peak = preds.reduce<HourPrediction | null>(
    (best, p) => (best === null || p.predicted > best.predicted ? p : best),
    null,
  );
  const quiet = preds.reduce<HourPrediction | null>(
    (low, p) => (low === null || p.predicted < low.predicted ? p : low),
    null,
  );
  const peakB = peak ? busyness(peak.predicted) : null;

  return (
    <div className="space-y-4">
      <section className="rounded-4xl bg-surface/80 p-6 shadow-soft backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="font-bold text-ink">{longDate(data.day)}</p>
          <BasisPill basis={data.basis} />
        </div>

        {peak && quiet ? (
          <>
            <p className="mt-4 text-sm font-semibold text-muted">Busiest time</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span
                className="text-4xl font-extrabold leading-none"
                style={{ color: peakB?.color }}
              >
                {peakB?.label}
              </span>
              <span className="pb-0.5 text-lg font-bold text-ink">
                around {hour12(peak.hour)}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniStat label="Busiest" hour={peak.hour} value={peak.predicted} />
              <MiniStat label="Quietest" hour={quiet.hour} value={quiet.predicted} />
            </div>
          </>
        ) : (
          <p className="mt-4 text-muted">No open hours to show for this day.</p>
        )}
      </section>

      {preds.length > 0 ? (
        <section className="rounded-4xl bg-surface/80 p-5 shadow-soft backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">Hour by hour</h2>
            <span className="text-xs font-semibold text-muted">families arriving</span>
          </div>
          <HourlyStrip predictions={preds} />
          <p className="mt-3 text-xs text-muted">
            {data.basis === "typical"
              ? "This far out we don’t have live weather yet, so this is a typical day like this one."
              : "A rough guide from past summers and today’s weather — actual numbers vary."}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function MiniStat({ label, hour, value }: { label: string; hour: number; value: number }) {
  const b = busyness(value);
  return (
    <div className="rounded-2xl p-3" style={{ background: b.soft }}>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold text-ink">{hour12(hour)}</p>
      <p className="text-sm font-bold" style={{ color: b.color }}>
        {b.label} · ~{Math.round(value)}/hr
      </p>
    </div>
  );
}

function BasisPill({ basis }: { basis: "forecast" | "typical" | "closed" }) {
  const map = {
    forecast: { text: "Live forecast", dot: "#4cb96a" },
    typical: { text: "Typical day", dot: "#6ba8dd" },
    closed: { text: "Closed", dot: "#98a7b0" },
  } as const;
  const { text, dot } = map[basis];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-bold text-ink">
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
      {text}
    </span>
  );
}

function ClosedCard({ day, message }: { day: string; message?: string }) {
  return (
    <section className="rounded-4xl bg-surface/80 p-8 text-center shadow-soft backdrop-blur">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-2xl">
        🌙
      </div>
      <h2 className="text-xl font-extrabold text-ink">Closed for the season</h2>
      <p className="mx-auto mt-2 max-w-xs text-muted">
        {message ?? "The pool isn’t open on this date."} See you next summer!
      </p>
      <p className="mt-3 text-sm text-muted">{longDate(day)}</p>
    </section>
  );
}

function LoadingCard({ slow }: { slow: boolean }) {
  return (
    <div className="space-y-4">
      <section className="rounded-4xl bg-surface/60 p-6 shadow-soft">
        <div className="h-4 w-40 animate-pulse rounded-full bg-surface-2" />
        <div className="mt-4 h-9 w-52 animate-pulse rounded-full bg-surface-2" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="h-20 animate-pulse rounded-2xl bg-surface-2" />
          <div className="h-20 animate-pulse rounded-2xl bg-surface-2" />
        </div>
      </section>
      <section className="rounded-4xl bg-surface/60 p-5 shadow-soft">
        <div className="flex items-end gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="w-7 animate-pulse rounded-full bg-surface-2"
              style={{ height: `${40 + ((i * 13) % 70)}px` }}
            />
          ))}
        </div>
        {slow ? (
          <p className="mt-4 text-sm text-muted">Waking up the forecast — one moment…</p>
        ) : null}
      </section>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section
      className="rounded-4xl bg-surface/80 p-8 text-center shadow-soft backdrop-blur"
      role="alert"
    >
      <h2 className="text-lg font-extrabold text-ink">Couldn’t load the forecast</h2>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-full bg-ink px-5 py-2 text-sm font-bold text-surface"
      >
        Try again
      </button>
    </section>
  );
}
