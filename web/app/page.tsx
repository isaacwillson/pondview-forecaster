"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ForecastView } from "@/components/ForecastView";
import { WhatIfView } from "@/components/WhatIfView";
import { Methodology } from "@/components/Methodology";

type Tab = "forecast" | "whatif";

const TABS = [
  { value: "forecast", label: "Forecast" },
  { value: "whatif", label: "What-if" },
] as const;

export default function Page() {
  const [tab, setTab] = useState<Tab>("forecast");

  return (
    <main className="mx-auto max-w-page px-5 py-10 sm:px-8">
      <header className="mb-8">
        <p className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Pondview pool
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Arrival forecast
        </h1>
        <p className="mt-2 max-w-[56ch] text-muted">
          How many families arrive each hour, predicted from the day&rsquo;s weather —
          arrivals, not occupancy.
        </p>
      </header>

      <div className="mb-8">
        <SegmentedControl
          ariaLabel="Choose a view"
          options={TABS}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "forecast" ? <ForecastView /> : <WhatIfView />}

      <Methodology />
    </main>
  );
}
