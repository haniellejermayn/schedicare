import type { Config } from "tailwindcss";
import { motion, neutral, radius, shadow, tone } from "./design/tokens";

/**
 * Values come from design/tokens.ts — never hardcode a hex here. Semantics:
 *   accent = azure (brand / primary action) · ok = green · warn = amber
 *   bad = red · tech = slate-navy (agent + technical register)
 *
 * Per tone, `DEFAULT` is the WCAG-AA text/solid grade and `rail` is the vivid
 * grade for rails, dots and marks. See the note in design/tokens.ts about why
 * that split exists.
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
        canvas: neutral.canvas,
        surface: {
          DEFAULT: neutral.surface,
          alt: neutral.surfaceAlt,
          strong: neutral.surfaceStrong,
        },
        line: { DEFAULT: neutral.line, strong: neutral.lineStrong },
        ink: { DEFAULT: neutral.ink, soft: neutral.inkSoft },
        muted: neutral.muted,
        accent: tone.accent,
        ok: tone.ok,
        warn: tone.warn,
        bad: tone.bad,
        tech: tone.tech,
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // A tight, deliberate scale. Anything not on it is a mistake.
        micro: ["10.5px", { lineHeight: "1.4", letterSpacing: "0.1em" }],
        xs: ["11.5px", { lineHeight: "1.45" }],
        sm: ["12.5px", { lineHeight: "1.5" }],
        base: ["14px", { lineHeight: "1.55" }],
        md: ["15px", { lineHeight: "1.5" }],
        lg: ["17px", { lineHeight: "1.4", letterSpacing: "-0.01em" }],
        xl: ["20px", { lineHeight: "1.3", letterSpacing: "-0.015em" }],
        "2xl": ["24px", { lineHeight: "1.22", letterSpacing: "-0.02em" }],
        "3xl": ["30px", { lineHeight: "1.18", letterSpacing: "-0.022em" }],
      },
      borderRadius: {
        ctl: radius.ctl,
        card: radius.card,
        modal: radius.modal,
      },
      boxShadow: {
        xs: shadow.xs,
        sm: shadow.sm,
        md: shadow.md,
        lg: shadow.lg,
      },
      transitionTimingFunction: { snappy: motion.ease },
      transitionDuration: { fast: motion.fast, base: motion.base },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(0.98)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        rise: "rise 180ms cubic-bezier(0.2,0.8,0.2,1) both",
        pop: "pop 140ms cubic-bezier(0.2,0.8,0.2,1) both",
        "slide-up": "slide-up 260ms cubic-bezier(0.2,0.8,0.2,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
