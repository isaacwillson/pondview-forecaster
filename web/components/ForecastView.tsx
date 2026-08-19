"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getForecast } from "@/lib/api";
import type { ForecastResponse, HourPrediction } from "@/lib/types";
import { dayPhrase, longDate, toISODate, upcomingDays, hour12 } from "@/lib/format";
import { busyness } from "@/lib/busyness";
import { DaySelector } from "./DaySelector";
import { HourlyStrip } from "./HourlyStrip";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ForecastResponse };

export function ForecastView({ onAsk }: { onAsk: (question: string) => void }) {
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
    <div className="space-y-4 lg:space-y-6">
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

      {/* The door to the assistant, placed where the question actually occurs to
          someone: just under the numbers they were reading. A tab alone is easy to
          miss, and it also loses the day they had selected. Shown only once real
          numbers are on screen -- inviting follow-ups about a closed day is noise. */}
      {state.kind === "ready" && state.data.basis !== "closed" ? (
        <SuggestedQuestions iso={selected} onAsk={onAsk} />
      ) : null}
    </div>
  );
}

function SuggestedQuestions({
  iso,
  onAsk,
}: {
  iso: string;
  onAsk: (question: string) => void;
}) {
  const phrase = dayPhrase(iso);
  // "today afternoon" is not English; everything else works unchanged.
  const afternoon = phrase === "today" ? "this" : phrase;
  const questions = [
    `When should I go ${phrase}?`,
    `Is ${afternoon} afternoon crowded?`,
    // Deliberately day-independent: it is the one that shows the what-if side exists.
    "Does rain actually keep people away?",
  ];

  return (
    <section className="rounded-4xl bg-surface/60 p-5 shadow-soft backdrop-blur lg:p-6">
      <p className="text-sm font-bold text-ink lg:text-base">Ask about it</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {questions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            className="rounded-2xl bg-surface-2 px-4 py-2.5 text-left text-sm font-semibold text-ink transition hover:bg-surface lg:text-base"
          >
            {q}
          </button>
        ))}
      </div>
    </section>
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

  // Desktop puts the summary beside the chart; phone keeps them stacked.
  return (
    <div className="space-y-4 lg:grid lg:grid-cols-12 lg:items-stretch lg:gap-6 lg:space-y-0">
      <section className="rounded-4xl bg-surface/80 p-6 shadow-soft backdrop-blur lg:col-span-4 lg:p-8">
        <p className="font-bold text-ink lg:text-lg">{longDate(data.day)}</p>

        {peak && quiet ? (
          <>
            <p className="mt-4 text-sm font-semibold text-muted lg:mt-8">Busiest time</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1 lg:mt-2 lg:block lg:space-y-1">
              <span
                className="text-4xl font-extrabold leading-none lg:text-5xl"
                style={{ color: peakB?.color }}
              >
                {peakB?.label}
              </span>
              <span className="pb-0.5 text-lg font-bold text-ink lg:block lg:pb-0 lg:text-xl">
                around {hour12(peak.hour)}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:mt-8">
              <MiniStat label="Busiest" hour={peak.hour} value={peak.predicted} />
              <MiniStat label="Quietest" hour={quiet.hour} value={quiet.predicted} />
            </div>
          </>
        ) : (
          <p className="mt-4 text-muted">No open hours to show for this day.</p>
        )}
      </section>

      {preds.length > 0 ? (
        <section className="flex flex-col rounded-4xl bg-surface/80 p-5 shadow-soft backdrop-blur lg:col-span-8 lg:p-8">
          <div className="mb-3 flex items-center justify-between lg:mb-6">
            <h2 className="font-bold text-ink lg:text-lg">Hour by hour</h2>
            <span className="text-xs font-semibold text-muted lg:text-sm">families arriving</span>
          </div>
          <HourlyStrip predictions={preds} />
          <p className="mt-3 text-xs text-muted lg:mt-6 lg:text-sm">
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
    <div className="rounded-2xl p-3 lg:p-4" style={{ background: b.soft }}>
      <p className="text-xs font-semibold text-muted lg:text-sm">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold text-ink lg:text-xl">{hour12(hour)}</p>
      <p className="text-sm font-bold" style={{ color: b.color }}>
        {b.label} · ~{Math.round(value)}/hr
      </p>
    </div>
  );
}

function ClosedCard({ day, message }: { day: string; message?: string }) {
  return (
    <section className="rounded-4xl bg-surface/80 p-8 text-center shadow-soft backdrop-blur lg:py-20">
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
    // Mirrors ReadyCard's grid so nothing jumps when the data lands.
    <div className="space-y-4 lg:grid lg:grid-cols-12 lg:items-stretch lg:gap-6 lg:space-y-0">
      <section className="rounded-4xl bg-surface/60 p-6 shadow-soft lg:col-span-4 lg:p-8">
        <div className="h-4 w-40 animate-pulse rounded-full bg-surface-2" />
        <div className="mt-4 h-9 w-52 animate-pulse rounded-full bg-surface-2 lg:mt-8 lg:h-12" />
        <div className="mt-5 grid grid-cols-2 gap-3 lg:mt-8">
          <div className="h-20 animate-pulse rounded-2xl bg-surface-2 lg:h-24" />
          <div className="h-20 animate-pulse rounded-2xl bg-surface-2 lg:h-24" />
        </div>
      </section>
      <section className="rounded-4xl bg-surface/60 p-5 shadow-soft lg:col-span-8 lg:p-8">
        <div className="flex h-[112px] items-end gap-2 lg:h-[220px] lg:gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="w-7 animate-pulse rounded-full bg-surface-2 md:w-full md:max-w-[3rem] md:flex-1"
              style={{ height: `${35 + ((i * 13) % 60)}%` }}
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
      className="rounded-4xl bg-surface/80 p-8 text-center shadow-soft backdrop-blur lg:py-20"
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
