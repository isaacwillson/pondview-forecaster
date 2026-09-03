"use client";

import { useEffect, useState, type ReactNode } from "react";
import posthog from "posthog-js";
import { ApiError, postWhatIf } from "@/lib/api";
import type { HourPrediction, TempRange, WhatIfResponse } from "@/lib/types";
import { busyness } from "@/lib/busyness";
import { hour12 } from "@/lib/format";
import { HourlyChart } from "./HourlyChart";

const MIN = 55;
const MAX = 100;
const DEFAULT_TEMP = 82;
const pct = (v: number) => ((v - MIN) / (MAX - MIN)) * 100;

export function WhatIfView() {
  const [isWeekend, setIsWeekend] = useState(false);
  const [temp, setTemp] = useState(DEFAULT_TEMP);
  const [rain, setRain] = useState(false);
  const [data, setData] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    const timer = setTimeout(() => {
      postWhatIf(
        { is_weekend: isWeekend, temperature: temp, precipitation: rain },
        controller.signal,
      )
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setError(e instanceof ApiError ? e.message : "Something went wrong.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setPending(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isWeekend, temp, rain]);

  const observed: TempRange | null = data?.temp_range ?? null;
  const extrapolating = observed ? temp < observed.min || temp > observed.max : false;
  const peak = data
    ? data.predictions.reduce<HourPrediction | null>(
        (best, p) => (best === null || p.predicted > best.predicted ? p : best),
        null,
      )
    : null;
  const peakB = peak ? busyness(peak.predicted) : null;

  // Desktop: controls on the left, the resulting day beside them. Phone: stacked.
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-12 lg:items-stretch lg:gap-4 lg:space-y-0">
      <section className="space-y-5 rounded-card border border-line bg-surface p-5 lg:col-span-5 lg:space-y-6 lg:p-6">
        <p className="text-sm text-muted">
          Hold the day fixed and change the weather, to see what the model thinks the
          weather is actually worth.
        </p>

        <Toggle
          label="Day"
          left="Weekday"
          right="Weekend"
          value={isWeekend}
          onChange={(v) => {
            posthog.capture("whatif_day_type_changed", {
              day_type: v ? "weekend" : "weekday",
            });
            setIsWeekend(v);
          }}
        />

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Temperature
            </span>
            <span className="text-2xl font-semibold leading-none text-ink">{temp}&deg;F</span>
          </div>
          <div className="relative mt-2 h-8">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-surface-2" />
            {observed ? (
              <div
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-sm"
                style={{
                  left: `${pct(observed.min)}%`,
                  width: `${pct(observed.max) - pct(observed.min)}%`,
                  background: "var(--accent)",
                  opacity: 0.45,
                }}
              />
            ) : null}
            <input
              type="range"
              min={MIN}
              max={MAX}
              value={temp}
              onChange={(e) => setTemp(Number(e.target.value))}
              onPointerUp={(e) =>
                posthog.capture("whatif_temperature_set", {
                  temperature: Number((e.target as HTMLInputElement).value),
                })
              }
              aria-label="Temperature in Fahrenheit"
              className="temp-range absolute inset-0"
            />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            {extrapolating
              ? "Outside the 67–90°F the model was trained on — it is extrapolating here, and the number should be read as a guess."
              : "The shaded stretch is the temperature range the training season actually reached."}
          </p>
        </div>

        <Toggle
          label="Weather"
          left="Dry"
          right="Rain"
          value={rain}
          onChange={(v) => {
            posthog.capture("whatif_rain_changed", { has_rain: v });
            setRain(v);
          }}
        />
      </section>

      <section className="rounded-card border border-line bg-surface p-4 lg:col-span-7 lg:p-6">
        {error ? (
          <p className="py-6 text-center text-sm text-muted lg:py-20" role="alert">
            {error}
          </p>
        ) : !data || !peak ? (
          <p className="py-10 text-center text-sm text-muted lg:py-32">
            {pending ? "Working it out…" : ""}
          </p>
        ) : (
          <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {rain ? "Rainy" : "Dry"} {isWeekend ? "weekend" : "weekday"} · {temp}&deg;F
            </p>
            <p className="mt-1.5 flex items-center gap-2 text-xl font-semibold tracking-tight text-ink lg:text-2xl">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ background: peakB?.fill }}
                aria-hidden="true"
              />
              {peakB?.label} around {hour12(peak.hour)}
            </p>
            <div className="mt-5 lg:mt-6">
              <HourlyChart predictions={data.predictions} compact />
            </div>
            <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">
              Rain empties the pool and warmer days fill it — which is the model saying
              the weather features earn their place, not a rule anyone wrote into it.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function Toggle({
  label,
  left,
  right,
  value,
  onChange,
}: {
  label: string;
  left: ReactNode;
  right: ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <div className="mt-1.5 grid grid-cols-2 gap-1 rounded border border-line bg-surface-2 p-1">
        <button
          type="button"
          onClick={() => onChange(false)}
          aria-pressed={!value}
          className={`rounded-[3px] py-1.5 text-sm transition ${
            !value ? "bg-surface font-medium text-ink shadow-soft" : "text-muted hover:text-ink"
          }`}
        >
          {left}
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          aria-pressed={value}
          className={`rounded-[3px] py-1.5 text-sm transition ${
            value ? "bg-surface font-medium text-ink shadow-soft" : "text-muted hover:text-ink"
          }`}
        >
          {right}
        </button>
      </div>
    </div>
  );
}
