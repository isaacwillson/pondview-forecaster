export function Methodology() {
  return (
    <section
      aria-labelledby="methodology-heading"
      className="mt-14 border-t border-line pt-6 text-sm leading-relaxed text-muted"
    >
      <h2
        id="methodology-heading"
        className="mb-2 font-sans text-xs font-semibold uppercase tracking-wider text-ink"
      >
        Method and limits
      </h2>
      <p className="max-w-[62ch]">
        One site, about 24 days of a single summer. This forecasts <em>arrivals</em> —
        families signing in per hour — not occupancy: the sign-in sheets never record
        when anyone leaves. It assumes the pool keeps its normal posted hours and does
        not model day-specific early closures. The shaded bands are rough typical error
        from leave-one-day-out cross-validation, not statistical confidence intervals.
      </p>
      <p className="mt-3 max-w-[62ch]">
        Weather data by{" "}
        <a
          href="https://open-meteo.com/"
          className="text-accent-ink underline decoration-line underline-offset-2 hover:decoration-current"
          target="_blank"
          rel="noreferrer"
        >
          Open-Meteo
        </a>{" "}
        (CC BY 4.0).
      </p>
    </section>
  );
}
