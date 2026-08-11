"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiError, postWhatIf } from "@/lib/api";
import type { HourPrediction, TempRange, WhatIfResponse } from "@/lib/types";
import { busyness } from "@/lib/busyness";
import { hour12 } from "@/lib/format";
import { HourlyStrip } from "./HourlyStrip";

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

  return (
    <div className="space-y-4">
      <section className="space-y-5 rounded-4xl bg-surface/80 p-6 shadow-soft backdrop-blur">
        <p className="text-sm text-muted">See how the weather changes the crowd.</p>

        <Toggle label="Day" left="Weekday" right="Weekend" value={isWeekend} onChange={setIsWeekend} />

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-muted">Temperature</span>
            <span className="tnum text-2xl font-extrabold text-ink">{temp}&deg;</span>
          </div>
          <div className="relative mt-2 h-9">
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
            {observed ? (
              <div
                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                style={{
                  left: `${pct(observed.min)}%`,
                  width: `${pct(observed.max) - pct(observed.min)}%`,
                  background: "rgba(255,158,27,0.4)",
                }}
              />
            ) : null}
            <input
              type="range"
              min={MIN}
              max={MAX}
              value={temp}
              onChange={(e) => setTemp(Number(e.target.value))}
              aria-label="Temperature in Fahrenheit"
              className="temp-range absolute inset-0"
            />
          </div>
          <p className="mt-1 text-xs font-semibold text-muted">
            {extrapolating
              ? "That’s outside what we’ve actually seen — just a rough guess."
              : "The shaded stretch is what past summers actually reached."}
          </p>
        </div>

        <Toggle label="Weather" left="Dry" right="Rain" value={rain} onChange={setRain} />
      </section>

      <section className="rounded-4xl bg-surface/80 p-5 shadow-soft backdrop-blur">
        {error ? (
          <p className="py-6 text-center text-muted" role="alert">
            {error}
          </p>
        ) : !data || !peak ? (
          <p className="py-10 text-center text-muted">{pending ? "Working it out…" : ""}</p>
        ) : (
          <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <p className="text-sm font-semibold text-muted">
              On a {rain ? "rainy" : "dry"} {isWeekend ? "weekend" : "weekday"} at {temp}&deg;
            </p>
            <p className="mt-1 text-2xl font-extrabold" style={{ color: peakB?.color }}>
              {peakB?.label} around {hour12(peak.hour)}
            </p>
            <div className="mt-4">
              <HourlyStrip predictions={data.predictions} />
            </div>
            <p className="mt-3 text-xs text-muted">
              Notice: rain empties the pool, while warmer days fill it up.
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
      <span className="text-sm font-semibold text-muted">{label}</span>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-2 p-1">
        <button
          type="button"
          onClick={() => onChange(false)}
          aria-pressed={!value}
          className={`rounded-xl py-2 text-sm font-bold transition ${
            !value ? "bg-surface text-ink shadow-soft" : "text-muted"
          }`}
        >
          {left}
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          aria-pressed={value}
          className={`rounded-xl py-2 text-sm font-bold transition ${
            value ? "bg-surface text-ink shadow-soft" : "text-muted"
          }`}
        >
          {right}
        </button>
      </div>
    </div>
  );
}
