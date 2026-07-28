# PROJECT_STATUS — what shipped, what changed, what's cut

Status date: build verified against `npm test` (41/41), `npm run eval`
(all targets met), `npm run build` (clean), and `scripts/headless-verify.sh`
(19/19 checks against the production server + worker).

## Final capstone polish

- The Messages tab keeps one operational case while grouping messages by patient. Outbound and inbound messages stay chronological, patients with no email still appear, and common Gmail/Outlook quoted history is hidden from the normal UI while the raw inbound body remains stored.
- Patient outcome cards support **Mark called**, **Mark handled**, and **Release hold** using existing recommendation outcomes, callback flags, Calendar deletion, timeline, and audit records.
- Front desk staff can create a patient with name/email and optional phone, then create a confirmed appointment from existing doctors, appointment types, and validator-approved slots. The booking uses the doctor rule duration and existing live/simulated Calendar provider factory.
- The Doctor view follows the demo clock, labels SchediCare `booked` appointments as **Temporary hold**, and shows whole-day unavailability with existing external Calendar busy blocks.
- Duplicate-slot protection required no scheduling change: booked and confirmed appointments, selected-slot deduplication, live busy intervals, and executor revalidation remain authoritative.

## v2 — LangGraph orchestration + front-desk redesign

**Orchestration** now runs on LangGraph (TypeScript, same repo): each case is a
checkpointed graph thread that pauses at the approval gate (`interrupt()`),
resumes on the final staff decision, pauses again while patients reply, and
loops back through planning on counter-proposals. All conditional edges route
on DB state, so the database remains the single source of truth and
`core/cases.ts` remains the hard staff-only gate. Deleted in the process: the
LLM orchestrator agent, the hand-rolled router/sequencer, and the custom
Gemini schema converter (agents now run on `@langchain/google` with the
same Zod contracts). Details: docs/LANGGRAPH.md.

**Frontend** was rebuilt from scratch as a clean clinical-neutral, single-column
UI in secretary language. Front desk (`/ops`) is an inbox — Needs your review /
In progress / Done — opening into a full-page case with decision cards
(Approve / Change time / Can't do this), a plain-language Activity feed
(technical detail behind a toggle), and a Messages thread. Doctor and Patient
pages use tabs and modals; Integrations + Admin merged into `/settings`
(Connections · Demo & data · Audit log), with the old URLs redirecting. Case
states read as: Finding times · Needs your review · Booking & notifying ·
Waiting on patients · Done · Needs a person.

## Shipped

**Flagship flow (end-to-end, tested):** doctor emergency → assessment →
constrained scheduling → ranked recovery plans with "Why?" chips → drafted
outreach → **staff approval gate** (approve / modify-to-validated-option /
reject-with-reason, plus approve-all) → executor (calendar + mail effects,
re-validated placements) → simulated patient replies → counter-proposal →
single-patient replan → approval → resolution, with a live agent feed,
per-case timeline replay, recovery scoreboard, and full audit trail.

**Secondary flows:** patient self-booking against the live slot engine,
confirm/cancel, cancellation → waitlist backfill (ranked candidates),
unconfirmed-appointment nudge, no-show-risk preventive outreach, reply guard
(medical / anger / prompt-injection → human), draft content lint, and case
escalation with manual staff resolution.

**Surfaces (v2):** `/book` (patient), `/doctor` (Today · This week · Rules
tabs, emergency button), `/ops` (front-desk inbox), `/ops/cases/[id]` (full
case: decisions, patient outcomes, Activity/Messages tabs), `/settings`
(Connections · Demo & data · Audit log; `/integrations` and `/admin`
redirect here).

**Runtime modes:** Gemini function-calling agents (`@google/genai`, tool loop
with Zod-validated results) and deterministic fallbacks producing the same
schemas; Google Calendar + Gmail providers with simulated twins; automatic,
labeled degradation on any live failure; MCP transport stub with health check.

## Deviations from the original plans (and why)

1. **`validatePlacement` checks rules directly instead of grid membership.**
   The plan implied "membership in generated slots". Direct rule-checking
   (window containment, caps, buffered conflicts, workday, unavailability)
   accepts legitimate off-grid bookings (front-desk entries) while remaining
   exactly as strict about conflicts. The generator still emits a 10-minute
   grid for offers.
2. **Cross-patient dedupe pass after recovery planning.** Each patient's slot
   search is independent, so two plans could choose the same slot; the executor
   would (correctly) veto the second. A deterministic post-pass now shifts
   lower-priority patients to their next open option and prunes alternates
   claimed by others — applied to live _and_ fallback output, with the shift
   surfaced as a `reorderReason`.
3. **Confirmation sweep skips same-day appointments.** Emailing "please
   confirm" 2 hours before a visit is front-desk phone territory; the sweep
   targets tomorrow-and-later bookings inside the 36-hour window. This also
   keeps the boot queue focused (Paolo) instead of five overlapping nudges.
4. **Assessment priority: visit type outranks staff priority.** Camille's
   same-day urgent outranks Teresa's post-op staff-priority flag, matching the
   product narrative; both remain top-2.
5. **A superseded execution doesn't count as a recovery.** Miguel's first
   (countered) offer is excluded from the scoreboard's `rebooked` so the
   metric reflects patients actually recovered (5/6 + 1 phone callback), not
   actions taken (which the audit log counts instead).
6. **Reply classifier: explicit accepts beat counter phrasing.** "Yes! I'll
   take the earlier slot" was mis-read as a counter because of "earlier"; an
   accept now wins unless a negation cue (incl. Taglish "pero/hindi/baka") is
   present. Measured on the 50-reply eval set: 50/50.

## Known limitations (deliberate scope)

- **No authentication or roles enforcement** — the role switcher simulates
  three personas; the staff-only gate is enforced by actor string in the state
  machine, which any API caller could claim. Fine for a capstone, not for
  production.
- **Single clinic, two doctors, one worker process.** The queue is SQLite
  (`busy_timeout` + claim-by-update); horizontal scale is out of scope.
- **Demo-anchored clock.** `DEMO_NOW` freezes the world at Mon 2026-08-10
  07:30 Manila and advances in real time from process start; restarting resets
  the anchor. Cron-style scheduling is simplified to a per-demo-day sweep.
- **Reply understanding is intent-level.** Free-text constraints cover
  after/before times, day-parts, weekdays, and noon-ish phrases; anything
  richer routes to a human by design.
- **Live-mode extras not built:** Gmail push (we poll known threads every 20s),
  webhook calendars, timezone-per-patient, SMS. MCP is a readiness path with a
  working health check, not the active integration (see docs/MCP_FEASIBILITY.md).
- **Accessibility:** semantic labels, no color-only status, reduced-motion
  support; a full audit (focus traps in dialogs, screen-reader passes) was not
  performed.

## Metrics snapshot (resilience mode, this machine — reproduce with `npm run eval`)

- Reply-intent accuracy: **50/50 (100%)**, guard catches all 5 red-flag messages
- Offered-option feasibility (validator re-check): **19/19 (100%)**
- Slot recovery: **6/6 affected rebooked**; 5 confirmed after replies + 1 staff callback (Grace, silent by design)
- Manual actions avoided: **6/6 replies auto-handled**
- Time to approval gate: **~0.4s** (fallback agents; live adds model latency)
- Agent runs 14, errors 0; case resolves end-to-end in the headless run
