// The pool's season (months). Only used to pick a sensible default date; the API is
// the source of truth for open hours and closed/typical states.
//
// September is included because the season runs to Labor Day, but it is only PARTLY
// open — this list is deliberately coarse, and nextOpenDay may land on a September date
// the API then reports as closed. That is acceptable for choosing a default; do not
// reuse this to decide whether the pool is open. Ask the API.
export const SEASON_MONTHS = [7, 8, 9];

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The soonest date on/after `from` whose month is in season. */
export function nextOpenDay(from: Date): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 400; i += 1) {
    if (SEASON_MONTHS.includes(d.getMonth() + 1)) return toISODate(d);
    d.setDate(d.getDate() + 1);
  }
  return toISODate(from);
}

/** Friendly 12-hour label, e.g. 10 -> "10 AM", 13 -> "1 PM", 19 -> "7 PM". */
export function hour12(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${period}`;
}

/** Compact hour, e.g. 10 -> "10a", 17 -> "5p" (used where space is tight). */
export function hourShort(hour: number): string {
  const period = hour < 12 ? "a" : "p";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${period}`;
}

/** Long, human date, e.g. "Saturday, August 8". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * How to name `iso` inside a sentence, relative to today: "today", "tomorrow", or the
 * weekday ("Saturday").
 *
 * Used by the suggested questions on the forecast view so they carry the day the
 * resident is actually looking at. Without that they read as a non-sequitur -- you are
 * studying Saturday, you tap a question, and the app answers about today instead.
 */
export function dayPhrase(iso: string, from: Date = new Date()): string {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (iso === toISODate(base)) return "today";
  const tomorrow = new Date(base);
  tomorrow.setDate(base.getDate() + 1);
  if (iso === toISODate(tomorrow)) return "tomorrow";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
}

export interface DayOption {
  iso: string;
  label: string; // "Today", "Tomorrow", or weekday "Sat"
  sub: string; // "Aug 8"
}

/** The next `count` calendar days from `from`, for the horizontal day picker. */
export function upcomingDays(from: Date, count: number): DayOption[] {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const out: DayOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      iso: toISODate(d),
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : d.toLocaleDateString("en-US", { weekday: "short" }),
      sub: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }
  return out;
}
