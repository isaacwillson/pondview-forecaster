const BARS = [40, 62, 55, 70, 84, 60, 92, 74, 48, 30];

/** A chart-shaped loading state. `hint` surfaces the Lambda cold start honestly
 *  instead of spinning forever. */
export function ChartSkeleton({ hint }: { hint?: string }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <div
        className="flex h-[220px] items-end gap-3 px-2"
        style={{ opacity: 0.7 }}
        aria-hidden
      >
        {BARS.map((h, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-sm bg-line"
            style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }}
          />
        ))}
      </div>
      <p className="mt-4 min-h-5 text-sm text-muted">
        {hint ?? "Loading forecast…"}
      </p>
    </div>
  );
}
