# The agentic workflow

This is the diagram behind the "agentic tree" slide, and the honest answer to
"is this a tree or a pipeline?": **neither, exactly — it is a gated graph.**
There is no LLM supervisor delegating to sub-agents; orchestration is a
deterministic state machine (LangGraph, edges routed on database state), and
that is deliberate — the thesis is that authority scales with verifiability,
so the _spine_ must be code. The plan phase runs specialists in a fixed
sequence (pipeline-like); the reply path _branches_ (triage lanes, a closed
negotiation action set) and _loops_ (negotiation turns, counter-proposal
replans) — graph-like. Every path out of a model converges on the same
choke point: the staff approval gate.

**Legend** — 🟦 LLM (proposes) · ⬜ deterministic code (disposes) · 🟨 human.

## 1. Case lifecycle — one case, end to end

```mermaid
flowchart TD
  EV["⬜ SQLite event queue"] --> DI["⬜ dispatch — every event kind has a handler"]
  DI --> CG["⬜ LangGraph case graph<br/>plan → gate → execute → watch<br/>edges route on DB state"]

  subgraph PLAN["plan — the model proposes"]
    AS["🟦 Assessment agent<br/>read-only tools: affected appts,<br/>waitlist, history, day load<br/>urgency + impact only, never placements"]
    SC["🟦 Scheduling agent<br/>chooses which searches to run —<br/>every slot verbatim from find_open_slots"]
    RK["⬜ Recovery ranking<br/>auditable weights, Why chips,<br/>cross-patient dedupe"]
    CM["🟦 Comms agent<br/>drafts patient mail →<br/>⬜ content lint, safe template on hit"]
    AS --> SC --> RK --> CM
  end

  CG --> PLAN
  PLAN --> GATE{{"🟨 Staff approval gate<br/>approve · modify to a validated option ·<br/>reject with reason — the ONLY exit from proposed"}}
  GATE --> EX["⬜ Executor<br/>calendar holds + mail, re-validated at execution,<br/>RFC threading, lineage hold sweep"]
  EX --> WATCH["watch — replies (diagram 2)"]
  WATCH -->|"counter / clarification"| GATE
  WATCH --> RES["⬜ Resolution<br/>maybeResolveCase — nothing pending"]
```

The state machine (`core/cases.ts`) enforces the gate structurally: a
transition into `executing` requires a `staff*` actor, escalation never
revokes a pending approval, and agents can only _request_ transitions.

## 2. Reply path — understanding, triage, negotiation

```mermaid
flowchart TD
  IN["Inbound reply on a tracked Gmail thread"] --> GU["⬜ Guard<br/>Taglish clinical lexicon, anger, injection"]
  GU -->|"clinical / anger / injection"| HQ["🟨 Quarantined for a person"]
  GU --> EXT["🟦 Constraint extractor<br/>evidence spans, calendar-table date resolution,<br/>merge with prior constraints"]
  EXT --> VAL["⬜ Validator + canonicalizer<br/>rejects impossible sets"]
  VAL --> TRI{"⬜ Triage lanes"}
  TRI -->|"route_legacy"| RL["⬜ Accept / decline / cancel / simple counter"]
  TRI -->|"constraint_review"| CE["🟨 Constraint editor<br/>hard/soft toggles, evidence quotes,<br/>relaxation hints with computed yields"]
  TRI -->|"needs_human"| HQ
  CE -->|"search matching slots"| MM["⬜ Constraint matching<br/>hard constraints filter, soft prefs rank"]
  CE -->|"keep everything — ask the patient"| NP["🟦 Negotiation policy<br/>closed 3-action set: offer by candidate key ·<br/>ask one question · escalate"]
  NP --> PG["⬜ Policy guard<br/>turn budget 3, never-ask-twice,<br/>unknown slot/target rejection"]
  PG --> GATE{{"🟨 Staff approval gate"}}
  GATE --> OUT["⬜ Outbound — same thread"]
  OUT -.->|"patient replies"| IN
  RL -->|"confirm"| ACK["⬜ Deterministic confirmation ack<br/>template only — the one gate-exempt outbound"]
```

## Who does what

| Component                             | Kind    | Tools / inputs                                                                | Fallback when AI is down        |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------- | ------------------------------- |
| Assessment                            | 🟦 LLM  | read-only: affected appointments, waitlist, patient history, day load         | deterministic priority playbook |
| Scheduling                            | 🟦 LLM  | `find_open_slots` (slots verbatim; the agent only picks searches + narrative) | deterministic search plan       |
| Recovery ranking                      | ⬜ code | validated slots, auditable weights                                            | n/a — always deterministic      |
| Comms drafting                        | 🟦 LLM  | context JSON (times, doctors) — never invents facts                           | safe templates                  |
| Reply guard                           | ⬜ code | Taglish clinical lexicon                                                      | n/a                             |
| Constraint extractor                  | 🟦 LLM  | reply text, calendar table, prior constraints                                 | review handoff — never regex    |
| Validator / triage / diff             | ⬜ code | extracted sets                                                                | n/a                             |
| Negotiation policy                    | 🟦 LLM  | constraint set, candidate slots, relaxation counts                            | escalate to staff, always       |
| Policy guard, state machine, executor | ⬜ code | —                                                                             | n/a                             |

Fallbacks degrade to **staff review, never to dumber automation** — the same
schemas, a person in the loop.
