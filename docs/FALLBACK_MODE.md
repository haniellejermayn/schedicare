# Presentation Resilience Mode

The demo must survive a dead conference-room network. Resilience mode is not a
stub — it is the same pipeline on deterministic components:

| Layer | Live | Resilience |
|---|---|---|
| Agents | Claude on Bedrock (primary) or Gemini function calling | Deterministic playbooks emitting the **same Zod schemas** |
| Calendar | Google Calendar API | `SimulatedCalendarProvider` (SQLite table, same interface) |
| Mail | Gmail (staff approval → draft + send) | `SimulatedMailProvider` (same approval boundary, auto-send + scripted patient personas) |
| Replies | Real inbound Gmail, polled | Personas reply in 4–8s (Teresa/Camille/Andres/Jose accept, Miguel counters then accepts, Grace/Dennis stay silent, Rosa takes the waitlist offer) |

## How the mode is chosen (`core/status.ts` + `integrations/factory.ts`)

Per component, live is used when configured, connected, not forced into
resilience mode, and not marked unhealthy. The Settings live badge additionally
requires a successful verification. Agent failures, Calendar reads/creates,
and Gmail draft creation have labeled fallbacks; Gmail send failures retain the
live draft for staff recovery rather than simulating a send and risking a
duplicate. `FALLBACK_ENABLED=false` disables the agent safety net;
Settings → **Demo & data → Force Resilience Mode** pins the fallback regardless of health, which
is also the presenter's kill-switch drill.

## What the audience sees

- Header pill: **Live Agentic Mode** (green) vs **Presentation Resilience
  Mode** (amber, blinking dot), with reasons in **Settings → Connections**.
- Every simulated effect is labeled *Simulated* in the feed, timeline, and
  toasts. Nothing pretends to be live.
- Agent-feed entries identify the configured live provider vs "Deterministic mode — …".

## Guarantees

- Byte-identical DB schema and recommendation payloads in both modes (the
  cascade integration test runs in resilience mode and drives the same API the
  UI uses).
- Deterministic seed + `DEMO_NOW` anchor → the flagship story replays exactly.
- Mode flips are runtime, per-component, and reversible mid-case.
