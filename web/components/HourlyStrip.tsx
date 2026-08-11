"use client";

import type { HourPrediction } from "@/lib/types";
import { busyness } from "@/lib/busyness";
import { hour12 } from "@/lib/format";

/** iPhone-weather-style horizontal hour strip: hour, a colour-coded bar, the number. */
export function HourlyStrip({ predictions }: { predictions: HourPrediction[] }) {
  const max = Math.max(4, ...predictions.map((p) => p.predicted));
  return (
    <div
      className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1"
      role="list"
      aria-label="Predicted arrivals by hour"
    >
      {predictions.map((p) => {
        const b = busyness(p.predicted);
        const barHeight = Math.max(8, Math.round((p.predicted / max) * 104));
        const rounded = Math.round(p.predicted);
        return (
          <div
            key={p.hour}
            role="listitem"
            className="flex w-[52px] shrink-0 flex-col items-center gap-2"
            title={`${hour12(p.hour)}: ${b.label} — about ${rounded} families arriving`}
          >
            <span className="text-xs font-semibold text-muted">{hour12(p.hour)}</span>
            <div className="flex h-[112px] w-full items-end justify-center">
              <div
                className="w-7 rounded-full transition-[height] duration-300"
                style={{ height: `${barHeight}px`, background: b.color }}
              />
            </div>
            <span className="tnum text-base font-extrabold text-ink">{rounded}</span>
          </div>
        );
      })}
    </div>
  );
}
