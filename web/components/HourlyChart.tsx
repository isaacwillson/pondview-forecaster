"use client";

import { useState } from "react";
import type { HourPrediction } from "@/lib/types";
import { busyness } from "@/lib/busyness";
import { hour12, hourShort } from "@/lib/format";

/**
 * Hour-by-hour predicted arrivals, as a column chart with the model's uncertainty band.
 *
 * This replaced a strip of rounded pills with a number under each one. Three things were
 * wrong with that, and each is fixed here:
 *
 *   1. It had no y-axis, so a bar's height meant nothing on its own -- the only way to
 *      read a value was the printed number, which made the bars decoration.
 *   2. It threw the band away. /forecast returns `low` and `high` for every hour and
 *      nothing displayed them, so a prediction of 11 looked exactly as certain as a
 *      prediction of 2, when it is not.
 *   3. It printed a value on every column, which the eye skips. The axis carries the
 *      general reading now, and only the two extremes are labelled directly.
 *
 * The band is a whisker over the column, not a pale block behind it. A block was tried
 * first and inverted the hierarchy: `low` is clipped at zero for most hours, so the band
 * became a full-height column of its own, wider and louder than the estimate it was only
 * meant to qualify. The whisker's one difficulty -- staying legible against both the bar
 * it crosses and the surface above it, across five ramp steps and two themes -- is solved
 * the way the spec solves every overlapping mark: a 1px ring in the surface colour.
 */

const MIN_COLUMN_PX = 34;

/** Round the axis up to a whole number of clean steps, so ticks read 0/5/10/15, and
 *  guarantee headroom above the tallest whisker for its direct label to sit in. */
function niceScale(maxValue: number): { max: number; ticks: number[] } {
  const target = Math.max(4, maxValue);
  const step = target <= 6 ? 2 : target <= 12 ? 3 : target <= 20 ? 5 : 10;
  let max = Math.ceil(target / step) * step;
  if (max - target < step * 0.45) max += step;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return { max, ticks };
}

export function HourlyChart({
  predictions,
  compact = false,
}: {
  predictions: HourPrediction[];
  /** Shorter plot, for the what-if panel where the chart shares a card with controls. */
  compact?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);

  // Scale to the top of the BAND, not the prediction -- scaling to the prediction would
  // clip the upper half of every band it is meant to show.
  const { max, ticks } = niceScale(Math.max(...predictions.map((p) => p.high)));

  const peakHour = predictions.reduce((a, b) => (b.predicted > a.predicted ? b : a)).hour;
  const quietHour = predictions.reduce((a, b) => (b.predicted < a.predicted ? b : a)).hour;

  const plotH = compact ? "h-[132px] lg:h-[168px]" : "h-[148px] lg:h-[228px]";
  const pct = (v: number) => (v / max) * 100;

  return (
    <figure className="m-0">
      <div className="flex">
        {/* Axis gutter. Pinned outside the scroller so the scale stays readable while
            the plot scrolls sideways on a phone. */}
        <div className={`relative ${plotH} w-7 shrink-0 lg:w-9`} aria-hidden="true">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-1.5 translate-y-1/2 font-mono text-[10px] leading-none text-muted lg:text-[11px]"
              style={{ bottom: `${pct(t)}%` }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">
          <div style={{ minWidth: predictions.length * MIN_COLUMN_PX }}>
            <div className={`relative ${plotH}`}>
              {/* Gridlines: solid hairlines one step off the surface, never dashed. The
                  zero line is the baseline and gets the stronger axis colour. */}
              {ticks.map((t) => (
                <div
                  key={t}
                  className={`absolute inset-x-0 h-px ${t === 0 ? "bg-axis" : "bg-grid"}`}
                  style={{ bottom: `${pct(t)}%` }}
                  aria-hidden="true"
                />
              ))}

              <ul className="absolute inset-0 flex list-none gap-0.5 p-0" role="list">
                {predictions.map((p) => {
                  const b = busyness(p.predicted);
                  const rounded = Math.round(p.predicted);
                  // The two extremes get a direct label -- except a quietest hour that
                  // rounds to zero, where the chip would sit on the baseline and cover
                  // it to say what the axis already says.
                  const labelled = (p.hour === peakHour || p.hour === quietHour) && rounded > 0;
                  return (
                    <li
                      key={p.hour}
                      className="relative flex-1"
                      tabIndex={0}
                      onMouseEnter={() => setActive(p.hour)}
                      onMouseLeave={() => setActive((h) => (h === p.hour ? null : h))}
                      onFocus={() => setActive(p.hour)}
                      onBlur={() => setActive((h) => (h === p.hour ? null : h))}
                      aria-label={`${hour12(p.hour)}: about ${rounded} families arriving, ${b.label.toLowerCase()}. Range ${Math.round(p.low)} to ${Math.round(p.high)}.`}
                    >
                      {/* The prediction -- the dominant mark. Capped in width so the slot
                          keeps its air, and square at the baseline it grows from. */}
                      <div
                        className="absolute bottom-0 left-1/2 w-[70%] max-w-[24px] -translate-x-1/2 transition-[height] duration-300"
                        style={{
                          height: `${pct(p.predicted)}%`,
                          background: b.fill,
                          borderRadius: "3px 3px 0 0",
                        }}
                        aria-hidden="true"
                      />
                      {/* Uncertainty whisker: low to high.
                          No surface ring here, though the spec offers one for overlapping
                          marks: the whisker runs down the bar's centre line, so a ring cut
                          a surface-coloured slot through every bar and each one read as
                          two. Contrast alone is enough, because the ring was only ever
                          needed for the stretch INSIDE the bar -- and inside the bar the
                          whisker is redundant, since the ends are what carry the range. */}
                      <div
                        className="absolute left-1/2 w-0.5 -translate-x-1/2 rounded-sm"
                        style={{
                          bottom: `${pct(p.low)}%`,
                          height: `${pct(p.high - p.low)}%`,
                          background: "var(--ink-2)",
                        }}
                        aria-hidden="true"
                      />
                      {/* Direct label on the cap, for the two extremes only. It sits on
                          the bar rather than above the whisker so it stays attached to
                          the value it names, and carries a surface chip so the whisker
                          does not run through the digits. */}
                      {labelled ? (
                        <span
                          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-sm bg-surface px-1 font-mono text-[11px] font-medium leading-none text-ink lg:text-xs"
                          style={{ bottom: `calc(${pct(p.predicted)}% + 3px)` }}
                          aria-hidden="true"
                        >
                          {rounded}
                        </span>
                      ) : null}

                      {active === p.hour ? (
                        <div
                          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max -translate-x-1/2 rounded border border-line bg-surface px-2 py-1.5 text-left shadow-soft"
                          role="presentation"
                        >
                          <p className="text-[11px] font-semibold leading-tight text-ink">
                            {hour12(p.hour)} · {b.label}
                          </p>
                          <p className="font-mono text-[11px] leading-tight text-muted">
                            {rounded} arrivals ({Math.round(p.low)}–{Math.round(p.high)})
                          </p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* x-axis band, inside the scroller so labels stay under their columns. */}
            <div className="flex gap-0.5 pt-1.5">
              {predictions.map((p) => (
                <span
                  key={p.hour}
                  className="flex-1 text-center font-mono text-[10px] leading-none text-muted lg:text-[11px]"
                >
                  <span className="lg:hidden">{hourShort(p.hour)}</span>
                  <span className="hidden lg:inline">{hour12(p.hour)}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The table twin. Every value in the plot is reachable without colour, hover, or
          a pointing device -- the tooltip enhances, it never gates. */}
      <details className="mt-3 border-t border-line pt-2">
        <summary className="cursor-pointer list-none text-xs text-muted marker:hidden hover:text-ink">
          Show as a table
        </summary>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">
                Hour
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Arrivals
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Range
              </th>
              <th scope="col" className="py-1 font-medium">
                Level
              </th>
            </tr>
          </thead>
          <tbody>
            {predictions.map((p) => {
              const b = busyness(p.predicted);
              return (
                <tr key={p.hour} className="border-b border-line/60 last:border-0">
                  <td className="tnum py-1 pr-3 text-xs text-ink">{hour12(p.hour)}</td>
                  <td className="tnum py-1 pr-3 text-xs text-ink">
                    {Math.round(p.predicted)}
                  </td>
                  <td className="tnum py-1 pr-3 text-xs text-muted">
                    {Math.round(p.low)}–{Math.round(p.high)}
                  </td>
                  <td className="py-1 text-xs text-muted">{b.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
