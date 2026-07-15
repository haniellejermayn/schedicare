# Security & scope boundaries

SchediCare is a scheduling-operations copilot. It is **not** a medical device,
triage tool, or clinical decision system, and it is built so it cannot drift
into one.

## Non-clinical by construction

- **Priority inputs are operational only:** appointment type, staff-entered
  priority, continuity notes (e.g. "post-op"), waiting time, attendance
  history. Agent system prompts forbid inferring urgency from symptoms; the
  deterministic fallbacks contain no clinical logic at all.
- **Inbound reply guard (`guardReply`, runs before any model):** medical
  content (symptoms, meds, vitals like "160/100", ER mentions), anger/legal
  threats, and prompt-injection patterns quarantine the thread —
  `needs_human`, staff notified, automation stops for that message.
- **Outbound draft lint (`bannedContentLint`):** any clinical language in a
  generated draft replaces the entire draft with a safe scheduling-only
  template, and the substitution is logged to the case feed.
- **Patient-facing footer:** "Scheduling assistant only — for medical concerns
  call the clinic."

## Human authority (the approval gate)

- State machine (`core/cases.ts`): `awaiting_approval → executing` requires an
  actor beginning with `staff` — agents and the executor throw `TransitionError`.
- Rejections **require a reason**; modifications only accept option ids that
  already passed the validator (junk ids → 422). Both are unit- and
  integration-tested through the real API routes.
- Effects are late: calendar writes happen only inside the executor after
  approval, with a fresh `validatePlacementNow` — stale placements are vetoed,
  logged, and surfaced instead of executed. Live Gmail sends require a second
  explicit human action (**Send**) per message.

## Prompt-injection posture

- Patient replies are data, never instructions: the guard quarantines
  instruction-like content; the interpret agent's only output channel is a
  Zod-validated intent enum + constraint object — there is no tool that a
  hijacked reply could aim at the schedule.
- Agent tools are a fixed allow-list per agent; results are schema-validated;
  invalid output falls back to deterministic logic rather than being obeyed.

## Data & integration hygiene

- All data is local SQLite; seeded patients are fictional. `DEMO_PATIENT_EMAIL`
  plus-aliasing keeps live-mode email inside one inbox you own.
- OAuth scopes are minimal (`calendar.events`, `gmail.compose`,
  `gmail.readonly`); reply polling reads **known thread ids only**, never the
  inbox. Tokens live in the local DB; **Reconnect** rotates them.
- Full audit log: every consequential action (human and agent) with actor,
  refs, and detail — searchable in Admin.

## Explicit non-goals

No authentication/authorization (role switcher is a demo device), no PHI
handling posture (don't put real patient data in), no rate limiting, no
multi-tenant isolation, no SMS. See PROJECT_STATUS.md for the complete list.
