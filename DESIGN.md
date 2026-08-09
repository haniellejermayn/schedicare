# DESIGN.md — SchediCare visual system ("Atlas Console" adaptation)

The current look and feel: a warm-paper console. Calm and humane in the
foreground (a tool secretaries live in), with a quiet technical spine
showing through in mono details — which is also the demo story: plain
language by default, the trace one toggle away.

Source of truth for raw tokens: `tokens.json` (mirrored as CSS variables in
`app/globals.css` and mapped to semantics in `tailwind.config.ts`). Change
tokens there; components consume only semantic names.

## Tokens

**Canvas & ink.** Canvas `#f7f5ef` (page), white surfaces for cards,
`#f4f6f0` / `#ecf0e7` for alt/strong fills. Ink `#17212b`, soft ink
`#2f3a45`, muted `#62707c`. Lines are ink at 12% (default) and 20% (strong,
used for hover borders).

**Type.** Space Grotesk (display: page titles, card titles, wordmark) ·
Spline Sans (body) · IBM Plex Mono (eyebrows, mode indicator, timestamps,
technical timeline detail). Loaded via CSS `@import` with system fallbacks —
the build never depends on the network.

**Semantic hues.** The four Atlas hues map to the app's existing tones:

| Tone          | Meaning here                         | Rail/fill (raw) | Text/solid (AA)             |
| ------------- | ------------------------------------ | --------------- | --------------------------- |
| accent (teal) | primary action, brand, active states | `#1a7f79`       | `#16746e` (press `#125e59`) |
| ok (moss)     | success, confirmed, resolved         | `#5f8b5a`       | `#45703f`                   |
| warn (amber)  | waiting, attention, demo mode        | `#d8a357`       | `#8a6425`                   |
| bad (clay)    | alerts, escalation, danger actions   | `#c86b4b`       | `#9c4626`                   |
| tech (navy)   | technical/agent accents              | `#1c3d5a`       | same                        |

**Why two grades per hue:** raw amber (~2.2:1) and clay (~3.4:1) fail WCAG
AA as text on white. Rails, dots, and soft fills use the raw hues (3:1
graphical contrast suffices); text, chips, and solid buttons use the darker
grades. Each tone also has `soft` (tinted fill) and `line` (tinted border).

**Geometry & motion.** Radii 8/12/18/28 (controls use 8, cards 12).
Ease `cubic-bezier(0.3, 0.8, 0.2, 1)`, durations 140/300ms, reduced-motion
respected globally.

## The signature: the cut

One place spends the boldness: pressable things carry a hard 2px ink edge
(`--shadow-cut: 0 2px 0 rgba(23,33,43,.55)`) that compresses flat on
`:active` (1px translate, shadow removed). Buttons, the active role pill,
and the logo mark get it. Nothing else does — cards are flat with 1px
lines; the soft shadow (`0 18px 36px`) is reserved for modals. If a surface
feels bare, the answer is spacing and type, not more shadow.

## Component rules

- **RailRow** stays the list unit: a 3px left rail in the tone's _raw_ hue
  on a flat white card. The inbox is a stack of rails, not a stack of
  shadows.
- **Chips** use `soft` fill + `line` border + AA text grade. Neutral chips
  sit on `surface-alt`.
- **Eyebrows** are mono, 10.5px, 0.14em tracked, uppercase, muted — the
  console voice. Use them for section labels, never for emphasis.
- **Timestamps and IDs** may use mono + `tnum`; body copy never does.
- **Focus** is a 2px teal outline, offset 2 — visible on every interactive
  element, no exceptions.
- Buttons keep their verbs ("Approve", "Can't do this") — copy is design
  material; see the writing rules in the repo's component copy
  (`components/copy.ts`).

## History

The original pitch-era spec (warm purple, three-pane ops view, replay
scrubber) was retired when the front desk was rebuilt as a single-column
inbox in secretary language (PROJECT_STATUS.md, "v2"). This Atlas Console
system restyles that v2 structure; it does not change layout or flows.
