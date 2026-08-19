"use client";

import { useCallback, useState, type ReactNode } from "react";
import posthog from "posthog-js";
import { ForecastView } from "@/components/ForecastView";
import { WhatIfView } from "@/components/WhatIfView";
import { ChatView } from "@/components/ChatView";
import { About } from "@/components/About";

type Tab = "forecast" | "whatif" | "ask";

export default function Page() {
  const [tab, setTab] = useState<Tab>("forecast");
  // A question handed from the forecast view to the assistant. Held here because it has
  // to survive the tab switch that carries it across.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const switchTab = useCallback((next: Tab) => {
    posthog.capture("tab_switched", { to_tab: next });
    setTab(next);
  }, []);

  const askAssistant = useCallback((question: string) => {
    setPendingQuestion(question);
    switchTab("ask");
  }, [switchTab]);
  const clearPendingQuestion = useCallback(() => setPendingQuestion(null), []);

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
          <TabButton active={tab === "forecast"} onClick={() => switchTab("forecast")}>
            Forecast
          </TabButton>
          <TabButton active={tab === "whatif"} onClick={() => switchTab("whatif")}>
            What if…
          </TabButton>
          <TabButton active={tab === "ask"} accent onClick={() => switchTab("ask")}>
            Ask
          </TabButton>
        </div>
      </header>

      {/* All three stay mounted and are hidden rather than swapped out, so each view
          keeps its state across a tab switch. Swapping them threw that state away: the
          conversation vanished, and the forecast's selected day snapped back to today.
          Both matter now that the suggestion buttons send people back and forth --
          picking Saturday, asking about it, and returning to "Today" is disorienting,
          and the next suggestion would then quietly be about the wrong day.
          `hidden` also drops the inactive views out of the accessibility tree. */}
      <div hidden={tab !== "forecast"}>
        <ForecastView onAsk={askAssistant} />
      </div>
      <div hidden={tab !== "whatif"}>
        <WhatIfView />
      </div>
      <div hidden={tab !== "ask"}>
        <ChatView
          pendingQuestion={pendingQuestion}
          onQuestionConsumed={clearPendingQuestion}
        />
      </div>

      <About />
    </main>
  );
}

function TabButton({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  /** Tint this tab when inactive so it does not read as the third of three peers.
   *  Cheaper and more honest than a "New" badge, which expires and needs removing. */
  accent?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const inactive = accent ? "text-sun" : "text-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`rounded-xl py-2.5 text-sm font-bold transition ${
        active ? "bg-surface text-ink shadow-soft" : inactive
      }`}
    >
      {children}
    </button>
  );
}
