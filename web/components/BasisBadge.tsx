import type { Basis } from "@/lib/types";

const LABEL: Record<Basis, string> = {
  forecast: "Live forecast",
  typical: "Typical conditions",
  closed: "Closed for the season",
};

const SUB: Record<Basis, string> = {
  forecast: "from live weather",
  typical: "beyond the 16-day forecast window",
  closed: "",
};

/** An honest label for how the numbers were produced. The accent dot is reserved for a
 *  genuine live forecast; typical/closed read as calmer, muted states. */
export function BasisBadge({ basis }: { basis: Basis }) {
  const sub = SUB[basis];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full"
        style={{
          background: basis === "forecast" ? "var(--accent)" : "transparent",
          border: basis === "forecast" ? "none" : "1.5px solid var(--muted)",
        }}
      />
      <span className="font-medium text-ink">{LABEL[basis]}</span>
      {sub ? <span className="text-muted">· {sub}</span> : null}
    </span>
  );
}
