/**
 * npm run eval:constraints — scores constraint extraction against the labeled
 * corpus (eval/constraintCorpus.json).
 *
 * Today it measures ONE candidate: the deterministic baseline (guardReply +
 * ruleClassifyReply adapted into a SchedulingConstraintSet). This is the
 * number that defines the problem: where the baseline saturates, AI is not
 * needed; where it collapses, AI is load-bearing. When the extractor agent
 * lands, it plugs in as a second candidate and the delta is measured by the
 * exact same scorer.
 *
 * Scoring:
 *  - intent accuracy (legacy intents mapped: accept_offer→accept,
 *    reject_offer→decline, confirm→accept, question/needs_human→ambiguous);
 *  - field-level precision/recall over hard+soft fields (exact match per
 *    field; a wrong value counts as both FP and FN);
 *  - full match = intent right, every field exact, no hallucinated fields,
 *    unresolved flag right;
 *  - guard cases (clinical/anger): pass iff the message reaches a human
 *    (guard hit, or classifier lands on needs_human/question).
 * Adapter convention (matches the corpus note): a rule-derived preferredDay
 * becomes allowedDaysOfWeek of that date — bare weekday mentions are labeled
 * as weekday constraints, not pinned dates.
 */
import fs from "node:fs";
import path from "node:path";
import { guardReply, ruleClassifyReply } from "@/agents/comms";
import {
  SchedulingConstraintSetSchema,
  type ConstraintIntent,
  type SchedulingConstraintSet,
} from "@/core/constraints";
import { isoWeekdayOf } from "@/core/constraintValidation";
import type { ReplyInterpretation } from "@/core/types";

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

interface CorpusCase {
  id: string;
  category: string;
  body: string;
  expected: {
    intent?: ConstraintIntent;
    hard?: SchedulingConstraintSet["hard"];
    soft?: SchedulingConstraintSet["soft"];
    unresolved?: boolean;
    guard?: boolean;
  };
}

const corpusPath = path.join(process.cwd(), "eval", "constraintCorpus.json");
const corpus: { cases: CorpusCase[] } = JSON.parse(
  fs.readFileSync(corpusPath, "utf8"),
);

// ---------------------------------------------------------------------------
// Baseline adapter: legacy ReplyInterpretation → SchedulingConstraintSet
// ---------------------------------------------------------------------------

const LEGACY_TO_INTENT: Record<
  ReplyInterpretation["intent"],
  ConstraintIntent
> = {
  confirm: "accept",
  accept_offer: "accept",
  reject_offer: "decline",
  counter_proposal: "counter_proposal",
  cancel: "cancel",
  question: "ambiguous",
  needs_human: "ambiguous",
};

export function fromLegacyInterpretation(
  li: ReplyInterpretation,
): SchedulingConstraintSet {
  const hard: SchedulingConstraintSet["hard"] = {};
  const c = li.constraint;
  if (c) {
    if (c.afterTime || c.beforeTime) {
      hard.timeWindows = [
        {
          ...(c.afterTime ? { start: c.afterTime } : {}),
          ...(c.beforeTime ? { end: c.beforeTime } : {}),
        },
      ];
    } else if (c.dayPart === "am") {
      hard.timeWindows = [{ end: "12:00" }];
    } else if (c.dayPart === "pm") {
      hard.timeWindows = [{ start: "12:00" }];
    }
    if (c.preferredDay) hard.allowedDaysOfWeek = [isoWeekdayOf(c.preferredDay)];
  }
  const intent = LEGACY_TO_INTENT[li.intent];
  return SchedulingConstraintSetSchema.parse({
    intent,
    hard,
    soft: {},
    // Fairness: when the baseline routes to a human it is implicitly flagging
    // the whole message as unresolved — give it that credit so the LLM delta
    // is measured against the strongest possible deterministic reading.
    unresolvedStatements:
      intent === "ambiguous" ? [li.summary || "unclassified"] : [],
    evidence: [],
    confidence: li.confidence,
    summary: li.summary,
  });
}

// ---------------------------------------------------------------------------
// Field comparison
// ---------------------------------------------------------------------------

const HARD_FIELDS = [
  "allowedDates",
  "excludedDates",
  "allowedDaysOfWeek",
  "excludedDaysOfWeek",
  "timeWindows",
  "earliestDate",
  "latestDate",
  "requiredDoctorId",
  "requireSameDoctor",
] as const;
const SOFT_FIELDS = [
  "preferredDoctorId",
  "preferSameDoctor",
  "preferredDaysOfWeek",
  "preferredTimeWindows",
  "earliestPreferredDate",
] as const;

function canon(v: unknown): string {
  if (Array.isArray(v)) {
    const items = v.map((x) => canon(x));
    return `[${[...items].sort().join(",")}]`;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${k}:${canon(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

interface FieldTally {
  tp: number;
  fp: number;
  fn: number;
}

function compareFields(
  expected: SchedulingConstraintSet,
  predicted: SchedulingConstraintSet,
  tallies: Map<string, FieldTally>,
): { exact: boolean } {
  let exact = true;
  const walk = (scope: "hard" | "soft", keys: readonly string[]) => {
    for (const key of keys) {
      const e = (expected[scope] as Record<string, unknown>)[key];
      const p = (predicted[scope] as Record<string, unknown>)[key];
      const has = (x: unknown) =>
        x != null && (!Array.isArray(x) || x.length > 0);
      const label = `${scope}.${key}`;
      const t = tallies.get(label) ?? { tp: 0, fp: 0, fn: 0 };
      if (has(e) && has(p) && canon(e) === canon(p)) t.tp++;
      else if (has(e) && !has(p)) (t.fn++, (exact = false));
      else if (!has(e) && has(p)) (t.fp++, (exact = false));
      else if (has(e) && has(p)) (t.fp++, t.fn++, (exact = false)); // wrong value
      tallies.set(label, t);
    }
  };
  walk("hard", HARD_FIELDS);
  walk("soft", SOFT_FIELDS);
  return { exact };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface CategoryRow {
  n: number;
  intentOk: number;
  fullMatch: number;
  quarantined: number;
}

const tallies = new Map<string, FieldTally>();
const byCategory = new Map<string, CategoryRow>();
const failures: Array<{ id: string; category: string; why: string }> = [];

const row = (cat: string): CategoryRow => {
  const r = byCategory.get(cat) ?? {
    n: 0,
    intentOk: 0,
    fullMatch: 0,
    quarantined: 0,
  };
  byCategory.set(cat, r);
  return r;
};

let guardTotal = 0;
let guardReached = 0;

for (const c of corpus.cases) {
  const r = row(c.category);
  r.n++;
  const guard = guardReply(c.body);

  if (c.expected.guard) {
    guardTotal++;
    const legacyIntent = guard.hit ? null : ruleClassifyReply(c.body).intent;
    const reached =
      guard.hit ||
      legacyIntent === "needs_human" ||
      legacyIntent === "question";
    if (reached) {
      guardReached++;
      r.intentOk++;
      r.fullMatch++;
    } else {
      failures.push({
        id: c.id,
        category: c.category,
        why: `guard miss — auto-handled as ${legacyIntent}`,
      });
    }
    continue;
  }

  if (guard.hit) {
    r.quarantined++;
    failures.push({
      id: c.id,
      category: c.category,
      why: "false quarantine (guard hit on routine message)",
    });
    continue;
  }

  const expected = SchedulingConstraintSetSchema.parse({
    intent: c.expected.intent ?? "ambiguous",
    hard: c.expected.hard ?? {},
    soft: c.expected.soft ?? {},
    unresolvedStatements: c.expected.unresolved
      ? ["(expected: something unresolved)"]
      : [],
    evidence: [],
    confidence: 1,
    summary: "",
  });
  const predicted = fromLegacyInterpretation(ruleClassifyReply(c.body));

  const intentOk = predicted.intent === expected.intent;
  const { exact } = compareFields(expected, predicted, tallies);
  const unresolvedOk =
    expected.unresolvedStatements.length > 0 ===
    predicted.unresolvedStatements.length > 0;
  if (intentOk) r.intentOk++;
  const full = intentOk && exact && unresolvedOk;
  if (full) r.fullMatch++;
  else {
    const why: string[] = [];
    if (!intentOk) why.push(`intent ${predicted.intent}≠${expected.intent}`);
    if (!exact) why.push("fields");
    if (!unresolvedOk) why.push("unresolved-flag");
    failures.push({ id: c.id, category: c.category, why: why.join(", ") });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pct = (a: number, b: number) =>
  b === 0 ? "  —" : `${Math.round((100 * a) / b)}%`.padStart(4);
console.log(
  "\nDeterministic baseline vs constraint corpus (guard + ruleClassifyReply)\n",
);
console.log("category           n   intent  full-match");
let N = 0;
let I = 0;
let F = 0;
for (const [cat, r] of [...byCategory.entries()].sort()) {
  console.log(
    `${cat.padEnd(17)} ${String(r.n).padStart(3)}   ${pct(r.intentOk, r.n)}   ${pct(r.fullMatch, r.n)}`,
  );
  N += r.n;
  I += r.intentOk;
  F += r.fullMatch;
}
console.log(
  `${"TOTAL".padEnd(17)} ${String(N).padStart(3)}   ${pct(I, N)}   ${pct(F, N)}`,
);

let TP = 0;
let FP = 0;
let FN = 0;
for (const t of tallies.values()) {
  TP += t.tp;
  FP += t.fp;
  FN += t.fn;
}
console.log(
  `\nField extraction — precision ${pct(TP, TP + FP).trim()}  recall ${pct(TP, TP + FN).trim()}  (TP ${TP} / FP ${FP} / FN ${FN})`,
);
console.log(`Guard recall (must-reach-human) ${guardReached}/${guardTotal}`);

const worst = [...tallies.entries()]
  .filter(([, t]) => t.fn + t.fp > 0)
  .sort((a, b) => b[1].fn + b[1].fp - (a[1].fn + a[1].fp));
if (worst.length) {
  console.log("\nField misses (fn = missed, fp = wrong/hallucinated):");
  for (const [field, t] of worst)
    console.log(`  ${field.padEnd(28)} tp ${t.tp}  fn ${t.fn}  fp ${t.fp}`);
}
if (failures.length) {
  console.log(`\nFailed cases (${failures.length}):`);
  for (const f of failures)
    console.log(`  ${f.id.padEnd(4)} ${f.category.padEnd(17)} ${f.why}`);
}

const out = {
  at: new Date().toISOString(),
  candidate: "deterministic_baseline",
  total: { n: N, intentAccuracy: I / N, fullMatch: F / N },
  fields: {
    precision: TP / (TP + FP || 1),
    recall: TP / (TP + FN || 1),
    tp: TP,
    fp: FP,
    fn: FN,
  },
  guard: { reached: guardReached, total: guardTotal },
  byCategory: Object.fromEntries(
    [...byCategory.entries()].map(([k, v]) => [k, { ...v }]),
  ),
  failures,
};
fs.writeFileSync(
  path.join(process.cwd(), "eval", "constraint-results.json"),
  JSON.stringify(out, null, 2),
);
console.log("\nWritten to eval/constraint-results.json\n");
