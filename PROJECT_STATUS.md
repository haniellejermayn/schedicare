# PROJECT_STATUS — what shipped, what changed, what's cut

Status date: build verified against `npm test` (41/41), `npm run eval`
(all targets met), `npm run build` (clean), and `scripts/headless-verify.sh`
(19/19 checks against the production server + worker).

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

**Surfaces:** `/book` (mobile-first patient app), `/doctor` (day + week,
rules visualization/editor, at-risk list, emergency button), `/ops`
(three-panel ops center), `/ops/cases/[id]` (full case record), `/integrations`
(config, health, verify buttons, OAuth, doctor→calendar mapping),
`/admin` (metrics, demo controls, force-resilience, audit search).

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
   claimed by others — applied to live *and* fallback output, with the shift
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
