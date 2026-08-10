# PRODUCT.md — SchediCare

## 1. One-liner

SchediCare turns appointment disruptions into managed, recoverable cases. It is an AI coordination layer on top of Google Calendar and Gmail that detects scheduling breakage, plans recovery across all affected patients in parallel, and executes only what clinic staff approve.

## 2. Problem

Outpatient clinics run scheduling on human glue. When one thing breaks — a doctor calls in sick, a patient ghosts, a slot goes unconfirmed — a receptionist must manually: find every affected appointment, hunt for alternatives that respect each doctor's habits, call patients one at a time, update the calendar, and remember to follow up on the ones who didn't answer. A single doctor emergency at 7:40 AM can consume a receptionist's entire morning and still leave slots empty and patients annoyed.

The failure is not a lack of tools (the calendar exists, the email exists). The failure is **coordination under disruption**: parallel, constraint-aware, follow-up-heavy work that humans do serially and forgetfully.

## 3. Positioning

- **Not** an EMR, **not** a calendar replacement, **not** a triage tool.
- **Is** a disruption-management layer: detection → assessment → recovery planning → approved execution → verified resolution.
- Human-in-the-loop by design: the agent proposes, staff disposes.

## 4. Personas

### Maria, 34 — Patient
Books a routine check-up on her phone. Wants: fast booking, honest reminders, painless rescheduling when the clinic cancels on *her*. Hates: calling during work hours, being told "we'll call you back."

### Dr. Elena Santos — Family Medicine
Sees ~15 patients/day. Wants follow-ups in the morning, new consults in the afternoon, a buffer after complex cases, and a hard daily cap. Hates: overbooking, and the chaos her own emergency absence creates for her patients.

### Joy — Front-desk / Clinic Staff
The person who absorbs every disruption today. Wants: one queue of "things that need a decision," ready-made options with reasons, one-click approval, and proof of what was sent to whom. Hates: re-deriving the same rescheduling logic ten times before lunch.

### Admin (clinic manager)
Wants capacity utilization, no-show trends, audit trails, and confidence that the AI never acts alone.

## 5. Jobs to be done

| When… | I want to… | So that… |
|---|---|---|
| A doctor cancels last-minute | see every affected patient with a ranked recovery plan each | nobody falls through the cracks |
| An appointment is unconfirmed the day before | have a confirmation nudge drafted and queued | I only click "approve" |
| A patient replies "can't do 2pm, after 4 works" | have the reply already interpreted with new matching slots proposed | I don't parse emails all day |
| A slot suddenly opens | see the best-fit waitlist candidates ranked | revenue and access don't leak |
| I approve or reject an AI suggestion | have it logged with the reason shown | the clinic can trust and audit the system |

## 6. User stories (demo-scoped)

**Patient**
- P1. As a patient I can search a doctor's availability, pick routine/follow-up/urgent, and book.
- P2. I receive a confirmation and a reminder; I can confirm with one tap/reply.
- P3. If my appointment is disrupted, I receive up to 3 alternatives and can accept, reject, or ask for another time.

**Doctor**
- D1. As a doctor I can set rules: appointment-type windows (follow-ups AM / consults PM), buffers, max/day, max/block.
- D2. I can mark emergency unavailability for a day or range.
- D3. I can see today's capacity, risk flags, and approve recovery actions affecting my calendar.

**Staff**
- S1. As staff I see a live case queue of disruptions with severity and progress.
- S2. For each case I see ranked recovery options **with the reason** each option is valid.
- S3. I can approve / modify / reject any recommendation; nothing external happens without me.
- S4. I can watch the agent activity feed live and replay it afterwards (audit).

## 7. Scope

### In scope (capstone demo)
- 1 fictional clinic, 3 doctors, ~40 seeded patients, 1 staff account, 1 admin account.
- Disruptions: patient cancellation, doctor cancellation, unconfirmed appointment, high no-show risk, vacant-slot recovery.
- Workflows: booking, confirmation, patient reschedule, doctor emergency cascade, waitlist backfill, staff approval.
- Google Calendar + Gmail integration in **dual mode**: live (OAuth, real API) and simulated (identical interface, deterministic). Demo defaults to simulated with a live-mode segment.
- One communication channel rendered three ways: Gmail draft, in-app message, SMS-style simulation.

### Out of scope
- EMR/PhilHealth/HMO integration, diagnosis or triage, payments, multi-clinic tenancy, autonomous (unapproved) changes, production PHI handling.

## 8. The wow-factor package (recommended additions)

These are cheap relative to their demo impact and are woven into the implementation plan:

1. **The Cascade** *(flagship demo moment)* — one button: "Dr. Santos — emergency, out today." The ops dashboard erupts in a controlled way: a case opens, the agent activity feed **streams each agent's reasoning live** (SSE), affected-patient cards populate one by one, ranked plans attach, drafts appear — then everything visibly **stops at the approval gate**. The panel watches an org chart of AIs work in parallel and then defer to a human. This is the single most memorable thing you can show.
2. **Glass-box recommendations** — every option card has a "Why?" expander citing the exact constraints used: *"Fits Dr. Reyes' PM-consult rule · patient prefers afternoons · keeps Thursday under the 15-patient cap."* Panels punish black boxes; this converts skeptics.
3. **Patient Simulator Agent** — an LLM role-playing 8 patient personas (agreeable, picky, non-responsive, reschedule-happy…) that answers drafts with realistic messiness. Your demo closes the full loop live without real phones, and it doubles as your evaluation traffic generator.
4. **Recovery scoreboard** — live counters during the cascade: *minutes to full recovery, slots recovered, messages drafted vs. sent, staff clicks avoided vs. manual baseline.* Turns the demo into measurable claims for the paper.
5. **⌘K command bar** — staff type natural language: "move Dr. Santos' Thursday PM follow-ups to Friday" → Orchestrator parses it into a case. Ten seconds of screen time, huge "fully agentic" credibility.
6. **Risk heatmap week view** — no-show risk shading over the calendar; clicking a hot cell opens the preventive-action case.
7. **Degraded-mode toggle** — flip "LLM offline" and show the system falling back to deterministic suggestions + escalation to staff. A safety story panels rarely see and always remember.
8. **Audit replay scrubber** — drag through a resolved case's timeline like a video. Sells trust, costs little (the timeline data already exists).

Priority if time-boxed: **1, 2, 3, 4** are core; 5–8 are stretch in that order.

## 9. Success metrics (capstone evaluation)

| Metric | Definition | Target for demo |
|---|---|---|
| Recovery-plan generation time | disruption event → ranked plans for all affected patients | < 60s for 9 affected patients |
| Slot recovery rate | vacated slots refilled or rebooked / total vacated | ≥ 70% in simulation |
| Manual actions avoided | staff actions in manual baseline − actions with SchediCare (scripted comparison) | ≥ 80% reduction |
| Risk detection performance | precision/recall of rule-based no-show flags on simulated history | report P/R, no hard target |
| Recommendation feasibility | % of generated options passing the deterministic validator | 100% (by construction — validator gates output) |
| Reply interpretation accuracy | % of simulated patient replies mapped to correct intent | ≥ 90% on 50-reply eval set |
| Usability | SUS or 5-question Likert with ≥5 test users role-playing staff | ≥ 75 SUS |

## 10. Demo narrative (7 minutes)

1. **(0:30)** Maria books on her phone — show doctor-rule-aware slots.
2. **(0:45)** Doctor dashboard: Dr. Santos' rules, capacity bar, tomorrow's risk flags.
3. **(0:30)** Ops dashboard at rest: the normal flagship profile is clean so the Santos cascade remains the focus. Use the full demo profile only when backup sweep cases are needed for questions.
4. **(2:30)** **The Cascade**: emergency button → live agent feed → ranked plans with "Why?" → approval gate → staff approves 7, modifies 1, rejects 1.
5. **(1:00)** Simulated patients reply; Communication agent interprets, one counter-proposal triggers a mini-replan; calendar updates land (live Google Calendar segment here).
6. **(0:45)** Recovery scoreboard + audit replay of the case.
7. **(1:00)** Safety: degraded-mode toggle, approval logs, what we deliberately do not do (triage, autonomous sends).

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Live Google APIs fail on defense day | Simulated providers are the default path; live mode is a 60-second bonus segment |
| LLM latency ruins the demo | Agents stream; feed shows progress immediately; deterministic tools carry the heavy math |
| LLM output breaks schema | Zod-validated JSON, one retry with error feedback, then escalate case to staff |
| Scope creep across 6 agents | Deterministic cores are shared libraries; agents are thin prompt+tool wrappers (see ARCHITECTURE.md) |
| Panel asks "what if the AI is wrong?" | Approval gate, validator, audit replay, degraded mode — rehearse this answer with the toggle |
