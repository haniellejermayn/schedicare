# SchediCare — Riverside Family Clinic

**Multi-agent appointment disruption management for one small outpatient clinic.**
When a doctor calls in sick, SchediCare's agents map the blast radius, find rule-valid
alternatives for every affected patient, draft the outreach — and then stop.
**SchediCare proposes. Clinic staff approve.** Nothing is written to a calendar and
nothing reaches a patient without an explicit human decision.

Built as an AI-engineering capstone: Next.js 14 + TypeScript (strict) + SQLite, with
Gemini function-calling agents in live mode and byte-identical deterministic playbooks
in Presentation Resilience Mode.

---

## 60-second start (no keys, works offline)

```bash
npm install          # Node 18.17+ (Node 20/22 recommended)
npm run demo         # seeds data, starts web (localhost:3000) + worker together
```

Then follow the flagship story:

1. **Doctor** tab → press **⚡ Emergency Unavailability** ("Yes — I'm out today").
2. Watch the **Staff Ops** tab: the case streams live — Assessment → Scheduling →
   Recovery → Communication — and stops at **Awaiting approval** with 6 recovery
   recommendations.
3. Decide like the front desk would: **Approve** four, **Modify** Jose's time
   (pick another validated option), **Reject** Grace's with a reason.
4. The executor rebooks, calendars update (labeled *Simulated* in this mode),
   offer emails go out, and simulated patients reply within seconds.
5. Miguel counters — *"Anything after 4 PM?"* — a single-patient replan appears
   for approval. Approve it; he accepts; the case resolves.
6. The scoreboard tells the story: **6 affected → 5 rebooked & confirmed,
   1 flagged for a phone call, 130 minutes of care recovered.**

Secondary flows to poke at: **Patient** tab (book / confirm / cancel — a
cancellation opens a waitlist-backfill case), the confirmation nudge (Paolo),
the no-show-risk outreach (Dennis), and **Admin** (reset, re-trigger, force
resilience, audit log).

> Everything above runs in **Presentation Resilience Mode** — deterministic
> agents + simulated Google providers with identical data shapes. The demo can
> never be taken down by an API outage.

## Two runtime modes

| | Live Agentic Mode | Presentation Resilience Mode |
|---|---|---|
| Agent brain | Gemini function calling (`@google/genai`) | Deterministic playbooks (same schemas) |
| Calendar | Google Calendar (real events) | Simulated provider (SQLite-backed) |
| Email | Gmail — **drafts until staff press Send** | Simulated mail, auto-sends, personas reply |
| Switch | automatic on any live failure, or forced from Admin | always available |

Setup for live mode: [docs/GEMINI_SETUP.md](docs/GEMINI_SETUP.md) and
[docs/GOOGLE_WORKSPACE_SETUP.md](docs/GOOGLE_WORKSPACE_SETUP.md). The current
mode is always visible in the header pill and on `/integrations`, with the
reasons listed whenever resilience is active. Details: [docs/FALLBACK_MODE.md](docs/FALLBACK_MODE.md).

## The trust contract (what the agents can and cannot do)

- **Slot truth is code, not tokens.** A deterministic engine generates every
  valid slot from doctor rules (windows per visit type, buffers, daily/block
  caps, workdays, external calendar busy blocks). Agents choose among validated
  options and explain the choice ("Why?" chips) — they can never invent a time.
- **The approval gate is a state machine, not a convention.** Only an actor
  named `staff*` can move a case `awaiting_approval → executing`
  (`core/cases.ts`); the executor re-validates every placement at execution
  time and vetoes anything stale.
- **Effects are late and labeled.** Calendar writes happen only in the
  executor, after approval. Live Gmail messages stay as drafts until a human
  presses **Send**. Simulated effects are labeled *Simulated* everywhere.
- **No clinical judgment.** Priority uses appointment type, staff-set priority,
  continuity notes, and history only. Inbound replies pass a guard first:
  medical content, anger, or prompt-injection quarantines the thread for a
  person. Outbound drafts are linted; clinical language is replaced with a safe
  template. See [docs/SECURITY_AND_SCOPE.md](docs/SECURITY_AND_SCOPE.md).
- **Everything is audited.** Every consequential action lands in the audit log
  with an actor, and the case timeline replays the whole story.

## Commands

```bash
npm run setup          # create schema + seed the demo world
npm run dev            # web only (localhost:3000)
npm run worker         # agent worker (run alongside dev)
npm run demo           # seed + web + worker in one command
npm run demo:reset     # restore the exact pre-demo state
npm run demo:cascade   # trigger the flagship emergency from the CLI
npm test               # vitest — 41 tests incl. the full cascade end-to-end
npm run eval           # measured metrics → eval/results.json (see docs/EVALUATION.md)
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # eslint (next/core-web-vitals)
npm run build          # production build
bash scripts/headless-verify.sh   # 19-check E2E against the real servers
```

The demo clock is anchored to **Monday 2026-08-10 07:30 Asia/Manila**
(`DEMO_NOW`), so the seeded world is stable and every screenshot reproduces.

## Repo map

```
app/            Next.js App Router — pages (/book /doctor /ops /integrations /admin) + API routes
agents/         Agent definitions: orchestrator, assessment, scheduling, recovery, comms, risk
agents/runtime/ Gemini function-calling loop + Zod validation + fallback dispatch
core/           Slot engine, validator, ranking, risk, case state machine, audit, clock, db
integrations/   Google Calendar/Gmail providers, simulated twins, OAuth, MCP transport
worker/         Event queue, router, pipeline steps, executor, reply handling, daily sweep
sim/            Deterministic seed (32 patients, ~45 appointments) + reply personas
tests/          7 suites, 41 tests — slots, ranking, state, agents, providers, sweep, cascade E2E
eval/           Metric harness + 50-reply labeled dataset + latest results.json
docs/           Setup guides, runbook, test report, evaluation, security & scope
scripts/        setup / reset / cascade / demo / headless-verify
```

## Documentation

- [PRODUCT.md](PRODUCT.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN.md](DESIGN.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the original plans
- [PROJECT_STATUS.md](PROJECT_STATUS.md) — what shipped, deviations from plan, known limitations
- [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) — presenter script with fallback drills
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) · [docs/EVALUATION.md](docs/EVALUATION.md) — real, reproduced numbers
- [docs/MCP_SETUP.md](docs/MCP_SETUP.md) · [docs/MCP_FEASIBILITY.md](docs/MCP_FEASIBILITY.md) — the MCP readiness path

## Scope honesty

One clinic, two doctors, no authentication (role switcher instead), demo-anchored
clock, English/Taglish replies only, and a deliberately narrow agent mandate:
scheduling operations, never medicine. The full list — and why each cut was made —
is in [PROJECT_STATUS.md](PROJECT_STATUS.md).
