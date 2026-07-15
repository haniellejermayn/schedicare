# Demo runbook — Riverside Family Clinic, Monday 07:30

Total time: ~6 minutes core story, +3 for secondary flows. Works fully offline.

## Pre-flight (2 minutes before)

```bash
npm run demo        # or: npm run demo:reset && npm run dev (+ npm run worker)
```

- Header pill shows the mode. Amber **Presentation Resilience Mode** is fine —
  say the line: *"No keys, no network needed; live mode is one env var away and
  everything you'll see is identical."*
- `/ops` already shows three quiet cases from the morning sweep (Paolo's
  confirmation nudge, Dennis's no-show-risk outreach, Liza's vacated slot) —
  each **awaiting approval**. Leave them; they prove the system was already
  working before the crisis.
- Reset any time from **Admin → Reset demo data** (worker keeps running).

## Act 1 — the phone call (Doctor tab, ~45s)

*"It's 7:30 Monday. Dr. Santos calls: family emergency, she's out."*

1. Open **Doctor**. Point at the day: 6 patients, capacity bar, the week grid.
2. Press **⚡ Emergency Unavailability** → confirm. Read the dialog line out
   loud: *"Nothing reaches patients until staff approve."*
3. Click the toast link → Ops Center.

## Act 2 — agents work, then stop (Ops, ~90s)

Watch the live feed stream: Assessment maps 6 affected with priority reasons →
Scheduling searches under Santos's *and* Reyes's rules (mention the Barangay
outreach block it's avoiding) → Recovery ranks options with "Why?" chips →
Communication drafts. The case lands on **Awaiting approval — 6 to review**.

*"And here it stops. On purpose. This is the product."*

## Act 3 — the human decides (~90s)

- **Camille (urgent, priority 1):** open **Why?** — chips show the score:
  soonest, same day-part, capacity headroom. **Approve.**
- **Teresa, Miguel, Andres:** **Approve** (or use **Approve all** later).
- **Jose:** **Modify time** → pick a different validated option → *"staff can
  override, but only onto times the engine already validated."*
- **Grace:** **Reject** → reason: *"Prefers a phone call — front desk will
  ring her."* → the case transitions to **Executing**.

Narrate the executor: originals superseded, replacements booked, calendar
events written (labeled *Simulated*), offer emails sent. Grace's line: original
cancelled, **flagged for callback, no email** — the rejection reason is in the
audit log.

## Act 4 — patients answer (~90s)

Within seconds the feed shows replies: four accepts flip appointments to
**Confirmed**. Then Miguel: *"Anything after 4 PM?"* → intent
`counter_proposal`, constraint `after 16:00` → a **replan for one patient**
appears, all options after 4 PM. **Approve** → offer goes out → he accepts →
**Case resolved.**

Close on the scoreboard: **6 affected → 5 rebooked & confirmed, 1 callback,
130 minutes of care recovered** — and `/ops/cases/[id]` for the full replay +
Admin audit log (*"every actor, every decision, every effect"*).

## Optional encores (~3 min)

- **Patient tab:** book a slot live (only rule-valid times are offered);
  cancel Maria's Wednesday visit → a waitlist-backfill case opens → approve →
  Nica gets the offer and accepts.
- **Paolo / Dennis cases:** approve the nudge and the preventive outreach —
  Paolo confirms, Dennis stays silent (the honest outcome).
- **Doctor rules editor:** tighten Reyes's PM cap; re-run a search and the
  agents obey immediately.

## Failure drills (rehearse once)

| Symptom | Move |
|---|---|
| Wifi dies / Gemini 429 mid-case | Nothing to do — feed shows "Deterministic mode — …" and continues. Say the resilience line. |
| Want to *show* the failover | **Admin → Force Resilience Mode** mid-cascade, point at the pill flipping. |
| Worker crashed | Terminal: `npm run worker` — queued events resume. |
| Demo state polluted | **Admin → Reset demo data**, then **Trigger demo cascade**. |
| Port 3000 busy | `npx next dev -p 3001` (OAuth redirect only matters in live mode). |

## The five lines that land

1. "SchediCare proposes. Clinic staff approve."
2. "Agents choose among validated slots — they can't invent a time."
3. "Only a staff decision moves a case to executing; it's a state-machine rule, not a convention."
4. "In live mode those emails are Gmail drafts until a human presses Send."
5. "130 minutes of Dr. Santos's Monday, recovered before the clinic opened."
