import type { Config } from "tailwindcss";

/**
 * Atlas Console adaptation (see DESIGN.md). Semantic mapping:
 *   accent = teal (primary/brand) · ok = moss · warn = amber · bad = clay
 *   tech = navy (technical/mono accents)
 * Per tone: DEFAULT is the WCAG-AA text/solid grade; `rail` is the raw Atlas
 * hue for rails, dots, and fills (3:1 graphical contrast is enough there);
 * soft/line are tinted fill/border. Existing class names keep working.
 */
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#f7f5ef",
        surface: { alt: "#f4f6f0", strong: "#ecf0e7" },
        line: "rgba(23, 33, 43, 0.12)",
        strong: "rgba(23, 33, 43, 0.2)",
        ink: { DEFAULT: "#17212b", soft: "#2f3a45" },
        muted: "#62707c",
        tech: "#1c3d5a",
        accent: {
          DEFAULT: "#16746e",
          rail: "#1a7f79",
          soft: "#e4f0ee",
          line: "#b7d6d3",
          press: "#125e59",
        },
        ok: {
          DEFAULT: "#45703f",
          rail: "#5f8b5a",
          soft: "#ecf2e8",
          line: "#c6d8c0",
        },
        warn: {
          DEFAULT: "#8a6425",
          rail: "#d8a357",
          soft: "#f7eedd",
          line: "#e8d3ab",
        },
        bad: {
          DEFAULT: "#9c4626",
          rail: "#c86b4b",
          soft: "#f6e8e2",
          line: "#e7c3b4",
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ['"Spline Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { card: "12px", ctl: "8px", lg2: "18px", xl2: "28px" },
      boxShadow: {
        cut: "0 2px 0 rgba(23, 33, 43, 0.55)",
        soft: "0 18px 36px rgba(23, 33, 43, 0.14)",
      },
      transitionTimingFunction: { snappy: "cubic-bezier(0.3, 0.8, 0.2, 1)" },
      transitionDuration: { fast: "140ms", base: "300ms" },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(0.98)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        rise: "rise 160ms ease-out both",
        pop: "pop 140ms ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
