"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, postChat } from "@/lib/api";
import type { ChatTurn } from "@/lib/types";

/**
 * Ask-a-question view.
 *
 * The assistant's scope is deliberately narrow -- arrivals, by hour, from weather -- and
 * a bare text box gives a resident no way to guess that. So an empty conversation leads
 * with real example questions, including one the assistant will decline, which teaches
 * the boundary faster than any explanatory paragraph.
 *
 * No streaming: the API buffers the whole reply (see api/main.py), so the wait is a few
 * seconds of nothing. That makes an explicit thinking state load-bearing rather than
 * decorative.
 */

/** Kept in step with MAX_HISTORY_TURNS in api/main.py -- the server trims to this too. */
const MAX_HISTORY_TURNS = 10;
/** Matches MAX_MESSAGE_CHARS in api/main.py, so the limit is felt before the round trip. */
const MAX_MESSAGE_CHARS = 500;

/**
 * Daily question budget.
 *
 * This is a courtesy limit, NOT a security control, and it is worth being blunt about
 * why: the API base URL is compiled into this bundle, so anyone can read it out of
 * devtools and call /chat directly, and nothing here runs for them. What it does do is
 * stop honest overuse -- an idle afternoon of questions, a stuck finger on the example
 * buttons -- which is realistically almost all the traffic this will ever see.
 *
 * The controls that actually bound spend live outside the browser: the per-minute
 * limiter in api/main.py, a concurrency cap on the function, and a spend cap on the
 * account.
 */
const DAILY_QUESTION_LIMIT = 25;
/** Show the remaining count only once it starts to matter, so it isn't a meter all day. */
const REMAINING_VISIBLE_AT = 5;
const USAGE_KEY = "pondview.chat.usage";

interface StoredUsage {
  date: string;
  count: number;
}

/** Local calendar date -- the reset should land at the resident's midnight, not UTC. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Questions used today. Any storage problem reads as zero: a resident who blocks
 *  storage or browses privately gets the feature, not a lockout. */
function readUsage(): number {
  try {
    const raw = window.localStorage.getItem(USAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as StoredUsage;
    return parsed?.date === todayKey() && Number.isFinite(parsed.count)
      ? parsed.count
      : 0;
  } catch {
    return 0;
  }
}

function writeUsage(count: number): void {
  try {
    const stored: StoredUsage = { date: todayKey(), count };
    window.localStorage.setItem(USAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable (private mode, quota, blocked). The in-memory count still
    // holds for this page view, which is the common case anyway.
  }
}

const EXAMPLES = [
  "When is the pool least busy tomorrow?",
  "Is Saturday afternoon going to be crowded?",
  "Does rain actually keep people away?",
  "How many people are there right now?",
];

interface Message extends ChatTurn {
  id: number;
}

export function ChatView({
  pendingQuestion,
  onQuestionConsumed,
}: {
  /** A question handed over from another view (the forecast suggestions). Asked on
   *  arrival, so the resident lands here with the answer already coming. */
  pendingQuestion: string | null;
  onQuestionConsumed: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Read after mount, never during render: localStorage does not exist while this page
  // is prerendered, and branching on it in the render body is a hydration mismatch.
  const [used, setUsed] = useState(0);
  const [usageReady, setUsageReady] = useState(false);
  useEffect(() => {
    setUsed(readUsage());
    setUsageReady(true);
  }, []);

  const remaining = Math.max(0, DAILY_QUESTION_LIMIT - used);
  const exhausted = usageReady && remaining === 0;

  // Follow the conversation as it grows, but never on first paint -- yanking a page the
  // resident hasn't scrolled is worse than leaving it be.
  useEffect(() => {
    if (messages.length > 0 || pending) {
      scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, pending]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || pending || exhausted) return;

      // The turns sent back are exactly what is on screen, trimmed to the same window
      // the server keeps. Read before the optimistic append so the new question isn't
      // included in its own history.
      const history: ChatTurn[] = messages
        .slice(-MAX_HISTORY_TURNS)
        .map(({ role, content }) => ({ role, content }));

      setMessages((prev) => [
        ...prev,
        { id: nextId.current++, role: "user", content: question },
      ]);
      setDraft("");
      setError(null);
      setPending(true);

      try {
        const reply = await postChat({ message: question, history });
        setMessages((prev) => [
          ...prev,
          { id: nextId.current++, role: "assistant", content: reply.answer },
        ]);
        // Only a real answer spends budget. A network failure cost the resident their
        // question already; charging them for it too would be the wrong way round.
        setUsed((prev) => {
          const next = prev + 1;
          writeUsage(next);
          return next;
        });
      } catch (err: unknown) {
        setError(
          err instanceof ApiError ? err.message : "Something went wrong. Try again?",
        );
      } finally {
        setPending(false);
        inputRef.current?.focus();
      }
    },
    [messages, pending, exhausted],
  );

  // Ask a question handed over from the forecast view. The ref guards two things: a
  // second delivery of the same question (React re-invokes effects on mount in dev
  // StrictMode, which would send it twice), and re-firing when `send` is rebuilt as
  // messages change. It clears once the prop goes back to null, so tapping the same
  // suggestion again later still works.
  const handedOver = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingQuestion) {
      handedOver.current = null;
      return;
    }
    if (handedOver.current === pendingQuestion) return;
    handedOver.current = pendingQuestion;
    onQuestionConsumed();
    void send(pendingQuestion);
  }, [pendingQuestion, onQuestionConsumed, send]);

  const empty = messages.length === 0;

  return (
    <div className="space-y-4 lg:space-y-6">
      <section className="flex flex-col rounded-4xl bg-surface/80 p-5 shadow-soft backdrop-blur lg:p-8">
        <div
          className="min-h-[18rem] space-y-3 lg:min-h-[26rem] lg:space-y-4"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {empty ? (
            <Opening onPick={send} disabled={pending || exhausted} />
          ) : (
            messages.map((m) => <Bubble key={m.id} role={m.role} text={m.content} />)
          )}

          {pending ? <Thinking /> : null}

          {error ? (
            <p
              className="rounded-2xl bg-surface-2 px-4 py-3 text-sm font-semibold text-ink"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div ref={scrollAnchor} />
        </div>

        {exhausted ? (
          <p
            className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm font-semibold text-ink lg:mt-6 lg:text-base"
            role="status"
          >
            That&rsquo;s {DAILY_QUESTION_LIMIT} questions today — the daily limit. It
            resets tomorrow, and the Forecast and What&nbsp;if tabs still work.
          </p>
        ) : (
          <form
            className="mt-4 flex gap-2 lg:mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Ask about how busy the pool will be
            </label>
            <input
              id="chat-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder="Ask about how busy it'll be…"
              autoComplete="off"
              disabled={pending}
              className="min-w-0 flex-1 rounded-2xl bg-surface-2 px-4 py-3 text-ink placeholder:text-muted disabled:opacity-60 lg:text-lg"
            />
            <button
              type="submit"
              disabled={pending || draft.trim().length === 0}
              className="shrink-0 rounded-2xl bg-ink px-5 py-3 text-sm font-bold text-surface transition disabled:opacity-40 lg:px-7 lg:text-base"
            >
              Ask
            </button>
          </form>
        )}

        <p className="mt-3 text-xs text-muted lg:text-sm">
          Answers cover how many families <strong>arrive</strong> each hour, not how many
          people are at the pool. It can&rsquo;t see the pool — only predict from weather.
          {usageReady && !exhausted && remaining <= REMAINING_VISIBLE_AT ? (
            <>
              {" "}
              <span className="font-semibold text-ink">
                {remaining} {remaining === 1 ? "question" : "questions"} left today.
              </span>
            </>
          ) : null}
        </p>
      </section>
    </div>
  );
}

function Opening({
  onPick,
  disabled,
}: {
  onPick: (q: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className="font-bold text-ink lg:text-lg">Ask about the crowd</p>
      <p className="mt-1 text-sm text-muted lg:text-base">
        Try one of these, or type your own question.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onPick(q)}
            className="rounded-2xl bg-surface-2 px-4 py-2.5 text-left text-sm font-semibold text-ink transition hover:bg-surface disabled:opacity-60 lg:text-base"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: ChatTurn["role"]; text: string }) {
  const isUser = role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 lg:max-w-[75%] lg:text-lg ${
          isUser
            ? "bg-ink text-surface"
            : "bg-surface-2 text-ink"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl bg-surface-2 px-4 py-3.5">
        <span className="sr-only">Working it out…</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-pulse rounded-full bg-muted"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
