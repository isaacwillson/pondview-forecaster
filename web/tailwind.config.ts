import type { Config } from "tailwindcss";

// Colours are CSS-variable driven (app/globals.css) so light/dark switch cleanly.
// Busyness colours live in lib/busyness.ts and are applied inline per hour.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        sun: "var(--sun)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "var(--shadow)",
      },
      borderRadius: {
        "4xl": "1.75rem",
      },
      maxWidth: {
        app: "30rem", // phone column
        desk: "78rem", // desktop page shell
      },
    },
  },
  plugins: [],
};

export default config;
