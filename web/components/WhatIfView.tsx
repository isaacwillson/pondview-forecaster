"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiError, postWhatIf } from "@/lib/api";
import type { TempRange, WhatIfResponse } from "@/lib/types";
import { SegmentedControl } from "./SegmentedControl";
import { TemperatureSlider } from "./TemperatureSlider";
import { ArrivalsChart } from "./ArrivalsChart";
import { ChartSkeleton } from "./ChartSkeleton";

const SLIDER_MIN = 55;
const SLIDER_MAX = 100;
const DEFAULT_TEMP = 82;
const Y_FLOOR = 16; // keep the y-axis stable while dragging (expands if exceeded)

export function WhatIfView() {
  const [isWeekend, setIsWeekend] = useState(false);
  const [temperature, setTemperature] = useState(DEFAULT_TEMP);
  const [rain, setRain] = useState(false);
  const [data, setData] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    // Debounce so dragging the slider doesn't fire a request per pixel.
    const timer = setTimeout(() => {
      postWhatIf(
        { is_weekend: isWeekend, temperature, precipitation: rain },
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
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isWeekend, temperature, rain]);

  const observed: TempRange | null = data?.temp_range ?? null;
  const extrapolating = observed
    ? temperature < observed.min || temperature > observed.max
    : false;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,17rem)_1fr]">
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-display text-lg text-ink">Conditions</h2>
        <p className="mt-1 text-sm text-muted">
          Change these to see what the model learned.
        </p>
        <div className="mt-5 space-y-5">
          <Field label="Day">
            <SegmentedControl
              ariaLabel="Day type"
              options={[
                { value: "weekday", label: "Weekday" },
                { value: "weekend", label: "Weekend" },
              ]}
              value={isWeekend ? "weekend" : "weekday"}
              onChange={(v) => setIsWeekend(v === "weekend")}
            />
          </Field>
          <TemperatureSlider
            value={temperature}
            onChange={setTemperature}
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            observed={observed}
            extrapolating={extrapolating}
          />
          <Field label="Weather">
            <SegmentedControl
              ariaLabel="Weather"
              options={[
                { value: "dry", label: "Dry" },
                { value: "rain", label: "Rain" },
              ]}
              value={rain ? "rain" : "dry"}
              onChange={(v) => setRain(v === "rain")}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        {error ? (
          <div role="alert" className="py-6">
            <p className="font-medium text-ink">Couldn&rsquo;t reach the model</p>
            <p className="mt-1 text-sm text-muted">{error}</p>
          </div>
        ) : !data ? (
          <ChartSkeleton hint={pending ? "Waking the model service…" : undefined} />
        ) : (
          <div
            aria-busy={pending}
            className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}
          >
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 className="font-display text-lg text-ink">
                Predicted hourly arrivals
              </h2>
              <span className="tnum text-sm text-muted">
                day total &asymp;{" "}
                {Math.round(data.predictions.reduce((s, p) => s + p.predicted, 0))}
              </span>
            </div>
            <ArrivalsChart
              predictions={data.predictions}
              yMaxHint={Y_FLOOR}
              ariaLabel={`Predicted arrivals per hour for a ${
                isWeekend ? "weekend" : "weekday"
              } at ${temperature} degrees Fahrenheit, ${rain ? "raining" : "dry"}.`}
            />
            <p className="mt-3 max-w-[60ch] text-xs text-muted">
              Rain on = the average conditions on rainy hours (higher humidity and cloud,
              measurable precipitation) — which is how the model actually reads rain, and
              it lowers turnout sharply.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm text-muted">{label}</div>
      {children}
    </div>
  );
}
