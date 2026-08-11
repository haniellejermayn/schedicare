# Negotiation Loop — Design

Status: implemented in the current reply pipeline

## Motivation

Before the negotiation loop, the reply pipeline was one-shot per turn. A simple counter triggered an
immediate replan; a compound one stops (correctly) at the constraint editor;
but nothing _pursues a resolution across turns_:

- No memory: each counter is interpreted in isolation. "Actually mornings are
  fine now" cannot delete last week's "no mornings".
- No cap: a patient can counter forever; every round burns a full replan and
  no one notices the loop.
- No strategy on empty: when zero slots match, the case escalates with a
  generic message. Nobody decides _which_ constraint is worth asking the
  patient to relax, or drafts that question.
- No closure pressure: nothing distinguishes turn 1 from turn 4.

The negotiation loop is the component that makes the system _conduct a
scheduling conversation_ rather than react to messages.

## Principle (same as the whole architecture)

Authority scales with verifiability. The action space here is genuinely open
("what is the best next move in this conversation?"), so an LLM picks the
move — but only from a closed action set, only over slots the deterministic
engine produced, behind the same staff gates as everything else, with
deterministic ownership of state, caps, and validity. The model never invents
a time, never sends unapproved text, never exceeds the turn budget.

## State: `negotiations` table (DB is the source of truth; the graph routes on it)

One row per (caseId, appointmentId):

| column                               | notes                                                          |
| ------------------------------------ | -------------------------------------------------------------- |
| id, caseId, appointmentId, patientId | identity                                                       |
| status                               | `active` \| `resolved` \| `escalated`                          |
| turn                                 | patient-facing rounds so far (offers + clarifications)         |
| constraintSet                        | the MERGED SchedulingConstraintSet — the accumulated truth     |
| offeredSlots                         | JSON history: slot, offeredAt, outcome (declined/superseded/…) |
| lastAction / lastReason              | policy audit trail                                             |
| createdAt / updatedAt                |                                                                |

No dedicated subgraph: a negotiation turn is a single linear pass (reply →
merge → analyze → policy → act → wait), and the waiting already lives in the
event queue and message flow. Turns run as a plain worker function invoked
from reply routing; the parent case graph resumes as usual. Agency is
concentrated in one decision — the policy's choice of next move — which is
the honest description for the paper.

## Three intelligence points (and what stays deterministic)

1. **Constraint merging (LLM — the extractor, extended).** The extractor
   gains `priorConstraints` in its input and merge semantics in the prompt:
   output the FULL updated set — add new constraints, _remove_ ones the
   patient lifted ("okay na pala ang umaga"), replace changed ones. Verbatim
   evidence still required for every field. Deterministic
   `diffConstraintSets(prev, next)` (pure, tested) produces the audit trail
   and timeline entry — we log the diff we compute, not the diff the model
   claims.

2. **Situation analysis (deterministic).** `relaxationAnalysis(set, ctx)`:
   run the constraint search once as-is, then once per hard constraint with
   that constraint dropped, and report match counts — "as stated: 0 slots ·
   without 'after 14:00': 4 · without 'Wed/Thu only': 6 · without required
   Dr. Santos: 9". Pure arithmetic over engine output. This is the fact base
   the policy reasons over, and it doubles as the editor's zero-slot hint UI.

3. **Policy (LLM — the agentic core).** Input: merged set, relaxation
   analysis, offer history with stated decline reasons, turn number and
   budget, patient's risk band and preferences. Output — ONE action from a
   closed enum:

   | action              | payload                                                                                           | deterministic guard                                                                                 |
   | ------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
   | `offer_slots`       | refs into the analysis' candidate slots (max 3)                                                   | slots must exist in the provided candidates; revalidated at execution; draft linted; staff approval |
   | `ask_clarification` | targeted question + which constraint it probes + up to 3 concrete options drawn from the analysis | question drafted around REAL counts only; linted; staff approval; counts as a turn                  |
   | `escalate_to_staff` | reason (incl. "patient will confirm later" — staff snooze themselves)                             | terminal for the loop                                                                               |

   Hard rules enforced OUTSIDE the model: turn budget (default 3 patient-facing
   rounds, then forced escalation), no action while clinical flag or
   unresolved statements are pending (those already routed to review),
   clarifications may only cite relaxations the analysis actually computed.

   Fallback (AI down): `escalate_to_staff` — consistent with the no-twin
   philosophy; the loop degrades to today's behavior, never to a dumber
   automation.

## Flow integration

Replies keep entering through `handlePatientReply` (guard → extract → triage)
— unchanged. Routing gains one check: if an active negotiation exists for the
message's appointment, the reply feeds the negotiation loop instead of the
legacy counter branch. Inside the loop:

merge (LLM) → validate + diff (det) → analyze (det) → policy (LLM) →
guard (det) → act (det) → existing gates → await reply → loop.

"Act" reuses existing machinery end to end: offers go through
`replanWithConstraintSet` (which already feeds recovery ranking, comms
drafting, and the DecisionCard); clarifications become a new recommendation
kind `clarification` with a drafted message behind the same DecisionCard
approval; accepts/cancels terminate the negotiation via the existing
confirm/cancel paths and mark the row resolved.

A clear acceptance of a concrete offered time is terminal and takes
precedence over accumulated working constraints. It goes directly to the
confirmation path without merging those constraints into another review;
replies that add a new condition remain counter-proposals and continue the
conversation-local merge.

## Engagement rules (phased, to protect the working demo)

Phase A (this build):

- Turn 1 simple rich counter → the deterministic constraint-search fast path
  (`replanWithConstraintSet`), and a negotiation row is created to count turns.
  The legacy fallback classifier continues to use `replanSingle`.
- Negotiation policy engages on: turn ≥ 2 for the same appointment · any
  zero-slot search result · the turn after a staff-approved compound set from
  the constraint editor.
- Turn budget 3 → forced `escalate_to_staff`.

Phase B (optional, post-demo): unify turn 1 into the loop (policy's
first-turn choice reproduces replanSingle when slots exist).

## Future risk hook

The policy schema can accept a patient's no-show risk band, but the current
negotiation caller does not supply it. Wiring that signal into negotiation is a
post-demo extension, not current behavior.

## Demo beats this unlocks

1. Zero-slot intelligence: "No slot matches. SchediCare asks Miguel — with
   real numbers — whether after-4-PM is flexible or whether Dr. Reyes would
   do, staff approve the question, Miguel answers, the loop closes."
2. Multi-turn memory: "Actually mornings are okay na" — the timeline shows
   the diff: _removed: no mornings_.
3. The cap: fourth round never happens; the case lands on a human with the
   whole negotiation summarized.

(Cut from v1 after an overengineering review: `hold_and_wait` wake scheduling
— not demoable on a real-time clock, escalation-with-note covers it — and a
dedicated LangGraph subgraph — a linear turn needs no checkpointed graph; the
case graph already carries the LangGraph story.)

## Build batches

- **A — merge + diff:** extractor `priorConstraints`, merge prompt section,
  `diffConstraintSets` + tests, reply flow carries the merged set, editor
  shows the change list. No schema/graph changes.
- **B — analysis + policy:** `relaxationAnalysis` (pure + tested),
  `negotiations` table, policy AgentDef with the closed 3-action schema,
  guards + tests (fallback = escalate). Editor zero-slot hints fall out of
  the same analysis.
- **C — loop wiring:** reply routing into `negotiationTurn()`, the
  `clarification` recommendation kind + DecisionCard support, turn budget,
  timeline narration, demo beats.

## Explicitly out of scope

Mailbox-wide intake (Release 3/4 remains future work), price/insurance
negotiation, any model authority over calendar writes, and any automated
handling of clinical content (detect-and-escalate stands).
