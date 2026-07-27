# LangGraph orchestration (v2)

v2 replaces the hand-rolled orchestration layer with a LangGraph state machine.
The pitch in one line: **a case is a graph thread** — it pauses at the approval
gate, wakes when staff decide, pauses again while patients reply, and loops
back through planning when a counter-proposal arrives.

## The graph (`graph/caseGraph.ts`)

One compiled graph, one thread per case (`thread_id = caseId`), checkpointed to
SQLite (`@langchain/langgraph-checkpoint-sqlite`, stored next to the main DB as
`*.graph.db`).

```
START ─▶ plan ─▶ gate ──▶ execute ─▶ watch ─▶ END
              (interrupt)          (interrupt)
                 ▲                      │
                 └──── replan loop ◀────┘
```

- **plan** — sequences the existing, tested step functions by case type:
  doctor_emergency → assess → schedule → recover → comms; cancellation /
  slot-recovery → waitlist; confirmation / no-show-risk → nudge. The steps
  write recommendations and transition the case exactly as before.
- **gate** — `interrupt()` while the case is `awaiting_approval`. The graph is
  literally paused here until the final staff decision enqueues `resume_case`.
- **execute** — the executor: re-validates placements, writes calendar/mail
  effects, schedules simulated replies when mail is effectively simulated.
- **watch** — `interrupt()` while outcomes are pending. Every handled patient
  reply wakes it; a counter-proposal routes the thread back to **gate** with a
  fresh single-patient replan.

**Every conditional edge routes purely on the case's DB state.** The database
stays the single source of truth for the UI and the audit trail; the graph owns
sequencing, pausing, and durability. That makes resumes trivially safe — the
thread re-reads reality and goes where the case actually is — and it means the
hard approval gate remains `core/cases.ts` (only an actor named `staff*` can
move `awaiting_approval → executing`), with the graph's interrupt as the
orchestration-level mirror. Defense in depth, not a relocation of the gate.

## Event flow (`graph/dispatch.ts`, `worker/index.ts`)

The SQLite event queue stays the ingress (delayed events power the simulated
reply timing):

| Event                                   | Effect                                                           |
| --------------------------------------- | ---------------------------------------------------------------- |
| `doctor_emergency`, `patient_cancelled` | open the case, `startCase()` (runs to the first interrupt)       |
| `start_case` (daily sweep)              | `startCase()`                                                    |
| `resume_case` (final staff decision)    | `resumeCase()` → gate falls through to execute                   |
| `simulate_reply` / `patient_reply`      | insert/read inbound, `handlePatientReply()`, then `resumeCase()` |

`resumeCase()` no-ops when the thread has no pending interrupt, so late events
against finished cases are harmless.

## Agents on LangChain

The per-agent Gemini function-calling loop now runs on
`@langchain/google` (`agents/runtime/gemini.ts`): domain tools plus a
`submit_result` tool whose schema is the agent's Zod result schema; the result
is validated with the same schema the deterministic fallback satisfies. Any
live failure still degrades visibly to the fallback — the graph shape is
identical in both modes, which is what keeps Presentation Resilience Mode a
guarantee rather than a hope.

## What v2 deleted

- `agents/orchestrator.ts` (the LLM orchestrator — the graph is the orchestrator)
- `worker/router.ts` and `fallbackSequence` (hand-rolled sequencing)
- `agents/runtime/zodToGemini.ts` and the `@google/genai` dependency

Net: the same audited behavior with less bespoke machinery, plus durable,
inspectable pauses (`caseGraphStatus()` reports where any thread is parked —
the graph regression test asserts `gate` → `watch` → `gate` → ended).
