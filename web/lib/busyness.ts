// Plain-language "how busy" levels, so a resident sees a word and a colour, not a
// number they have to interpret. Thresholds are tuned to this pool (typical hour ~6
// arrivals, peak ~14). Everything is about ARRIVALS -- how many families show up in an
// hour -- not how full the pool is.
//
// Keep the python thresholds in api/aggregate.py in step with the cutoffs below.
//
// The colours are CSS variables (app/globals.css) because the ramp is re-stepped for
// the dark surface rather than flipped: on a dark ground the quiet end is the DARKEST
// step, so the scale still reads as "more ink means more people".

export interface Busyness {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  /**
   * The ordinal ramp step for this level. It is a MARK colour -- bars, swatches,
   * band fills. It is deliberately not offered as a text colour: the light end of
   * the ramp cannot meet 4.5:1 as type, and colouring a label makes it read as
   * decoration. Put a swatch next to ink-coloured text instead.
   */
  fill: string;
}

const QUIET: Busyness = { level: 0, label: "Quiet", fill: "var(--busy-0)" };
const EASY: Busyness = { level: 1, label: "Easygoing", fill: "var(--busy-1)" };
const STEADY: Busyness = { level: 2, label: "Steady", fill: "var(--busy-2)" };
const BUSY: Busyness = { level: 3, label: "Busy", fill: "var(--busy-3)" };
const PACKED: Busyness = { level: 4, label: "Packed", fill: "var(--busy-4)" };

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
