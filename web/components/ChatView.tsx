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

const EXAMPLES = [
  "When is the pool least busy tomorrow?",
  "Is Saturday afternoon going to be crowded?",
  "Does rain actually keep people away?",
  "How many people are there right now?",
];

interface Message extends ChatTurn {
  id: number;
}

export function ChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (!question || pending) return;

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
      } catch (err: unknown) {
        setError(
          err instanceof ApiError ? err.message : "Something went wrong. Try again?",
        );
      } finally {
        setPending(false);
        inputRef.current?.focus();
      }
    },
    [messages, pending],
  );

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
            <Opening onPick={send} disabled={pending} />
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

        <p className="mt-3 text-xs text-muted lg:text-sm">
          Answers cover how many families <strong>arrive</strong> each hour, not how many
          people are at the pool. It can&rsquo;t see the pool — only predict from weather.
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
