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
    <div
      className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5"
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
            className={`flex shrink-0 flex-col items-center rounded-2xl px-4 py-2.5 leading-tight transition ${
              active
                ? "bg-ink text-surface shadow-soft"
                : "bg-surface/70 text-ink hover:bg-surface"
            }`}
          >
            <span className="text-sm font-bold">{d.label}</span>
            <span className={active ? "text-xs opacity-80" : "text-xs text-muted"}>
              {d.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}
