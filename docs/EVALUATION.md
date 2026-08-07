# Evaluation

`npm run eval` measures the system against the capstone success metrics and
writes `eval/results.json`. It runs the same in-process pipeline as the tests:
seed → emergency → plan → staff approve-all → execute → persona replies →
replan round → measure. Fully offline in resilience mode; with
`AI_PROVIDER=gemini` the identical script measures the live path.

## Latest measured results (resilience mode, this machine)

| Metric                                          | Target | Measured                                                                                               |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Reply-intent accuracy (50 labeled replies)      | ≥ 90%  | **50/50 = 100%**                                                                                       |
| Red-flag replies reaching a human (guard)       | 5/5    | **5/5**                                                                                                |
| Offered-option feasibility (validator re-check) | 100%   | **19/19 = 100%**                                                                                       |
| Slot recovery (rebooked / affected)             | ≥ 70%  | **6/6 = 100%**                                                                                         |
| Confirmed after replies                         | —      | 5 of 6 rebooked (Grace path = staff callback by design)                                                |
| Manual actions avoided (replies auto-handled)   | ≥ 80%  | **6/6 = 100%**                                                                                         |
| Time to approval gate (6 patients)              | < 30 s | **~0.4 s** (fallback agents)                                                                           |
| Agent-run errors                                | 0      | **0** (13 runs — one fewer than v1: the LLM orchestrator was replaced by the graph)                    |
| Tool-call success                               | ≥ 95%  | 100% (0 calls in fallback — deterministic playbooks don't use the tool loop; live mode populates this) |
| Care minutes recovered (flagship case)          | —      | **130**                                                                                                |

## Constraint-extraction corpus (`eval/constraintCorpus.json`)

`npm run eval:constraints` scores constraint extraction against 65 labeled
messy replies where every expected answer is a `SchedulingConstraintSet`
(hard/soft fields, unresolved flag, guard requirement). Categories: clean
accept/decline/cancel, simple counters, compound, negation, relative dates,
Taglish, doctor preference, ambiguous, clinical-mixed. Scoring is
field-level (exact match; wrong value = FP+FN), plus intent accuracy, full
match, and must-reach-human recall for guard cases. The deterministic
baseline (guard + `ruleClassifyReply`, steelmanned: routing to a human
counts as flagging everything unresolved) currently measures:

| Slice                 | Intent  | Full match |
| --------------------- | ------- | ---------- |
| simple_counter (8)    | 100%    | 88%        |
| compound (10)         | 100%    | **0%**     |
| negation (6)          | 67%     | 0%         |
| relative_date (6)     | 33%     | 0%         |
| doctor_preference (5) | 0%      | 0%         |
| taglish (9)           | 33%     | 11%        |
| **TOTAL (65)**        | **63%** | **34%**    |

Field extraction: precision 48%, recall 26%. Guard recall 2/4 (misses
"headaches" and Taglish "nahihilo"; false-quarantines "mag-alas dose").
The same scorer accepts additional candidates — the constraint-extractor
agent plugs in beside the baseline so the delta is measured identically.
Results land in `eval/constraint-results.json`.

## The reply dataset (`eval/replies.json`)

50 messages: 12 accepts (incl. accept-with-"earlier" phrasing and Taglish
sign-offs), 7 rejects, 5 cancels, 10 counters (after/before times, "before
noon", weekday, mornings/afternoons, mixed reject+counter), 6 questions, 5
ambiguous/gibberish (incl. Taglish hedging "ok pero hindi ako sure…"), and 5
guard cases (chest pain + meds, vitals + ER, pediatric symptoms, injection
attempt, legal threat). Guard cases count as correct **only** when routed to a
human. Misclassifications are printed with expected → got for error analysis.

## Honest notes

- These are deterministic-classifier numbers; the live Gemini interpreter is
  schema-constrained to the same intent set but is not benchmarked here
  (requires a key + quota). The fallback classifier is what guarantees the
  demo floor.
- "Manual actions avoided" counts replies fully handled without staff typing;
  staff _approvals_ are intentionally not automated — they are the product.
- Slot recovery hits 100% partly because the cross-patient dedupe pass
  (PROJECT_STATUS.md §2) prevents self-inflicted collisions; the executor veto
  remains as the backstop and fires in tests when forced.

## Reproduce

```bash
npm run eval                      # resilience mode
AI_PROVIDER=gemini GEMINI_API_KEY=... npm run eval   # live-brain comparison
cat eval/results.json
```
