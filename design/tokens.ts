/**
 * SchediCare design tokens — the single source of truth.
 *
 * `tailwind.config.ts` imports this module directly. `app/globals.css` mirrors
 * it as CSS custom properties, and `tests/tokens.test.ts` fails the build if
 * the two ever drift apart again (they did: the previous system carried three
 * different values for "amber" across two files and a component).
 *
 * Two grades per semantic tone, and the distinction is load-bearing:
 *   - `DEFAULT` is the WCAG-AA grade (>= 4.5:1 on white AND on canvas). Use it
 *     for text, icons that carry meaning alone, and solid button fills.
 *   - `rail` is the vivid grade. Use it only where 3:1 graphical contrast is
 *     sufficient: status rails, dots, chart marks, calendar blocks.
 * Reaching for `rail` as a text color is the mistake that broke accessibility
 * in the previous system.
 */

export const neutral = {
  /** Page background. Cool enough that white cards read as raised. */
  canvas: "#F5F7FA",
  surface: "#FFFFFF",
  /** Inputs, table stripes, quiet fills. */
  surfaceAlt: "#F1F5F9",
  /** Avatars, pressed states, stronger quiet fills. */
  surfaceStrong: "#E2E8F0",
  line: "#E3E8EF",
  lineStrong: "#CBD5E1",
  /** Primary text. A very dark cool navy — pure black reads harsh on canvas. */
  ink: "#0F1B2D",
  inkSoft: "#31465C",
  /** Secondary text. 5.45:1 on white, 5.08:1 on canvas. */
  muted: "#5A6B80",
} as const;

export const tone = {
  /** Brand, primary actions, active navigation, human-initiated things. */
  accent: {
    DEFAULT: "#1B5FD9", // 5.70:1 on white
    rail: "#2C6FE8",
    soft: "#EAF1FE",
    line: "#BFD5F8",
    press: "#1749AB",
  },
  /** Confirmed, resolved, healthy capacity. */
  ok: {
    DEFAULT: "#0E7A4D", // 5.37:1 on white
    rail: "#16A265",
    soft: "#E6F6EE",
    line: "#B4E3CC",
  },
  /** Waiting on someone, needs attention, simulated/resilience mode. */
  warn: {
    DEFAULT: "#9A5B06", // 5.42:1 on white
    // Darker than a "natural" amber on purpose: the vivid #E8971C most amber
    // scales land on measures 2.37:1, which cannot carry a status rail.
    rail: "#C77505", // 3.27:1 on canvas
    soft: "#FDF3E3",
    line: "#F5D9A8",
  },
  /** Escalation, danger actions, overdue, at-risk. */
  bad: {
    DEFAULT: "#C0322A", // 5.63:1 on white
    rail: "#E04B3C",
    soft: "#FDECEA",
    line: "#F7C4BE",
  },
  /** Agent/technical detail — pairs with mono type. Deliberately not a 5th hue. */
  tech: {
    DEFAULT: "#2B4763",
    rail: "#456F96",
    soft: "#EDF2F7",
    line: "#C7D6E3",
  },
} as const;

/**
 * Visit types map to tone *names*, not raw hex, so the calendar, the booking
 * page and the legend can never drift apart again (they had three different
 * greens between them).
 *
 * Calendar blocks render as `soft` fill + `DEFAULT` text + a `rail` left edge
 * rather than a saturated fill with white text: at the 9-10px type a dense
 * week grid needs, white on `ok.rail` measures only 3.29:1. Soft-on-dark
 * clears AA and reads better at density.
 */
export const visitType = {
  routine: "accent",
  follow_up: "ok",
  urgent: "bad",
} as const;

export type ToneName = keyof typeof tone;
export type VisitTypeName = keyof typeof visitType;

export const radius = {
  ctl: "8px",
  card: "12px",
  modal: "16px",
  pill: "999px",
} as const;

/**
 * Soft elevation replaces the old "cut" (a hard 2px ink edge under pressable
 * things). The cut was the Atlas signature; clinical-modern spends its
 * boldness on type and colour instead, so shadows stay quiet and functional.
 */
export const shadow = {
  xs: "0 1px 2px rgba(15,27,45,.06)",
  sm: "0 1px 3px rgba(15,27,45,.08), 0 1px 2px rgba(15,27,45,.04)",
  md: "0 4px 12px rgba(15,27,45,.08)",
  lg: "0 12px 32px rgba(15,27,45,.12)",
} as const;

export const motion = {
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  fast: "130ms",
  base: "220ms",
} as const;

/**
 * The CSS custom properties emitted into `:root`. Kept as data so the token
 * test can diff it against the real stylesheet.
 */
export const cssVars: Record<string, string> = {
  "--canvas": neutral.canvas,
  "--surface": neutral.surface,
  "--surface-alt": neutral.surfaceAlt,
  "--surface-strong": neutral.surfaceStrong,
  "--line": neutral.line,
  "--line-strong": neutral.lineStrong,
  "--ink": neutral.ink,
  "--ink-soft": neutral.inkSoft,
  "--muted": neutral.muted,

  "--accent": tone.accent.DEFAULT,
  "--accent-rail": tone.accent.rail,
  "--accent-soft": tone.accent.soft,
  "--accent-line": tone.accent.line,
  "--accent-press": tone.accent.press,

  "--ok": tone.ok.DEFAULT,
  "--ok-rail": tone.ok.rail,
  "--ok-soft": tone.ok.soft,
  "--ok-line": tone.ok.line,

  "--warn": tone.warn.DEFAULT,
  "--warn-rail": tone.warn.rail,
  "--warn-soft": tone.warn.soft,
  "--warn-line": tone.warn.line,

  "--bad": tone.bad.DEFAULT,
  "--bad-rail": tone.bad.rail,
  "--bad-soft": tone.bad.soft,
  "--bad-line": tone.bad.line,

  "--tech": tone.tech.DEFAULT,
  "--tech-rail": tone.tech.rail,
  "--tech-soft": tone.tech.soft,
  "--tech-line": tone.tech.line,

  "--r-ctl": radius.ctl,
  "--r-card": radius.card,
  "--r-modal": radius.modal,

  "--shadow-xs": shadow.xs,
  "--shadow-sm": shadow.sm,
  "--shadow-md": shadow.md,
  "--shadow-lg": shadow.lg,

  "--ease": motion.ease,
  "--dur-fast": motion.fast,
  "--dur-base": motion.base,
};
