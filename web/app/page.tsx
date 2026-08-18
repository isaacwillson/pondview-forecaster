"use client";

import { useState, type ReactNode } from "react";
import { ForecastView } from "@/components/ForecastView";
import { WhatIfView } from "@/components/WhatIfView";
import { ChatView } from "@/components/ChatView";
import { About } from "@/components/About";

type Tab = "forecast" | "whatif" | "ask";

export default function Page() {
  const [tab, setTab] = useState<Tab>("forecast");

  // Phone: a single narrow column. Desktop (lg+): a wide page where the header and the
  // view tabs share one row and the views spread into columns -- see ForecastView.
  return (
    <main className="mx-auto min-h-dvh w-full max-w-app px-5 pb-16 pt-8 md:max-w-2xl md:px-8 lg:max-w-desk lg:px-10 lg:pb-20 lg:pt-12">
      <header className="mb-5 lg:mb-8 lg:flex lg:items-center lg:justify-between lg:gap-10">
        <div className="text-center lg:text-left">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink lg:text-4xl">
            Pondview Pool
          </h1>
          <p className="mt-0.5 text-sm font-semibold text-muted lg:mt-1 lg:text-base">
            When&rsquo;s it quiet? When&rsquo;s it busy?
          </p>
        </div>

        <div
          className="mt-5 grid grid-cols-3 gap-1.5 rounded-2xl bg-surface-2 p-1 lg:mt-0 lg:w-[26rem] lg:shrink-0"
          role="tablist"
          aria-label="Views"
        >
          <TabButton active={tab === "forecast"} onClick={() => setTab("forecast")}>
            Forecast
          </TabButton>
          <TabButton active={tab === "whatif"} onClick={() => setTab("whatif")}>
            What if…
          </TabButton>
          <TabButton active={tab === "ask"} onClick={() => setTab("ask")}>
            Ask
          </TabButton>
        </div>
      </header>

      {tab === "forecast" ? <ForecastView /> : tab === "whatif" ? <WhatIfView /> : <ChatView />}

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
