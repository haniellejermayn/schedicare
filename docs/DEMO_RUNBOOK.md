# Live demo runbook — three patient paths

Target: 3 minutes inside a 10-minute presentation. This run is intentionally
live: Claude on Bedrock, Gmail replies, and Google Calendar writes.

## Pre-flight and live staging

Do this before the room opens, not during the presentation.

1. In `.env.local`, confirm:

   ```dotenv
   DEMO_NOW=now
   AI_PROVIDER=bedrock
   CALENDAR_PROVIDER=google
   MAIL_PROVIDER=gmail
   GMAIL_POLL_MS=3000
   AUTO_SIMULATE_REPLIES=false
   ```

2. Set `DEMO_PATIENT_EMAIL` to a patient inbox you control that is **different
   from the clinic Gmail account connected through OAuth**. The three patients
   use plus aliases of this inbox, so one second account is enough.
3. In **Settings → Connections**, confirm both doctors are mapped to different
   dedicated secondary Google demo calendars. Their IDs must end in
   `@group.calendar.google.com`; never use `primary` or a personal calendar.
4. Run `npm run demo`. It resets SQLite, deletes every existing event from the
   two validated demo calendars, recreates the seeded appointments and busy
   blocks there, then starts the web app and worker. This profile includes only
   the flagship scenario and opens no background sweep cases.
5. Verify Claude, Google Calendar, and Gmail **after `npm run demo` completes its
   calendar sync**. Confirm the UI
   reports the intended live mode and **Actual replies only · 3s polling**.
6. Shortly before the presentation, trigger Dr. Santos's unavailability through
   the normal Doctor workflow. Let Assessment → Scheduling → Recovery finish
   normally, then confirm the case is at `awaiting_approval` / **Needs your
   review** with three recommendations visible.

This is live demo staging, not cached or fabricated output. The normal live
workflow processed the disruption immediately beforehand; the presentation
starts at its human approval boundary so model latency does not consume the
three-minute audience segment. Do not approve any recommendation while staging.

The seed uses the current Manila time. Once the clinic day has begun, the
showcase disruption is placed on Dr. Santos's next working day, ensuring all
three affected visits are still upcoming during an afternoon demo. Historical
and later appointments remain around it so the calendar looks lived-in.

For rehearsal questions about the other workflows, run `npm run demo -- full`
instead. That profile retains the three intentional backup scenarios:
confirmation nudge, no-show risk outreach, and waitlist recovery. They are not
part of the normal flagship run.

## Three-minute story

### 0:00–0:40 — Open the prepared case and show the gate

Begin in **Front desk** with the prepared case already at **Needs your review**.
Point to the three affected Santos visits and the completed agent activity. Say:

> Dr. Santos is unexpectedly unavailable. The system has three patients to
> recover, but it cannot contact anyone until staff approve.

Point to the three recommendations and briefly toggle
**Technical detail** to show the agent/tool trace. Emphasize:

- Claude interprets the disruption and later extracts meaning from real replies.
- Slot generation, conflict checks, ranking policy, and state transitions are
  deterministic.
- The graph pauses at **Needs your review** before any Gmail or Calendar write.

Approve all three suggestions. This creates live `[HOLD]` events in the mapped
Google Calendar and sends three real Gmail messages.

### 0:40–2:20 — Three real reply paths

From the separate patient inbox, reply on each conversation:

- **Camille — accept:** `Yes, that works for me. Thank you.`
- **Grace — decline:** `No, I can't make that time. Please cancel it.`
- **Miguel — required review:** `Hindi ako available that time. Wednesday or Thursday after 4 PM sana, pero not August 14 po.`

The worker polls about every three seconds. Show the activity feed changing to
accepted, declined/callback, and required constraint review. For Miguel, point
to the evidence-backed day/date/time constraints, the separate clinic default
to keep Dr. Santos, and the patient-scoped action gate.

### 2:20–3:00 — One short negotiation and live proof

Search the constraints. If only another doctor can satisfy the timing, choose
**Ask about another doctor**, approve the natural Taglish clarification, then
reply `Okay lang po, please check another doctor.` Approve the resulting offer
and confirm it from the patient inbox. End in Google Calendar: Camille and
Miguel are confirmed; Grace's hold is gone. Return briefly to the case Activity
tab for the audit trail.

Close with:

> The AI handled semantic ambiguity and coordination. Deterministic rules kept
> it safe, staff controlled every outbound offer, and the final state is visible
> in the real systems the clinic already uses.

## What not to do live

- Do not enable **Force demo mode**; it disables the live providers.
- Do not set `AUTO_SIMULATE_REPLIES=true`; that is only for offline rehearsals.
- Do not use the connected clinic Gmail as `DEMO_PATIENT_EMAIL`; its replies are
  correctly labelled outbound `SENT` and ignored by inbound polling.
- Do not reset after approving offers unless you are prepared to clean the
  already-created Google Calendar events manually.
- Do not use `dev:lan`, `/qr`, or a public tunnel in the flagship demo. The
  mobile booking surface is outside the agent-recovery story, and this demo app
  has no authentication boundary between patient and staff routes.

## Recovery

| Symptom | Safe move |
|---|---|
| Claude verify fails | Restart after fixing the Bedrock key/region/model; do not claim a live AI run. |
| Gmail or Calendar verify fails | Reconnect Google, reset if needed, then verify again after the final reset. |
| No reply appears after 10 seconds | Confirm the reply came from the separate patient account and the worker terminal is running. |
| Worker stopped | If the event is still pending, restart with `npm run worker`. If it was already claimed as `processing`, the queue has no stale-claim recovery: reset, clean any external residue, and stage the case again. |
| Demo state is dirty | Stop the app, confirm the dedicated calendar mappings, rerun `npm run demo`, then verify integrations again. |
