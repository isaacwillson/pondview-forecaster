"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import type { BeforeSendFn } from "posthog-js";

/**
 * Messages thrown by scripts that in-app browsers inject into the page.
 * The Facebook iOS in-app browser probes for its native bridge and throws
 * this one. The code is not ours, so the exception is noise.
 */
const INJECTED_BROWSER_NOISE = ["window.webkit.messageHandlers"];

/**
 * Drops an unhandled exception that carries no frame from our bundle and
 * matches a known injected message. Genuine app errors keep their own
 * frames, so they still flow.
 */
const dropInjectedBrowserNoise: BeforeSendFn = (event) => {
  if (!event || event.event !== "$exception") {
    return event;
  }

  const exceptions = event.properties?.$exception_list;
  if (!Array.isArray(exceptions) || exceptions.length === 0) {
    return event;
  }

  const allInjectedNoise = exceptions.every((exception) => {
    if (exception?.mechanism?.handled !== false) {
      return false;
    }
    const frames = exception?.stacktrace?.frames;
    const fromOurBundle =
      Array.isArray(frames) && frames.some((frame) => frame?.in_app);
    if (fromOurBundle) {
      return false;
    }
    const message = exception?.value ?? "";
    return INJECTED_BROWSER_NOISE.some((pattern) => message.includes(pattern));
  });

  return allInjectedNoise ? null : event;
};

/**
 * Initializes posthog-js once on the client.
 *
 * Rendered inside the root layout so PostHog is available to every page.
 * Guarded behind the presence of the env var so the app boots normally
 * without a PostHog key configured.
 *
 * Development builds log a loud warning when the key is absent so the
 * omission is obvious to contributors, but production stays a silent no-op.
 */
export function PostHogSetup() {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    if (!token) {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, " +
            "this causes events to be silently missed. " +
            "This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
        );
      }
      return;
    }

    posthog.init(token, {
      api_host: "/ingest",
      ui_host: host ?? "https://us.posthog.com",
      defaults: "2026-01-30",
      capture_exceptions: true,
      debug: process.env.NODE_ENV === "development",
      before_send: dropInjectedBrowserNoise,
    });
  }, []);

  return null;
}
