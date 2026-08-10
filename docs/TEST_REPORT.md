# Test report

All numbers are from real runs in this repository (Node 20+, better-sqlite3,
Vitest). Reproduce with the listed commands.

## Suite summary — `npm test`

```
Test Files  10 passed (10)
Tests       95 passed (95)
Duration    ~25s
```

| File                            | Tests | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/constraints.test.ts`     | 37    | Constraint validation/canonicalization; hard filtering + soft scoring; seeded-engine search; minimum-notice zero-slot replans never create an empty approval gate; successful replans link superseded recommendations; extractor fallback and triage; multi-turn diffs; relaxation analysis; negotiation state and policy guards |
| `tests/agents.test.ts`          | 17    | Runtime fallback and schema validation; assessment ordering without unsupported staff priority; non-technical Context sanitization; deterministic reply classification and register detection; reply safety guard; outbound draft lint |
| `tests/slots.test.ts`           | 10    | Slot engine: per-type windows & workdays, trailing-buffer conflicts, external-calendar busy blocks, unavailable dates, `afterTime`/`dayPart` filters, per-day/per-block caps, `validatePlacementNow`, `ignoreAppointmentId` self-reuse during replans, day-load ratio                                                                                                                                                                                                                                                                                                                                                            |
| `tests/state.test.ts`           | 7     | Case state machine: happy path, illegal jumps throw, **staff-only transition into `executing`**, escalate → manual resolve, `maybeResolveCase` waits for every substantive outcome, **an escalation while awaiting approval keeps the staff gate actionable**, staff (and only staff) can execute decided proposals from an escalated case                                                                                                                                                                                                                                                                                        |
| `tests/providers.test.ts`       | 7     | Factory picks simulated + labels non-live; simulated calendar/mail round-trips; **Google Calendar & Gmail providers against injected API doubles** (RFC-822 drafts, thread-reply parsing); MCP transport reports disabled/unreachable cleanly                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests/ranking.test.ts`         | 10    | No-show risk; type-conditional continuity; sooner/preference/same-doctor ranking; waiting-time fairness; small 80%/90% capacity penalties; patient preference dominance; no unsupported staff-priority or offer-acceptance factors; waitlist type filtering |
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
