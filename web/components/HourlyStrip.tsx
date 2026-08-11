"use client";

import type { HourPrediction } from "@/lib/types";
import { busyness } from "@/lib/busyness";
import { hour12 } from "@/lib/format";

/**
 * iPhone-weather-style hour strip: hour, a colour-coded bar, the number.
 * Phone: fixed-width columns that scroll sideways. Desktop: the columns share the
 * row and the bars grow taller, so the chart fills the card instead of hugging one edge.
 * Bar heights are percentages of the plot area, so they follow the responsive height.
 */
export function HourlyStrip({ predictions }: { predictions: HourPrediction[] }) {
  const max = Math.max(4, ...predictions.map((p) => p.predicted));
  return (
    <div
      className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 md:gap-2 md:overflow-x-visible"
      role="list"
      aria-label="Predicted arrivals by hour"
    >
      {predictions.map((p) => {
        const b = busyness(p.predicted);
        const barPct = Math.max(7, (p.predicted / max) * 100);
        const rounded = Math.round(p.predicted);
        return (
          <div
            key={p.hour}
            role="listitem"
            className="flex w-[52px] shrink-0 flex-col items-center gap-2 md:w-auto md:flex-1 md:shrink"
            title={`${hour12(p.hour)}: ${b.label} — about ${rounded} families arriving`}
          >
            <span className="text-xs font-semibold text-muted lg:text-sm">{hour12(p.hour)}</span>
            <div className="flex h-[112px] w-full items-end justify-center lg:h-[220px]">
              <div
                className="w-7 rounded-full transition-[height] duration-300 md:w-full md:max-w-[3rem]"
                style={{ height: `${barPct}%`, background: b.color }}
              />
            </div>
            <span className="tnum text-base font-extrabold text-ink lg:text-xl">{rounded}</span>
          </div>
        );
      })}
    </div>
  );
}
