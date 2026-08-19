"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

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
    });
  }, []);

  return null;
}
