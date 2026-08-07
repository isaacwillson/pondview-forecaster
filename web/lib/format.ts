// The pool's season (months). Only used to pick a sensible default date; the API is
// the source of truth for open hours and closed/typical states.
export const SEASON_MONTHS = [7, 8];

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

/** 24h hour -> compact label, e.g. 10 -> "10a", 13 -> "1p", 19 -> "7p". */
export function hourLabel(hour: number): string {
  const period = hour < 12 ? "a" : "p";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${period}`;
}

/** Long, human date, e.g. "Thursday, August 6". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
