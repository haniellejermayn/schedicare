# DESIGN.md — SchediCare

> **Historical document.** This is the original pitch-era design spec (warm
> purple tokens, three-pane ops view, replay scrubber, command bar). The
> shipped UI was rebuilt as a clinical-neutral, single-column front desk in
> secretary language — see PROJECT_STATUS.md ("v2 — LangGraph orchestration +
> front-desk redesign"). Kept for the record; do not treat as current UI
> documentation.

The pitch mockup (`Schediaid_dc.html`) already establishes a strong, coherent visual identity — a warm purple healthcare-tech look with soft depth and confident typography. This document extracts it into a reusable system, then extends it to the surfaces the mockup didn't cover (staff ops center, agent activity feed, approval flow). **Keep the mockup's language; don't revamp it.** It photographs well, it's distinctive, and consistency between pitch and final demo reads as execution maturity to a panel.

## 1. Design tokens (extracted from the mockup)

### Color

| Token              | Value                                         | Use                                            |
| ------------------ | --------------------------------------------- | ---------------------------------------------- |
| `--primary`        | `#5B2FCE`                                     | Brand, primary actions, agent identity         |
| `--primary-strong` | `#3D2A8C`                                     | Emphasis text on lavender surfaces             |
| `--primary-soft`   | `#EDE8FF`                                     | Lavender chips, selected states, agent bubbles |
| `--gradient-brand` | `linear-gradient(160deg,#5B2FCE,#7B4FE0)`     | Hero headers                                   |
| `--bg`             | `#F4F2FB`                                     | App background                                 |
| `--surface`        | `#FFFFFF`                                     | Cards                                          |
| `--surface-tint`   | `#F8F6FE`                                     | Nested cards, detail blocks                    |
| `--border`         | `#E9E6F2` / `#EEEBF7`                         | Hairlines                                      |
| `--ink`            | `#1E1B2E`                                     | Primary text                                   |
| `--ink-2`          | `#6B6685` / `#7A7390`                         | Secondary text                                 |
| `--ink-3`          | `#9A93B5`                                     | Tertiary / labels                              |
| `--success`        | `#18A06A` (`gradient 160deg #18A06A→#23B57C`) | Confirmations, resolved                        |
| `--warning`        | `#B5791F` on `#FFF6E9`, border `#F6E2BD`      | At-risk, unconfirmed                           |
| `--danger`         | `#C0392B`                                     | Emergency, escalated                           |

Extend for the ops center (same saturation family):
`--info #2F6FCE` on `#E8F0FF` (in-progress), `--muted-chip #F1EFF8` (queued).

### Shape, depth, type

- Radii: cards `18–20px`, hero/phone shell `30px`, chips/buttons `13–16px`, pills `999px`.
- Shadows: ambient `0 10px 30px rgba(45,27,90,0.05)`; floating `0 24px 60px rgba(45,27,90,0.14)`; primary button glow `0 8px 20px rgba(91,47,206,0.3)`.
- Type: system stack (`-apple-system, "Segoe UI", …`). Display 22–23px/700/−0.4px; metric numerals 34px/800/−1px; body 13–15px; labels 12–13px/600 in `--ink-2/3`. Tailwind mapping: keep tracking-tight on ≥18px.
- Logo: 30px rounded square rotated 45°, white 9px square core — reuse as the Orchestrator's avatar; sub-agents get the same mark in role colors.

### Motion (from mockup keyframes, keep exactly)

- `scd-in` — 350ms ease, fade + 8px rise: every card/list entrance. Stagger list children by 60ms.
- `scd-pop` — 500ms overshoot scale: success checks, approvals landing.
- `scd-blink` — 1.4s opacity pulse: live status dots (agent working, doctor status).
- `scd-spin` — spinners.
- Rule: motion communicates _agent activity and state change_, never decoration. Respect `prefers-reduced-motion`.

## 2. Information architecture

```
/               marketing-less redirect → /ops
/book           Patient app (phone-frame card, as mockup)
/doctor         Doctor dashboard (as mockup + rules editor)
/ops            Staff ops center  ← primary demo surface (new)
/ops/cases/:id  Case detail (timeline, plans, approvals, replay)
/admin          Metrics + audit search (thin)
```

## 3. Surfaces

### 3.1 Patient app (keep mockup, minor upgrades)

Mockup screens retained: Search (gradient hero "Hi Maria — when works?", doctor card, Routine/Urgent toggle, 2-col slot chips, CTA), Confirm (green gradient, pop check, detail rows, reminder banner), Reschedule (lavender notice + 3 alternative rows).
Additions: **Follow-up** as third type chip (proposal requires it); slot chips show a subtle rule hint on long-press ("Dr. Santos keeps mornings for follow-ups"); disruption push state — when the clinic cancels, the patient sees the same 3-alternative pattern with an apology header in `--warning` palette.

### 3.2 Doctor dashboard (keep mockup, add rules editor)

Retained: identity header with blinking status pill, capacity card (`n / 15` + progress bar), week strip with Morning·Follow-ups / Afternoon·Consults blocks, clinic-flow card with "Walk-ins trending high" chip and at-risk slot rows.
Added: **Rules editor** — a card of plain-language toggles/steppers that literally are the Scheduling agent's constraints (windows per type, buffer minutes, max/day, max/block). Emphasize in demo: _the doctor edits a rule, the agent's next plan respects it._
Added: **Emergency unavailability** — red-outline button → date-range sheet → confirm shows "SchediCare is opening a recovery case" with the blink dot. This is the doctor-side trigger of The Cascade.

### 3.3 Staff ops center (new — the demo star)

Three-pane layout, 1180px max width like the doctor view:

```
┌────────────┬──────────────────────────────┬───────────────────┐
│ Case queue │ Case detail                  │ Agent activity    │
│ (severity- │ · blast-radius patient cards │ feed (live, SSE)  │
│  sorted    │ · ranked plan per patient    │ · avatar + verb   │
│  list)     │   with “Why?” expander       │ · streaming lines │
│            │ · approval bar               │ · scd-blink while │
│            │   [Approve all][Modify][✕]   │   agent working   │
└────────────┴──────────────────────────────┴───────────────────┘
```

- **Case card** (queue): severity edge-stripe (danger/warning/info), title ("Dr. Santos — emergency absence"), progress micro-bar of state machine stages, affected count pill.
- **Recommendation card**: patient avatar-initials, current → proposed appointment (before/after in one row, arrow between), score as a subtle 5-dot meter, "Why?" expander listing constraint chips (each chip = one rule/preference/capacity fact used). Approve = primary button (pop animation on land), Modify opens slot-picker constrained to validator-passing options only, Reject requires a reason (feeds the eval + audit).
- **Approval bar** is sticky and shows the safety line verbatim: _"Nothing is sent or written until you approve."_
- **Agent feed entry**: role-colored logo avatar, agent name, action verb line, optional detail line, timestamp; entries stream in with `scd-in`, active agent's dot blinks; on case resolution the feed collapses into the replay scrubber.
- **Recovery scoreboard**: slim top strip on `/ops` — big numerals (34/800/−1px style): minutes-to-recovery ticking, slots recovered, drafts awaiting approval, staff clicks saved.

### 3.4 Case replay (audit)

Horizontal scrubber over `case_timeline`; dragging re-renders feed + detail panes at that instant. Chips mark human decisions in `--primary`, agent actions in role colors, external effects (calendar write, send) in `--success`. Export as PDF for the appendix.

## 4. Component inventory (shadcn/ui base + custom)

Custom: `AgentAvatar`, `AgentFeedItem`, `CaseCard`, `StateProgress`, `RecommendationCard`, `WhyExpander` (constraint chips), `BeforeAfterSlot`, `CapacityBar`, `RiskChip`, `ApprovalBar`, `ReplayScrubber`, `Scoreboard`, `PhoneFrame` (patient shell), `EmergencySheet`, `RulesEditor`.
shadcn primitives: button, card, dialog, sheet, dropdown, toast (sonner), command (⌘K), tabs, badge, tooltip, skeleton.

## 5. Voice & content rules

- Agent feed verbs: present progressive while running ("Ranking recovery options for 9 patients…"), past tense on completion ("Ranked 27 options · top plan attached").
- Patient-facing drafts: warm, short, no medical content, always one clear ask, always an opt-out ("reply STOP / none of these work").
- Never anthropomorphize beyond role names in UI copy; the system says "SchediCare suggests", staff "approve" — vocabulary mirrors the safety model.
- Empty states teach: an empty case queue says "No disruptions. The daily sweep runs at 6:00 AM."

## 6. Accessibility

- All state color pairs meet WCAG AA on their backgrounds (the mockup's `#B5791F`/`#FFF6E9` and `#18A06A`/white pass for the sizes used; body text stays ≥13px).
- Status never conveyed by color alone (dot + label; stripe + text).
- Full keyboard path for the approval flow (the thing staff do most); ⌘K command bar doubles as the accessibility fast path.
- `prefers-reduced-motion`: blink → static dot, entrances → opacity only.

## 7. Demo staging notes

- Ops center on the projector, patient phone-frame on a second window for the reply moment.
- Dark venue? The palette is light — bump `--bg` contrast is unnecessary; instead raise projector zoom on the feed pane during The Cascade.
- Pre-warm: run one throwaway case before presenting so model cold-start latency never eats the moment.
