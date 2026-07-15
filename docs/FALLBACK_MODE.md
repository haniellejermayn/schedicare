# Presentation Resilience Mode

The demo must survive a dead conference-room network. Resilience mode is not a
stub — it is the same pipeline on deterministic components:

| Layer | Live | Resilience |
|---|---|---|
| Agents | Gemini function calling | Deterministic playbooks emitting the **same Zod schemas** |
| Calendar | Google Calendar API | `SimulatedCalendarProvider` (SQLite table, same interface) |
| Mail | Gmail (drafts → explicit Send) | `SimulatedMailProvider` (auto-send + scripted patient personas) |
| Replies | Real inbound Gmail, polled | Personas reply in 4–8s (Teresa/Camille/Andres/Jose accept, Miguel counters then accepts, Grace/Dennis stay silent, Rosa takes the waitlist offer) |

## How the mode is chosen (`core/status.ts` + `integrations/factory.ts`)

Per component, live is used only when configured **and** currently healthy;
otherwise the simulated twin is picked and the reason recorded. Any live
failure at call time marks that service unhealthy, retries once on the
simulated twin, and the pipeline continues — the case feed shows the
degradation instead of an error page. A successful later call marks it healthy
again. `FALLBACK_ENABLED=false` disables the safety net (errors surface raw);
Admin → **Force Resilience Mode** pins the fallback regardless of health, which
is also the presenter's kill-switch drill.

## What the audience sees

- Header pill: **Live Agentic Mode** (green) vs **Presentation Resilience
  Mode** (amber, blinking dot), with hover/`/integrations` reasons.
- Every simulated effect is labeled *Simulated* in the feed, timeline, and
  toasts. Nothing pretends to be live.
- Agent-feed entries note "Gemini reasoning live" vs "Deterministic mode — …".

## Guarantees

- Byte-identical DB schema and recommendation payloads in both modes (the
  cascade integration test runs in resilience mode and drives the same API the
  UI uses).
- Deterministic seed + `DEMO_NOW` anchor → the flagship story replays exactly.
- Mode flips are runtime, per-component, and reversible mid-case.
