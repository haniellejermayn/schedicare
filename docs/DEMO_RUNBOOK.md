# Demo runbook — Riverside Family Clinic, Monday 07:30

Total time: ~6 minutes core story, +3 for secondary flows. Works fully offline.

## Pre-flight (2 minutes before)

```bash
npm run demo        # or: npm run demo:reset && npm run dev (+ npm run worker)
```

- Header pill shows the mode. Amber **Presentation Resilience Mode** is fine —
  say the line: *"No keys, no network needed; live mode is one env var away and
  everything you'll see is identical."*
 - **Front desk** already shows three quiet cases from the morning sweep (Paolo's
  confirmation nudge, Dennis's no-show-risk outreach, Liza's vacated slot) —
  each **Needs your review**. Leave them; they prove the system was already
  working before the crisis.
- Reset any time from **Settings → Demo & data → Reset demo data** (worker keeps running).

## Act 1 — the phone call (Doctor tab, ~45s)

*"It's 7:30 Monday. Dr. Santos calls: family emergency, she's out."*

1. Open **Doctor**. Point at the day: 6 patients, capacity bar, the week grid.
2. Press **⚡ Emergency Unavailability** → confirm. Read the dialog line out
   loud: *"Nothing reaches patients until staff approve."*
3. Open the **Front desk** tab — the case is at the top of the inbox.

## Act 2 — the system works, then stops (Front desk, ~90s)

Open the case: the Activity tab narrates in plain language — appointments
affected, times searched under Santos's *and* Reyes's rules (mention the
Barangay outreach block it avoids), offers drafted. Flip **Technical detail**
on for the judges to reveal the agents and tool calls, then off again. The
case lands on **Needs your review — 6 suggestions**.

*"And here it stops. On purpose. This is the product."*

## Act 3 — the human decides (~90s)

- **Camille (urgent, priority 1):** tap **Why this time?** — soonest, same
  day-part, capacity headroom, in words. **Approve.**
- **Teresa, Miguel, Andres:** **Approve** (or use **Approve all** later).
- **Jose:** **Change time** → pick a different validated option → *"staff can
  override, but only onto times the engine already validated."*
- **Grace:** **Can't do this** → reason: *"Prefers a phone call — front desk will
  ring her."* → the case moves to **Booking & notifying**.

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

Close on the summary line: **6 patients → 5 confirmed, 1 to call, 130 care
minutes saved** — then the case's Activity tab for the full replay and
**Settings → Audit log** (*"every actor, every decision, every effect"*).

## Optional encores (~3 min)

- **Patient tab:** book a slot live (only rule-valid times are offered);
  cancel Maria's Wednesday visit → a waitlist-backfill case opens → approve →
  Nica gets the offer and accepts.
- **Paolo / Dennis cases:** approve the reminder and the check-in — Paolo
  confirms, Dennis stays silent (the honest outcome).
- **Doctor → Rules tab:** tighten Reyes's PM cap; re-run a search and the
  system obeys immediately.

## Failure drills (rehearse once)

| Symptom | Move |
|---|---|
| Wifi dies / Gemini 429 mid-case | Nothing to do — Activity continues unchanged (flip on Technical detail to show the fallback note). Say the resilience line. |
| Want to *show* the failover | **Settings → Demo & data → Force demo mode** mid-cascade, point at the header dot flipping. |
| Worker crashed | Terminal: `npm run worker` — queued events resume. |
| Demo state polluted | **Settings → Demo & data → Reset**, then **Trigger demo cascade**. |
| Port 3000 busy | `npx next dev -p 3001` (OAuth redirect only matters in live mode). |

## The five lines that land

1. "SchediCare proposes. Clinic staff approve."
2. "Agents choose among validated slots — they can't invent a time."
3. "Only a staff decision moves a case to executing; it's a state-machine rule, not a convention."
4. "In live mode those emails are Gmail drafts until a human presses Send."
5. "130 minutes of Dr. Santos's Monday, recovered before the clinic opened."
