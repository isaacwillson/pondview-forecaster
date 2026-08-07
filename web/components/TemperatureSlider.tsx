"use client";

import type { TempRange } from "@/lib/types";

interface Props {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  observed: TempRange | null;
  extrapolating: boolean;
}

const pct = (v: number, min: number, max: number) => ((v - min) / (max - min)) * 100;

export function TemperatureSlider({
  value,
  onChange,
  min,
  max,
  observed,
  extrapolating,
}: Props) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">Temperature</span>
        <span className="tnum text-lg font-medium text-ink">{value}&deg;F</span>
      </div>

      <div className="relative mt-2 h-10">
        {/* base track */}
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-line" />
        {/* shaded observed-training range */}
        {observed ? (
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded"
            style={{
              left: `${pct(observed.min, min, max)}%`,
              width: `${pct(observed.max, min, max) - pct(observed.min, min, max)}%`,
              background: "var(--observed-fill)",
            }}
          />
        ) : null}
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Temperature in Fahrenheit"
          className="temp-range absolute inset-0"
        />
      </div>

      <div className="tnum mt-1 flex justify-between text-xs text-muted">
        <span>{min}&deg;</span>
        {observed ? (
          <span>
            observed {observed.min}&ndash;{observed.max}&deg;
          </span>
        ) : null}
        <span>{max}&deg;</span>
      </div>

      {extrapolating && observed ? (
        <p className="mt-2 inline-block rounded border border-dashed border-muted px-2 py-1 text-xs text-muted">
          Extrapolating &mdash; outside the observed data ({observed.min}&ndash;
          {observed.max}&deg;F).
        </p>
      ) : null}
    </div>
  );
}
