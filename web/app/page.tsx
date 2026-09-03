"use client";

import { useCallback, useState, type ReactNode } from "react";
import posthog from "posthog-js";
import { ForecastView } from "@/components/ForecastView";
import { WhatIfView } from "@/components/WhatIfView";
import { ChatView } from "@/components/ChatView";
import { Methodology } from "@/components/Methodology";
import { SOURCE_REPO_URL } from "@/lib/site";

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
    <main className="mx-auto min-h-dvh w-full max-w-app px-4 pb-12 pt-6 md:max-w-2xl md:px-8 lg:max-w-desk lg:px-10 lg:pb-16 lg:pt-10">
      <header className="mb-4 lg:mb-6 lg:flex lg:items-end lg:justify-between lg:gap-10">
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-ink lg:text-2xl">
              Pondview Pool Forecaster
            </h1>
            {/* On a page whose whole argument is "this was built carefully", the source
                is part of the argument. Hidden on a phone, where a resident is here to
                read a number and the header has no room to spare. */}
            <a
              href={SOURCE_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden text-xs text-muted underline underline-offset-2 hover:text-ink lg:inline"
            >
              Source
            </a>
          </div>
          <p className="mt-1 text-sm text-muted">
            Predicted family arrivals per hour, from the day&rsquo;s weather.
          </p>
        </div>

        <div
          className="mt-4 grid grid-cols-3 gap-1 rounded border border-line bg-surface-2 p-1 lg:mt-0 lg:w-[24rem] lg:shrink-0"
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

      {/* Always visible, never behind a disclosure. The forecast is the product; this is
          the evidence that the forecast is worth anything, and evidence folded into a
          <details> is evidence nobody reads. */}
      <Methodology />
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
   *  Cheaper and more honest than a "New" badge, which expires and needs removing.
   *  The one deliberate exception to "colour belongs to the data" -- it is the only
   *  cue that the assistant exists for someone who never scrolls to the suggestions. */
  accent?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const inactive = accent ? "text-accent-ink hover:opacity-80" : "text-muted hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`rounded-[3px] py-2 text-sm transition ${
        active ? "bg-surface font-medium text-ink shadow-soft" : inactive
      }`}
    >
      {children}
    </button>
  );
}
