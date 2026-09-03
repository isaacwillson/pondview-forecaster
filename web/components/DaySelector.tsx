"use client";

import type { DayOption } from "@/lib/format";

export function DaySelector({
  days,
  selected,
  onSelect,
}: {
  days: DayOption[];
  selected: string;
  onSelect: (iso: string) => void;
}) {
  return (
    // Phone: scrolls sideways, bleeding to the screen edge. Desktop: all days fit the row.
    <div
      className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:overflow-x-visible md:px-0"
      role="tablist"
      aria-label="Choose a day"
    >
      {days.map((d) => {
        const active = d.iso === selected;
        return (
          <button
            key={d.iso}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(d.iso)}
            className={`flex shrink-0 flex-col items-center rounded border px-3.5 py-2 leading-tight transition md:flex-1 md:px-2 ${
              active
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-ink-2 hover:border-axis hover:text-ink"
            }`}
          >
            <span className="text-sm font-medium">{d.label}</span>
            <span className={`text-xs ${active ? "opacity-70" : "text-muted"}`}>
              {d.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}
