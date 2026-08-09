# PROJECT_STATUS — what shipped, what changed, what's cut

Status date: build verified against `npm test` (**89/89 across 11 files**),
`npm run typecheck` (strict, clean), and `npm run build` (clean). Extraction
numbers carry the dev-set caveat (see v2.3).

## Guarded negotiation + demo hardening (v2.3)

**Negotiation loop.** One negotiation row per (case, appointment); a closed
3-action policy (offer slots by candidate key only / ask ONE clarifying
question citing computed relaxation counts / escalate to staff); a
deterministic guard enforces the turn budget (3), rejects unknown slots and
targets, and never asks about the same constraint twice. Clarifications are
recommendations through the normal DecisionCard gate; answers carry the
question as extractor context; merges are diffed deterministically and
narrated in the timeline. Policy fallback escalates — never dumber automation.

**Constraint editor + triage.** Inbound replies flow guard → extractor
(evidence spans, calendar-table date resolution, merge with prior
constraints) → validator/canonicalizer → deterministic triage lanes
(route_legacy / constraint_review / needs_human). The editor shows
per-appointment constraints with evidence quotes, hard/soft toggles, a
diff panel for multi-turn merges, and zero-slot relaxation hints with
per-constraint yields; "Keep everything — ask the patient" delegates to the
negotiation loop.

**Threading + resolution.** All of a patient's mail lives in ONE Gmail
conversation (threadId + `Re:` subjects + In-Reply-To/References); inbound
replies attribute to the latest outbound on the thread. Ghost holds fixed via
a lineage sweep at execution; `scripts/why-not-resolved.ts` prints exactly
what blocks a resolving case.

**Copy/polish (P0).** Assessment describes urgency and impact only — never
prescribes the recovery action. Patient-facing availability uses exact counts
only when ≤5, qualitative wording otherwise (exact figures stay on the staff
card). Cross-doctor offers say so explicitly ("with Dr. Reyes, who is
covering for Dr. Santos") and offer the wait-for-usual-doctor alternative.
Confirmations get a deterministic same-thread acknowledgment — template only,
the one outbound that legitimately skips the gate.

**Gate integrity fix.** With parallel patients on one case, one patient's
needs_human escalation could demote `awaiting_approval` and lock another
patient's pending approval behind a 409. Escalation now preserves a pending
staff gate (logged, state kept), decisions are accepted on escalated cases
with pending proposals, and the staff-only guard on any transition into
`executing` is unchanged. Two regression tests pin the behavior.

**Extraction re-run (supersedes the v2.2 numbers).** After adding the Grace
approximate-time regression: dev corpus **67 cases — 91% full match, 100%
intent, 91% field precision/recall, guard 4/4**, vs the corrected deterministic
baseline at **34%**. The Grace case itself passes with a soft 11:00–12:00
window, verbatim evidence, and no duplicate unresolved statement. _Dev-set figures_ — a
frozen held-out set (~35 fresh cases, run once) is still owed before the
defense, with dev numbers re-run at freeze time.

## Constraint foundation + resolution fixes (v2.1)

**Two bug fixes.** (1) `maybeResolveCase` held any rejected recommendation
hostage until a "Mark called" click — introduced by the patient-outcome-card
polish — which left the flagship cascade stuck in `resolving`. A staff
rejection with a reason is now the terminal human decision; the callback
lives on the appointment's `needsCallback` flag. Failed executions still
block. (2) The daily sweep required `status === "confirmed"` before opening a
no-show-risk case, while the risk scorer awards +25 for being _unconfirmed_ —
the filter contradicted the model, so the riskiest patients never got cases.
Booked and confirmed appointments are now both eligible.

**Constraint core (deterministic, pre-AI).** `core/constraints.ts` defines
`SchedulingConstraintSet`: compound hard constraints (date/weekday
allow+exclude, OR'd time windows, earliest/latest date, required or
same-doctor), soft preferences, unresolved statements, and evidence spans,
plus a lossy bridge down to the legacy four-field `ReplyInterpretation`
(anything richer forces `needs_human` rather than silently narrowing).
`core/constraintValidation.ts` normalizes and rejects impossible sets;
`core/constraintMatching.ts` turns validated sets into engine slots — hard
constraints filter, soft preferences rank, and only `findOpenSlots` ever
produces a time.

**The yardstick.** `eval/constraintCorpus.json` (67 labeled messy replies:
compound, negation, relative dates, Taglish, doctor preferences, ambiguity,
mixed clinical) + `eval/constraintBaseline.ts` scoring the deterministic
guard+rules path field-by-field. Baseline (corrected labels): 63% intent, **31% full match**
(88% on simple counters, **0% on compound/negation/relative-date**), field
precision 48% / recall 26%, guard recall 2/4. Notable finds: "Wag po sa
Friday" extracts Friday as _preferred_ (negation inversion); Tagalog "dose"
(twelve) false-quarantines as medication; "nahihilo" slips past the English
medical guard. This table is the baseline the constraint-extractor agent must
beat on the same scorer.

## AI provider layer + Claude constraint extractor (v2.2)

**Provider abstraction.** The Gemini tool loop was extracted into a
provider-agnostic runtime (agents/runtime/toolLoop.ts); providers are thin
constructors. Added Claude on Amazon Bedrock via the Converse API
(AI_PROVIDER=bedrock, bearer-token auth, global inference profiles;
working default global.anthropic.claude-sonnet-4-6 in ap-southeast-1).
Same submit_result discipline, per-provider health, provider-aware status.
Eval entry points now load .env.local/.env like the worker does.

**Constraint extractor (agents/constraintExtractor.ts).** First LLM
component with no deterministic twin — fallback is a review handoff
(ambiguous + whole message unresolved), never regex. Prompt encodes the
corpus labeling conventions, a Taglish glossary, a 15-day calendar table
(date resolution by lookup, not model arithmetic), and "learned
conventions" from three error-analysis loops. Guard runs before it;
output flows only through validator → staff editor → engine.

**Results (dev set, 65 cases, 3 runs — superseded by the v2.3 re-run above).** Claude Sonnet 4.6: **97% full
match** (97/97/97), 97% intent, 100% field precision/recall, vs corrected
deterministic baseline 31% / 63%. Sole residuals are two known
guard-layer bugs (Tagalog "dose" false quarantine; "headaches" miss) —
the guard upgrade's scoreboard, not extractor failures. One prior-run
invalid-set emission (inverted date range) was caught by
validateConstraintSet and routed to review: the safety layering worked.
Caveat: dev-set figure — prompt/labels were iterated on these cases; a
frozen held-out set is the next evaluation step.

## Final capstone polish

- The Messages tab keeps one operational case while grouping messages by patient. Outbound and inbound messages stay chronological, patients with no email still appear, and common Gmail/Outlook quoted history—including folded `On …` / `wrote:` headers—is hidden from the normal UI while the raw inbound body remains stored.
- Constraint review now opens from the relevant decision card in a modal. Saving edits or searching keeps the review pending and open; a successful offer or negotiation action completes the review and closes it.
- Plain `npm run demo` uses the clean three-patient flagship profile. `npm run demo -- full` retains the three secondary sweep cases for backup questions.
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

**Runtime modes:** a provider-agnostic tool-loop runtime — **Claude Sonnet
4.6 on Amazon Bedrock** (primary, `AI_PROVIDER=bedrock`) or Gemini via
`@langchain/google` — with deterministic fallbacks producing the same Zod
schemas; Google Calendar + Gmail providers with simulated twins; automatic,
labeled degradation on any live failure; MCP transport with a real handshake
and health check (a readiness path, not the active integration).

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
- **Configurable application clock.** `DEMO_NOW=now` follows the current Manila
  time for live presentations; an ISO value keeps tests and offline rehearsals
  deterministic. Cron-style scheduling is simplified to a per-day sweep.
- **Intake is email on tracked threads only.** Replies are understood as
  compound constraint sets (dates, weekday allow/exclude, OR'd time windows,
  doctor requirements, soft preferences) with evidence spans — but only on
  Gmail threads SchediCare started. Mailbox-wide intake, SMS, and phone are
  integrations left to future work; the extractor, negotiator, and gates are
  channel-agnostic by design. Extraction accuracy is a dev-set figure (v2.3);
  ranking and negotiation weights are hand-tuned, not learned.
- **Live-mode extras not built:** Gmail push (known threads are polled at the
  configurable `GMAIL_POLL_MS`, currently 3s for the presentation),
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
