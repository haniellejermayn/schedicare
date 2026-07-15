# Test report

All numbers below are from real runs in this repository (Node 22, better-sqlite3,
Vitest 2). Reproduce with the listed commands.

## Suite summary — `npm test`

```
Test Files  7 passed (7)
Tests       41 passed (41)
Duration    ~12s
```

| File | Tests | What it proves |
|---|---|---|
| `tests/slots.test.ts` | 9 | Slot engine: per-type windows & workdays, trailing-buffer conflicts, external-calendar busy blocks (Barangay outreach), unavailable dates, `afterTime`/`dayPart` filters, per-day/per-block caps vs existing load, validator accept/reject, `ignoreAppointmentId` self-reuse during replans, day-load ratio |
| `tests/ranking.test.ts` | 6 | No-show risk: Dennis high (unconfirmed + lead time + 2 no-shows), Teresa low, monotonic in prior no-shows. Recovery ranking: sooner/pref-match/same-doctor wins with ≥3 "Why?" chips and 1–5 dots; staff priority + waiting time raise scores. Waitlist: type filtering, Rosa beats Vicente/Bien with chips |
| `tests/state.test.ts` | 5 | Case state machine: happy path, illegal jumps throw, **staff-only** `awaiting_approval → executing` (orchestrator/executor rejected), escalate → manual resolve, `maybeResolveCase` waits for every substantive patient outcome |
| `tests/agents.test.ts` | 11 | Runtime falls back under `AI_PROVIDER=fallback` with Zod-validated output recorded as `fallback_ok`; assessment orders Camille (urgent) #1 / Teresa ≤2 with severity high; reply classifier (accepts, rejects, cancels, counters incl. "after 4"→16:00, mornings, weekday→date; questions; gibberish→needs_human); reply guard (medical / injection / anger hit, normal pass); draft lint replaces clinical drafts |
| `tests/providers.test.ts` | 7 | Factory picks simulated + labels non-live; simulated calendar round-trip feeding busy intervals; simulated mail draft→send→inbound→poll with seen-dedupe; **Google Calendar & Gmail providers against injected API doubles** (event mapping, RFC-822 draft raw, draft-id send, thread reply parsing incl. base64url decode + SENT/DRAFT filtering, profile); MCP disabled state + unreachable endpoint → `unavailable` without throwing |
| `tests/sweep.test.ts` | 1 | Boot sweep opens exactly Paolo (confirmation), Dennis (risk, band high), Liza (slot recovery); same-day bookings excluded; idempotent; all three reach `awaiting_approval` with the right recommendation kinds and Rosa as the waitlist pick |
| `tests/cascade.test.ts` | 2 | **Flagship end-to-end through the real route handlers** (below), plus cancellation → waitlist backfill → offer → accept → `wl` scheduled → resolved |

### What the cascade test asserts (the spine of the product)

Doctor emergency via the real endpoint → worker drains → case
`awaiting_approval`, severity high, **6 reschedule recommendations**, Camille
priority 1, every option a future non-Santos-Monday slot, drafts say "reply
YES", **nothing executed before decisions**. Then through the decision API:
modify with junk option id → **422**, reject without reason → **400**, approve
×4 + modify Jose + reject Grace → transition, double-decide → **409**. Executor:
5 executed, Jose on his modified option, originals superseded, replacements
booked with calendar event ids, outbound sent; Grace cancelled-by-clinic +
callback flag + **zero messages**. Replies: 4 accepts confirm; Miguel's counter
supersedes his rec and yields a replan whose **every option is ≥16:00 Manila**;
approve → execute → accept → **resolved**. Scoreboard: 5 rebooked / 5 confirmed
/ ≥1 callback / ≥120 minutes recovered. Audit contains the approvals, the
rejection, the modification, and the doctor's emergency action.

## Static checks

- `npm run typecheck` — clean (`strict: true`, no `any` leaks in core paths)
- `npm run lint` — clean (`next/core-web-vitals`)
- `npm run build` — clean production build, all routes compile

## Headless E2E — `bash scripts/headless-verify.sh`

Production server (`next start`) + real worker, driven purely over HTTP:

```
19 checks, 0 failures
```

Covers: resilience status, all five pages return 200, boot sweep opens the
three secondary cases, emergency endpoint, cascade reaches approval with 6
recs, mixed decisions accepted, Miguel replan appears and resolves after
approval, final scoreboard `rebooked=5 confirmed=5 needsCall=1 minutes=130`,
SSE feed streams, audit contains the rejection.

## Known gaps

- UI is exercised at the HTTP/HTML level, not with browser automation — no
  clicking tests for the React components themselves.
- Live Google/Gemini paths are covered via injected API doubles and the
  verify endpoints, not against real Google servers in CI.
