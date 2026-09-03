import type { Config } from "tailwindcss";

// Colours are CSS-variable driven (app/globals.css) so light/dark switch cleanly.
// The busyness ramp lives in lib/busyness.ts and is applied inline per mark.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        plane: "var(--plane)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        muted: "var(--muted)",
        line: "var(--line)",
        grid: "var(--grid)",
        axis: "var(--axis)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        // Used for figures, axis ticks and anything that reads as a measurement.
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "var(--shadow)",
      },
      // Deliberately tight. The old scale topped out at 1.75rem, which reads as a
      // consumer app; a data tool wants corners you barely notice.
      borderRadius: {
        card: "0.625rem",
      },
      maxWidth: {
        app: "30rem", // phone column
        desk: "82rem", // desktop page shell
      },
    },
  },
  plugins: [],
};

export default config;
