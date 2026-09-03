"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import posthog from "posthog-js";
import { ApiError, getForecast } from "@/lib/api";
import type { ForecastResponse, HourPrediction } from "@/lib/types";
import { dayPhrase, longDate, toISODate, upcomingDays, hour12 } from "@/lib/format";
import { busyness, BUSYNESS_LEGEND } from "@/lib/busyness";
import { STATUS_DASHBOARD_URL } from "@/lib/site";
import { DaySelector } from "./DaySelector";
import { HourlyChart } from "./HourlyChart";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ForecastResponse };

export function ForecastView({ onAsk }: { onAsk: (question: string) => void }) {
  const days = useMemo(() => upcomingDays(new Date(), 8), []);
  const [selected, setSelected] = useState<string>(() => toISODate(new Date()));
  const [state, setState] = useState<State>({ kind: "loading" });
  const [slow, setSlow] = useState(false);

  const handleDaySelect = useCallback((iso: string) => {
    const todayIso = toISODate(new Date());
    const msPerDay = 86_400_000;
    const dayOffset = Math.round(
      (new Date(iso).getTime() - new Date(todayIso).getTime()) / msPerDay,
    );
    posthog.capture("forecast_day_selected", {
      day_offset: dayOffset,
      is_today: dayOffset === 0,
    });
    setSelected(iso);
  }, []);

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
    <div className="space-y-3 lg:space-y-4">
      <DaySelector days={days} selected={selected} onSelect={handleDaySelect} />

      {state.kind === "loading" ? (
        <LoadingCard slow={slow} />
      ) : state.kind === "error" ? (
        <ErrorCard
          message={state.message}
          onRetry={() => {
            posthog.capture("forecast_error_retried");
            load(selected);
          }}
        />
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
    <section className="rounded-card border border-line bg-surface px-4 py-3.5 lg:px-6 lg:py-4">
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-4">
        <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted">
          Ask about it
        </p>
        {/* Wrapping put each question on its own row on a phone -- three stacked bars for
            a secondary action. Scrolling sideways instead keeps all three but costs one
            row, reusing the day picker's idiom (and its edge bleed) so it reads as a
            familiar control rather than a new one. */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-x-visible md:px-0">
          {questions.map((q, index) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                posthog.capture("suggested_question_clicked", { question_index: index });
                onAsk(q);
              }}
              className="shrink-0 whitespace-nowrap rounded border border-line bg-surface-2 px-3 py-1.5 text-left text-sm text-ink-2 transition hover:border-axis hover:text-ink md:whitespace-normal"
            >
              {q}
            </button>
          ))}
        </div>
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
    <div className="space-y-3 lg:grid lg:grid-cols-12 lg:items-stretch lg:gap-4 lg:space-y-0">
      <section className="rounded-card border border-line bg-surface p-5 lg:col-span-4 lg:p-6">
        {/* Hidden on mobile: the day picker sits directly above with this date already
            selected, so restating it is a third echo on a small screen. Desktop keeps
            it, where the card sits beside the chart and needs its own anchor. */}
        <p className="hidden text-sm font-medium text-ink lg:block">{longDate(data.day)}</p>

        {peak && quiet && peakB ? (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-muted lg:mt-6">
              Busiest time
            </p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 lg:mt-2 lg:block">
              <span className="flex items-center gap-2">
                {/* The swatch carries the level; the word stays ink. Colouring the text
                    itself fails contrast at the light end of the ramp and makes the
                    type read as decoration rather than as a reading. */}
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: peakB.fill }}
                  aria-hidden="true"
                />
                <span className="text-3xl font-semibold leading-none tracking-tight text-ink lg:text-4xl">
                  {peakB.label}
                </span>
              </span>
              <span className="text-base text-muted lg:mt-1.5 lg:block lg:text-lg">
                around {hour12(peak.hour)}
              </span>
            </div>

            {/* The headline above already answers "when is it busiest", so on a phone
                the Busiest tile repeats it a few pixels lower. Desktop keeps the pair,
                where they sit beside the chart and read as a summary rather than an
                echo. */}
            <div className="mt-4 grid grid-cols-1 divide-y divide-line border-t border-line lg:mt-6 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              <div className="hidden lg:block">
                <MiniStat label="Busiest" hour={peak.hour} value={peak.predicted} />
              </div>
              <MiniStat label="Quietest" hour={quiet.hour} value={quiet.predicted} />
            </div>

            <ScaleKey />
          </>
        ) : (
          <p className="mt-4 text-sm text-muted">No open hours to show for this day.</p>
        )}
      </section>

      {preds.length > 0 ? (
        <section className="flex flex-col rounded-card border border-line bg-surface p-4 lg:col-span-8 lg:p-6">
          <div className="mb-4 flex items-baseline justify-between gap-3 lg:mb-6">
            <h2 className="text-sm font-semibold text-ink">Predicted arrivals by hour</h2>
            <span className="shrink-0 text-xs text-muted">
              families/hour
              {data.basis === "typical" ? " · typical day" : ""}
            </span>
          </div>
          <HourlyChart predictions={preds} />
          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">
            {data.basis === "typical"
              ? "No live weather this far ahead, so this is a typical day like this one rather than a real forecast."
              : "The line through each bar is the model’s typical error for that hour, so a long line means an hour it is less sure about."}{" "}
            {/* The caveat above raises the obvious question -- how full is it *now* --
                so the answer goes right here rather than in a separate banner. */}
            It predicts arrivals, not how full the pool is.{" "}
            <a
              href={STATUS_DASHBOARD_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent-ink underline underline-offset-2"
              onClick={() => posthog.capture("live_dashboard_link_clicked")}
            >
              See the live dashboard
            </a>
            .
          </p>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The busyness ramp, end to end.
 *
 * A single-series chart needs no legend -- bar height already carries the magnitude. What
 * this explains is the *other* thing the page says: the word. "Quiet" beside a swatch is
 * only meaningful once you can see it is the bottom of a five-step scale, so this is a
 * scale key rather than a series legend, and it earns its place by naming the two ends
 * rather than restating what the axis says.
 *
 * Desktop only. On a phone it would be a sixth stacked row on a screen the whole point
 * of which is to answer one question quickly.
 */
function ScaleKey() {
  // Indexed reads are checked under `noUncheckedIndexedAccess`, so the ends are pulled
  // out and rendered optionally rather than asserted non-null.
  const quietEnd = BUSYNESS_LEGEND[0];
  const packedEnd = BUSYNESS_LEGEND[BUSYNESS_LEGEND.length - 1];
  return (
    <div className="mt-6 hidden lg:block">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Scale</p>
      <div className="mt-2 flex gap-0.5" aria-hidden="true">
        {BUSYNESS_LEGEND.map((b) => (
          <span key={b.level} className="h-1.5 flex-1" style={{ background: b.fill }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{quietEnd?.label}</span>
        <span>{packedEnd?.label}</span>
      </div>
    </div>
  );
}

function MiniStat({ label, hour, value }: { label: string; hour: number; value: number }) {
  const b = busyness(value);
  return (
    <div className="py-3 lg:px-4 lg:py-3 lg:first:pl-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-none text-ink">{hour12(hour)}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        <span
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{ background: b.fill }}
          aria-hidden="true"
        />
        {b.label} · <span className="tnum">~{Math.round(value)}/hr</span>
      </p>
    </div>
  );
}

function ClosedCard({ day, message }: { day: string; message?: string }) {
  return (
    <section className="rounded-card border border-line bg-surface p-8 text-center lg:py-20">
      <h2 className="text-lg font-semibold text-ink">Closed for the season</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        {message ?? "The pool isn’t open on this date."} See you next summer.
      </p>
      <p className="mt-3 text-xs text-muted">{longDate(day)}</p>
    </section>
  );
}

function LoadingCard({ slow }: { slow: boolean }) {
  return (
    // Mirrors ReadyCard's grid so nothing jumps when the data lands.
    <div className="space-y-3 lg:grid lg:grid-cols-12 lg:items-stretch lg:gap-4 lg:space-y-0">
      <section className="rounded-card border border-line bg-surface p-5 lg:col-span-4 lg:p-6">
        <div className="h-4 w-36 animate-pulse rounded bg-surface-2" />
        <div className="mt-5 h-8 w-44 animate-pulse rounded bg-surface-2 lg:mt-8 lg:h-10" />
        <div className="mt-6 grid grid-cols-2 gap-4 lg:mt-8">
          <div className="h-14 animate-pulse rounded bg-surface-2" />
          <div className="h-14 animate-pulse rounded bg-surface-2" />
        </div>
      </section>
      <section className="rounded-card border border-line bg-surface p-4 lg:col-span-8 lg:p-6">
        <div className="flex h-[148px] items-end gap-0.5 lg:h-[228px]">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="mx-auto w-[58%] max-w-[22px] flex-1 animate-pulse rounded-t bg-surface-2"
              style={{ height: `${35 + ((i * 13) % 55)}%` }}
            />
          ))}
        </div>
        {slow ? (
          <p className="mt-4 text-xs text-muted">Waking the service up — one moment…</p>
        ) : null}
      </section>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section
      className="rounded-card border border-line bg-surface p-8 text-center lg:py-20"
      role="alert"
    >
      <h2 className="text-base font-semibold text-ink">Couldn’t load the forecast</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded bg-ink px-4 py-2 text-sm font-medium text-surface transition hover:opacity-90"
      >
        Try again
      </button>
    </section>
  );
}
