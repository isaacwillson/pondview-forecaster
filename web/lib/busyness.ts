// Plain-language "how busy" levels, so a resident sees a word and a colour, not a
// number they have to interpret. Thresholds are tuned to this pool (typical hour ~6
// arrivals, peak ~14). Everything is about ARRIVALS -- how many families show up in an
// hour -- not how full the pool is.

export interface Busyness {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string; // solid, for the hourly bars
  soft: string; // translucent, for chips/pills
}

const QUIET: Busyness = { level: 0, label: "Quiet", color: "#6ba8dd", soft: "rgba(107,168,221,0.16)" };
const EASY: Busyness = { level: 1, label: "Easygoing", color: "#38b8ac", soft: "rgba(56,184,172,0.16)" };
const STEADY: Busyness = { level: 2, label: "Steady", color: "#4cb96a", soft: "rgba(76,185,106,0.16)" };
const BUSY: Busyness = { level: 3, label: "Busy", color: "#f2a23c", soft: "rgba(242,162,60,0.18)" };
const PACKED: Busyness = { level: 4, label: "Packed", color: "#ec5f5f", soft: "rgba(236,95,95,0.18)" };

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
