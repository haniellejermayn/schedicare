# Gemini setup (Live Agentic Mode brain)

SchediCare's agents run on Gemini function calling via `@google/genai`. Without
a key the same pipeline runs on deterministic playbooks (Presentation
Resilience Mode) — every feature still works.

## 1. Get a free API key

1. Open https://aistudio.google.com/apikey (Google account required).
2. **Create API key** → copy it.

The free tier is enough for the whole demo; a full cascade uses roughly a
dozen model calls.

## 2. Configure

```bash
cp .env.example .env.local     # if you haven't already
```

In `.env.local`:

```
AI_PROVIDER=gemini
GEMINI_API_KEY=AIza...
# Optional. Default: gemini-2.5-flash (good function calling on the free tier).
# gemini-2.5-flash-lite is cheaper/faster; gemini-2.5-pro is strongest.
GEMINI_MODEL=
```

Restart `npm run dev` **and** the worker (env is read at process start).

## 3. Verify

Open **/integrations** → Gemini card → **Verify**. A live round-trip runs and
the health badge flips to *Healthy* ("Model … responded: pong"). The header
pill switches to **Live Agentic Mode** once calendar/mail are also live — or
immediately if those stay simulated but `AI_PROVIDER=gemini` (mode reasons are
listed on the page).

## What the model is allowed to do

The runtime (`agents/runtime/`) gives Gemini a fixed toolbox per agent —
`find_open_slots`, `rank_recovery_options`, `get_patient_history`, etc. Tools
are the only source of scheduling truth; every final answer is validated
against a Zod schema, and schema-invalid output falls back to the
deterministic playbook for that step (recorded on the run as `fallback_ok`,
visible in Admin metrics). Model errors, quota exhaustion, or timeouts degrade
the same way — mid-demo, without stopping the pipeline.

## Troubleshooting

- **429 / quota**: the app auto-degrades; lift usage or switch
  `GEMINI_MODEL=gemini-2.5-flash-lite`.
- **"AI_PROVIDER is set to fallback"** on Verify: set `AI_PROVIDER=gemini` and
  restart both processes.
- **Key works in curl but not here**: ensure `.env.local` is in the repo root
  and you restarted the *worker* too — it makes the model calls.
