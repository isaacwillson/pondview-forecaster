import { LIVE_OCCUPANCY_DAYS, STATUS_DASHBOARD_URL } from "@/lib/site";

export function About() {
  return (
    <details className="mt-4 rounded-4xl bg-surface/60 px-6 py-4 shadow-soft backdrop-blur lg:mt-6 lg:px-8 lg:py-6">
      <summary className="cursor-pointer list-none font-bold text-ink marker:hidden lg:text-lg">
        About these forecasts
      </summary>
      {/* Prose stays at a readable measure even though the card spans the page. */}
      <div className="mt-3 max-w-3xl space-y-3 text-sm text-muted lg:mt-4 lg:text-base">
        <p>
          These estimate how many families <strong>arrive each hour</strong> — where the
          rushes are — from a summer of pool sign-in sheets and the day&rsquo;s weather.
          They&rsquo;re a friendly guide, not a promise.
        </p>
        <p>
          They don&rsquo;t say how full the pool is (people leave whenever they like),
          only when the most people show up. We assume the pool keeps its normal posted
          hours. For how busy it is <em>right now</em>, the{" "}
          <a
            href={STATUS_DASHBOARD_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ink underline"
          >
            live pool dashboard
          </a>{" "}
          counts people at the pool — on {LIVE_OCCUPANCY_DAYS}.
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
