// Plain-language "how busy" levels, so a resident sees a word and a colour, not a
// number they have to interpret. Thresholds are tuned to this pool (typical hour ~6
// arrivals, peak ~14). Everything is about ARRIVALS -- how many families show up in an
// hour -- not how full the pool is.
//
// The colours are CSS variables (app/globals.css) rather than literals, so they can
// differ between light and dark. They have to: a single palette cannot serve both, and
// the previous hardcoded one was tuned on dark and failed WCAG AA as text on light.
// Keep the python api/ thresholds in api/aggregate.py in step with the cutoffs below.

export interface Busyness {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Vivid, for large blocks -- the hourly bars. Too light for text on a light card. */
  fill: string;
  /** Contrast-safe, for TEXT of any size. Use this whenever the colour is a `color:`. */
  ink: string;
  /** Translucent wash of the fill, for chips and tiles. */
  soft: string;
}

const QUIET: Busyness = {
  level: 0,
  label: "Quiet",
  fill: "var(--busy-quiet)",
  ink: "var(--busy-quiet-ink)",
  soft: "var(--busy-quiet-soft)",
};
const EASY: Busyness = {
  level: 1,
  label: "Easygoing",
  fill: "var(--busy-easy)",
  ink: "var(--busy-easy-ink)",
  soft: "var(--busy-easy-soft)",
};
const STEADY: Busyness = {
  level: 2,
  label: "Steady",
  fill: "var(--busy-steady)",
  ink: "var(--busy-steady-ink)",
  soft: "var(--busy-steady-soft)",
};
const BUSY: Busyness = {
  level: 3,
  label: "Busy",
  fill: "var(--busy-busy)",
  ink: "var(--busy-busy-ink)",
  soft: "var(--busy-busy-soft)",
};
const PACKED: Busyness = {
  level: 4,
  label: "Packed",
  fill: "var(--busy-packed)",
  ink: "var(--busy-packed-ink)",
  soft: "var(--busy-packed-soft)",
};

/** Map a predicted arrivals/hour value to a friendly busyness level. */
export function busyness(predicted: number): Busyness {
  if (predicted < 2.5) return QUIET;
  if (predicted < 5) return EASY;
  if (predicted < 8.5) return STEADY;
  if (predicted < 12) return BUSY;
  return PACKED;
}

/** Legend order, quiet -> packed. */
export const BUSYNESS_LEGEND: readonly Busyness[] = [QUIET, EASY, STEADY, BUSY, PACKED];
