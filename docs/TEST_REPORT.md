# Test report

All numbers are from real runs in this repository (Node 20+, better-sqlite3,
Vitest). Reproduce with the listed commands.

## Suite summary — `npm test`

```
Test Files  10 passed (10)
Tests       79 passed (79)
Duration    ~25s
```

| File                            | Tests | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/constraints.test.ts`     | 30    | Constraint validation/canonicalization (redundant exclusions dropped, past dates warned, impossible sets rejected, clinic-hour clipping, timezone-independent weekdays); hard filtering + soft scoring with chips; seeded-engine search incl. `requiredDoctorId`; extractor fallback = review handoff, never regex; post-extraction triage lanes; multi-turn constraint diffing; relaxation analysis with per-constraint yields; negotiation state + policy guard (one row per case/appointment, **turn budget forces escalation**, invalid references rejected, fallback policy always escalates); legacy bridge down-conversion |
| `tests/agents.test.ts`          | 13    | Runtime falls back under `AI_PROVIDER=fallback` with Zod-validated output; assessment fallback priority order; deterministic reply classifier (accepts, rejects, cancels, counters incl. "after 4" → 16:00); reply guard (medical / injection / anger quarantined, Taglish clinical caught, "alas dose" NOT false-quarantined, normal replies pass); draft lint replaces clinical drafts with the safe template                                                                                                                                                                                                                   |
| `tests/slots.test.ts`           | 9     | Slot engine: per-type windows & workdays, trailing-buffer conflicts, external-calendar busy blocks, unavailable dates, `afterTime`/`dayPart` filters, per-day/per-block caps, `validatePlacementNow`, `ignoreAppointmentId` self-reuse during replans, day-load ratio                                                                                                                                                                                                                                                                                                                                                             |
| `tests/state.test.ts`           | 7     | Case state machine: happy path, illegal jumps throw, **staff-only transition into `executing`**, escalate → manual resolve, `maybeResolveCase` waits for every substantive outcome, **an escalation while awaiting approval keeps the staff gate actionable**, staff (and only staff) can execute decided proposals from an escalated case                                                                                                                                                                                                                                                                                        |
| `tests/providers.test.ts`       | 7     | Factory picks simulated + labels non-live; simulated calendar/mail round-trips; **Google Calendar & Gmail providers against injected API doubles** (RFC-822 drafts, thread-reply parsing); MCP transport reports disabled/unreachable cleanly                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests/ranking.test.ts`         | 6     | No-show risk (Dennis high, Teresa low, monotonic in no-shows); recovery ranking (sooner / preference-match / same-doctor wins, Why chips, staff priority + waiting time raise scores); waitlist ranking with type filtering                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/cascade.test.ts`         | 2     | **Flagship end-to-end through the real route handlers**: disruption → gate → execution → replies (accepts confirm + deterministic acks, counter replans, rejection flags a callback) → resolution; cancellation → waitlist backfill → accept → scheduled                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/graph.test.ts`           | 2     | **LangGraph lifecycle**: pauses at the gate, wakes on decisions, auto-replies off the _effective_ mail provider, loops back for a counter-replan; **graph revival** — `resumeCase` re-enters a dead thread at the state machine's current node                                                                                                                                                                                                                                                                                                                                                                                    |
| `tests/doctor-calendar.test.ts` | 2     | `GET /api/doctor/[id]` external-busy: genuine external blocks only, deduped against known appointments; empty for doctors without a calendar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tests/sweep.test.ts`           | 1     | Daily sweep opens exactly the three seeded secondary cases (confirmation nudge, no-show risk, vacated-slot recovery), drafts outreach to `awaiting_approval`, idempotent per day                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Extraction evaluation — `npm run eval:constraints`

Dev corpus: **66 labeled messy replies** (compound, negation, relative dates,
Taglish, doctor preferences, ambiguity, mixed clinical), scored field-by-field
by the same scorer for both systems.

| System                                          | Full match | Guard |
| ----------------------------------------------- | ---------- | ----- |
| Deterministic rules baseline (corrected labels) | **34%**    | 2/4   |
| Claude Sonnet 4.6 extractor (live)              | **100%**   | 4/4   |

**Caveat, stated everywhere we report this:** these are _dev-set_ figures —
the prompt and labels were iterated on these cases. A frozen held-out set
(~35 fresh cases, same conventions, run once) is the next evaluation step;
dev numbers will be re-run at freeze time.

## Other gates

```bash
npm run typecheck   # tsc --noEmit, strict — clean
npm run build       # next build — clean
npm run eval        # fallback-mode metric harness → eval/results.json (docs/EVALUATION.md)
```
