export function About() {
  return (
    <details className="mt-4 rounded-4xl bg-surface/60 px-6 py-4 shadow-soft backdrop-blur">
      <summary className="cursor-pointer list-none font-bold text-ink marker:hidden">
        About these forecasts
      </summary>
      <div className="mt-3 space-y-3 text-sm text-muted">
        <p>
          These estimate how many families <strong>arrive each hour</strong> — where the
          rushes are — from a summer of pool sign-in sheets and the day&rsquo;s weather.
          They&rsquo;re a friendly guide, not a promise.
        </p>
        <p>
          They don&rsquo;t say how full the pool is (people leave whenever they like),
          only when the most people show up. We assume the pool keeps its normal posted
          hours.
        </p>
        <p>
          Weather by{" "}
          <a
            href="https://open-meteo.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ink underline"
          >
            Open-Meteo
          </a>{" "}
          (CC BY 4.0).
        </p>
      </div>
    </details>
  );
}
