# DESIGN.md — SchediCare visual system

A clinical-modern console: cool neutrals, an azure primary, and quiet
elevation. The interface gets out of the way of the one thing that matters on
screen — what needs a human decision right now.

**Source of truth: `design/tokens.ts`.** `tailwind.config.ts` imports that
module directly; `app/globals.css` mirrors it as CSS custom properties; and
`tests/tokens.test.ts` fails the build if the two ever disagree. Change values
in `design/tokens.ts` and update the `:root` block to match — the test tells you
if you missed one.

## Why the system was rebuilt

The previous system ("Atlas Console", warm paper and teal) shipped **two
complete styling layers at once**: hand-written component classes in
`globals.css` transcribed from a `frontdesk_reference.html` that was never in
the repo, plus a parallel Tailwind token set in `components/ui.tsx`. `/ops` used
the first, every other page used the second, and `app/doctor/page.tsx` carried a
third palette inline. Three different ambers were live simultaneously. Four
colour pairs failed WCAG AA — including two that `DESIGN.md` itself claimed were
compliant. That inconsistency, more than any individual screen, is what read as
unfinished.

## Tokens

**Neutrals.** Canvas `#F5F7FA` (page), white surfaces, `#F1F5F9` / `#E2E8F0`
for quiet and strong fills. Ink `#0F1B2D`, soft ink `#31465C`, muted `#5A6B80`.
Borders `#E3E8EF` default, `#CBD5E1` strong. The greys carry a slight blue bias
toward the accent — a neutral that was chosen, not inherited.

**Semantic tones.** Five, each with two grades:

| Tone            | Meaning                                | Text/solid (AA) | Rail (3:1) |
| --------------- | -------------------------------------- | --------------- | ---------- |
| accent (azure)  | brand, primary action, human decisions | `#1B5FD9`       | `#2C6FE8`  |
| ok (green)      | confirmed, resolved, healthy capacity  | `#0E7A4D`       | `#16A265`  |
| warn (amber)    | waiting, unconfirmed, resilience mode  | `#9A5B06`       | `#C77505`  |
| bad (red)       | escalation, danger, at-risk            | `#C0322A`       | `#E04B3C`  |
| tech (slate)    | agent + technical register             | `#2B4763`       | `#456F96`  |

**The two grades are load-bearing.** `DEFAULT` clears AA (≥4.5:1) on white *and*
on canvas — use it for text, for icons that carry meaning alone, and for solid
button fills. `rail` is the vivid grade for status rails, dots and marks, where
3:1 graphical contrast is enough. **Reaching for a `rail` grade as a text colour
is the mistake that broke accessibility in the old system**, and the token test
now asserts both thresholds.

Two values are deliberately unusual. Amber's rail is `#C77505`, darker than a
natural amber, because the vivid `#E8971C` most scales land on measures 2.37:1 —
it cannot carry a status rail. And calendar blocks render as `soft` fill +
`DEFAULT` text rather than a saturated fill with white type: at the 9–10px a
dense week grid needs, white on `ok.rail` is only 3.29:1.

**Type.** Inter for the interface, IBM Plex Mono for the technical register —
timestamps, IDs, tool-call traces, live counters. Both are **self-hosted at
build time** via `next/font` (`app/fonts.ts`). The old `@import` from the Google
Fonts CDN meant flaky venue wi-fi could silently fall back to system-ui and
reflow every screen mid-demo.

The scale lives in `tailwind.config.ts` and is tight on purpose: `micro` 10.5 ·
`xs` 11.5 · `sm` 12.5 · `base` 14 · `md` 15 · `lg` 17 · `xl` 20 · `2xl` 24 ·
`3xl` 30. Anything off the scale is a mistake — there were 157 arbitrary
`text-[13px]`-style values before this pass.

**Geometry & motion.** Radii 8 (controls) / 12 (cards) / 16 (modals). Elevation
is quiet: `xs` and `sm` for resting surfaces, `md` on hover, `lg` for modals
only. Ease `cubic-bezier(0.2, 0.8, 0.2, 1)`, 130/220ms, reduced motion respected
globally.

**What was retired.** The Atlas "cut" — a hard 2px ink edge under every
pressable thing that compressed on `:active`. It was the old signature; this
system spends its emphasis on type and colour instead, so that the one urgent
thing on a screen is the thing that stands out.

## Structure

Chrome lives in **per-role shells**, not in the root layout, because a doctor
looking at their own day and a receptionist working a queue are not the same
product:

- `app/(frontdesk)/` → `FrontDeskShell`. Compact console bar, wide well
  (1240px), running clock, integration mode, approval-gate footer. Covers
  `/ops`, `/ops/cases/[id]`, `/settings`.
- `app/(doctor)/` → `DoctorShell`. White header band, narrower well (1080px),
  more vertical rhythm, no staff footer. The doctor selector lives in the page,
  not the shell — the page already owns that state.
- `/book` → `PatientShell`, rendered by the page itself because the shell owns
  tab state. Mobile-first, 520px centred on desktop, bottom tab bar on phones,
  safe-area padding for the iPhone home indicator.

Route groups mean `(frontdesk)` and `(doctor)` never appear in a URL.

The role switcher persists in every shell (there is no auth — see
PROJECT_STATUS), but on the patient view it collapses into a discreet corner
"Demo" control, because a visible staff switcher would break the illusion that
this is a patient's own phone.

## Component rules

- **Primitives live in `components/ui.tsx`.** One file, stable import path.
  Nothing should hand-roll a button, chip, card, field or modal.
- **RailRow** is the list unit: a 3px left rail in the tone's `rail` grade on a
  flat card. The queue is a stack of rails, not a stack of shadows.
- **Chips** use `soft` fill + `line` border + the AA text grade.
- **CaseIcon** marks queue rows by the case's typed `type` enum. It replaced
  initials derived from the title, which produced markers like "VS" for
  "Vacated slot: Liza Soriano".
- **Eyebrows** are mono, 10.5px, tracked, uppercase, muted — the console voice.
  Section labels only, never emphasis.
- **Timestamps, IDs and counters** use mono + `.tnum`; body copy never does.
  Tabular figures stop live counters jittering during the cascade.
- **Focus** is a 2px accent outline, offset 2, on every interactive element.
- **Modals trap focus** and restore it on close. PROJECT_STATUS previously
  listed dialog focus traps as a known gap.
- **Never colour alone.** Status always pairs a tone with a label or shape —
  the booking calendar's availability dot sits alongside a disabled state and an
  aria-label, not on its own.
- Buttons keep their verbs ("Approve", "Can't do this"). Copy is design
  material; see `components/copy.ts`, which stays in staff language. The patient
  view has its own status vocabulary — a patient is never told their appointment
  is a "Temporary hold".

## Checking your work

```bash
npx vitest run tests/tokens.test.ts
```

26 assertions: stylesheet-vs-module drift, every tone's text grade against white
and canvas, white-on-solid for buttons, rail grades at 3:1, chip text on its own
soft fill, and that no CSS variable is used without being declared.
