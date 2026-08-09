# Presentation content — 10 minutes + 5 Q&A

Slide text is what goes ON the slide (keep it that short). Say = speaker
notes. Figures are listed per slide; sources at the bottom. Time budget
totals ~9:30, leaving 30s of slack for transitions.

---

## 1 · Problem — 1:00

**Slide:** "Dr. Santos is out today." Photo/illustration of a front desk +
three stats-style lines: _N patients to rebook · every reply is free text ·
nobody at the desk at 7:31 AM._

**Say:** When a clinic doctor calls in sick, someone has to find every
affected patient, figure out who needs care soonest, find valid new slots,
email each patient, read replies like "hindi po ako pwede weekdays, Sunday
lang kami libre," and negotiate — by hand, in Gmail and Google Calendar,
during clinic hours only. Booking tools like Calendly don't do any of this:
they let patients book open slots; they have no concept of a _disruption_.
This recovery workflow is the gap.

## 2 · Solution overview — 0:45

**Slide:** One line: **"SchediCare proposes. Clinic staff approve."** Under
it: detect → assess → validated offers → understand replies (Taglish) →
guarded negotiation → gated booking. Users: front desk (primary), patients,
doctors.

**Say:** SchediCare runs the whole recovery loop as an agentic system — but
nothing reaches a patient or a calendar without a human decision. Design
principle in one sentence: authority scales with verifiability — everything
repeatable is deterministic code; LLMs sit only where enumeration fails.

## 3 · Agentic workflow — 1:30 ← required "agentic tree" slide

**Figure:** Diagram 1 from `docs/AGENTIC_WORKFLOW.md` (case lifecycle),
color-coded LLM 🟦 / deterministic ⬜ / human 🟨. Keep the reply-path
diagram (Diagram 2) as a backup slide for Q&A.

**Say:** Our "tree" is honestly a gated graph — and that's deliberate.
There's no LLM supervisor: orchestration is a deterministic state machine
(LangGraph checkpointed threads; edges route on database state). Four LLM
specialists sit at the open-ended joints — assessment, slot-search
narration, continuation drafting (replies to what a patient said), and
reply understanding. First-contact mail is deliberately template-rendered:
we drafted with the model, extended the template until it covered the
space, then demoted the model — enumeration succeeded, so the model keeps
only the open-ended half. Every path out of
a model converges on one choke point: the staff approval gate, which the
state machine enforces structurally (only a staff actor can move a case
into executing). Branching lives in reply triage; loops live in the
negotiation, which has a closed 3-action policy, a turn budget of 3, and a
never-ask-twice guard — all enforced in code, not in the prompt.

## 4 · Key components, tools, memory — 1:00

**Slide:** Three mini-columns.
_Tools:_ read-only lookups + `find_open_slots` — every slot verbatim from
the engine; Zod-validated results; agents can't invent a time.
_Memory:_ SQLite is the single source of truth; LangGraph checkpoints give
pause/resume at human gates; a negotiation ledger enforces turn budget +
never-ask-twice; constraint sets merge across turns with deterministic
diffs. No vector store — by design.
_Stack:_ Next.js 14 + TS strict · Drizzle/SQLite · LangGraph · Claude
Sonnet 4.6 on Bedrock · Gmail + Google Calendar (simulated twins).

**Say (pick one beat):** The scheduling agent never searches slots — it only
chooses which searches to run; slots come verbatim from the engine. That's
the pattern everywhere: the model proposes, code disposes.

## 5 · Observability & failure handling — 1:15

**Figure:** Screenshot of a case timeline with the "Technical detail"
toggle ON (tool calls + arguments visible) next to the same view OFF
(plain language). Small inset: the audit log.

**Say:** Every tool call, argument, transition, and decision lands on a
per-case timeline — plain secretary language by default, full technical
trace behind a toggle — plus an actor-attributed audit log, and a
`why-not-resolved` script that prints exactly what blocks any case.
Failure modes are designed, not hoped: if Bedrock is down, every agent
degrades to a deterministic fallback with the same schemas — degrading to
_staff review_, never to dumber automation; if Gmail fails mid-send, the
executor falls back to the simulated provider and labels it; inbound
clinical content, anger, or prompt injection quarantines the thread for a
person before any model sees it; outbound drafts are linted.

## 6 · Live demo — 3:30

Pre-staged before presenting: reset lite → cascade → approve-all → offers
sent → case open at "Waiting on patients". Live portion is the negotiation
arc only (per the runbook):

1. (~40s) Walk the existing timeline: detected → assessed → 3 validated
   offers → staff approved → sent. Point at the gates.
2. Paste Camille's Taglish counter → extraction + constraint editor appear;
   narrate evidence quotes and hard/soft while inference runs.
3. Zero slots → relaxation hints with computed yields → "Keep everything —
   ask the patient" → clarification card → Approve → the email lands **in
   the same Gmail thread**.
4. Paste her concession → merge diff on the timeline → offer card →
   Approve → paste "Okay po, noted!" → deterministic confirmation ack →
   case resolves on its own.

**Insurance:** cued screen recording of one clean run; rehearsed fallback
story if Bedrock/Gmail misbehave (narrate the fallback mode as a feature —
it is one).

## 7 · Team roles & CliftonStrengths — 0:30

(Required slide — own format/content.)

## 8 · Impact & future — 0:30

**Slide:** Measured: **34% → 100%** reply-understanding vs a rules baseline
on a 66-case Taglish dev corpus (_dev-set figure; frozen held-out set is
the next step_) · 79 automated tests · every action gated. Projected:
recovery latency, staff minutes per disruption, after-hours coverage,
waitlist backfill. Future: SMS + call-log intake — **integrations, not
redesigns**; the extractor consumes text, the gates consume
recommendations; none of it knows the channel.

**Say:** This is a v0 and we frame it that way: the measured core is
extraction accuracy and gated end-to-end recovery; the operational metrics
are what a pilot would measure next. The known ceiling is the channel, and
the architecture already clears it.

## 9 · One-slider executive summary — 0:15

Fields for the provided template:

- **App:** SchediCare — agentic appointment disruption recovery for small
  clinics.
- **Problem:** When a doctor is suddenly out, rebooking every affected
  patient is manual, error-prone, free-text, and after-hours-blind.
- **Users:** Clinic front desk (primary); patients; doctors.
- **Workflow:** Detect disruption → assess impact → validated slot search →
  ranked offers → staff approval gate → send on one Gmail thread →
  understand Taglish replies as constraint sets → guarded negotiation
  (turn budget, closed actions) → gated booking → auto-resolution.
- **Technologies:** Next.js 14 + TypeScript, LangGraph (checkpointed case
  threads), Claude Sonnet 4.6 on Amazon Bedrock, Drizzle/SQLite, Gmail +
  Google Calendar APIs with simulated twins.
- **Value:** Recovers a broken schedule end-to-end — including after hours —
  with a human approving every consequential action; 34%→100% reply
  understanding vs rules baseline (dev set).
- **Demo highlight:** A compound Taglish counter-offer negotiated to a
  confirmed booking in one Gmail thread, with staff gating every step.

---

## Figures checklist

1. **Agentic workflow (slide 3):** `docs/AGENTIC_WORKFLOW.md` Diagram 1 →
   mermaid.live → export SVG/PNG. Diagram 2 as a backup slide.
2. **Observability (slide 5):** timeline screenshots (toggle off/on) +
   audit log inset — capture from a fresh `demo:reset` run so the clock and
   showcase day match the live presentation.
3. **Demo insurance (slide 6):** screen recording of one clean run.
4. Optional slide-2 background: `/ops` inbox screenshot.
5. Numbers table (slide 8): baseline 34% vs extractor 100%, guard 2/4 vs
   4/4, 66 dev cases — always with the dev-set caveat printed on the slide.

## Q&A prep (5 min) — one-breath answers

- **Why not Calendly/Cal.com?** They let patients book open slots; they
  have no concept of a disruption. SchediCare recovers bookings that broke —
  detection, triage, outreach, free-text negotiation, gated rebooking.
  Complements, not competitors.
- **Why not just Gmail + Calendar manually?** That's our baseline, not a
  competitor: it costs staff-minutes per disruption, stops at closing time,
  and one doctor out means N patients × M rounds of email tag.
- **Is ranking LLM-based?** No — deliberately. Ranking is a repeated
  fairness decision: like cases must rank alike, weights must be auditable
  and contestable factor by factor, and staff Modify is the override. Model
  variance there is a bug, not intelligence.
- **Are the extraction numbers real?** Dev-set figures, stated as such:
  prompt and labels were iterated on those 66 cases; a frozen held-out set
  is the next evaluation step. The honest comparison is same-scorer,
  same-corpus vs the rules baseline.
- **Is LangGraph doing real work?** It provides what we wanted from it:
  durable pause/resume at human gates (a case survives restarts
  mid-approval), thread revival, and a declared topology. We deliberately
  route edges on DB state so the database stays the single source of
  truth. The graph is thin because the thesis keeps the spine
  deterministic.
- **What if the model hallucinates a time?** It can't reach a patient:
  slots come only from `find_open_slots`, the negotiation guard rejects
  unknown slot references, drafts are linted, and everything waits at the
  staff gate. The executor re-validates at execution time.
- **What breaks first in production?** Auth (role switcher only), single
  clinic/worker, email-on-tracked-threads intake, hand-tuned weights. All
  named in PROJECT_STATUS — scope, not surprises.
- **Patients here text and call, not email.** Correct — that's the known
  ceiling, and the architecture clears it: extractor consumes text,
  negotiator consumes constraint sets, gates consume recommendations. SMS
  and logged calls are integrations on this exact spine.
