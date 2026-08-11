"use client";

import { useState, type ReactNode } from "react";
import { ForecastView } from "@/components/ForecastView";
import { WhatIfView } from "@/components/WhatIfView";
import { About } from "@/components/About";

export default function Page() {
  const [tab, setTab] = useState<"forecast" | "whatif">("forecast");

  return (
    <main className="mx-auto min-h-dvh max-w-app px-5 pb-16 pt-8">
      <header className="mb-5 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Pondview Pool</h1>
        <p className="mt-0.5 text-sm font-semibold text-muted">
          When&rsquo;s it quiet? When&rsquo;s it busy?
        </p>
      </header>

      <div
        className="mb-5 grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-2 p-1"
        role="tablist"
        aria-label="Views"
      >
        <TabButton active={tab === "forecast"} onClick={() => setTab("forecast")}>
          Forecast
        </TabButton>
        <TabButton active={tab === "whatif"} onClick={() => setTab("whatif")}>
          What if…
        </TabButton>
      </div>

      {tab === "forecast" ? <ForecastView /> : <WhatIfView />}

      <About />
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`rounded-xl py-2.5 text-sm font-bold transition ${
        active ? "bg-surface text-ink shadow-soft" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}
