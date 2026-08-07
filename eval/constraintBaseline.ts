/**
 * npm run eval:constraints — scores constraint extraction against the labeled
 * corpus (eval/constraintCorpus.json).
 *
 * Candidates (CANDIDATE env var):
 *   baseline  (default) — guardReply + ruleClassifyReply adapted into a
 *               SchedulingConstraintSet. The number that defines the problem.
 *   extractor — guardReply + the live constraint-extractor agent
 *               (AI_PROVIDER=bedrock or gemini; in fallback mode this shows
 *               the review-handoff floor, not extraction quality).
 * Both run through the identical scorer, so the delta is apples-to-apples:
 *   CANDIDATE=extractor npm run eval:constraints
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
import "./loadEnv";
import fs from "node:fs";
import path from "node:path";
import { guardReply, ruleClassifyReply } from "@/agents/comms";
import { extractConstraints } from "@/agents/constraintExtractor";
import { aiLiveWanted, fallbackReasonNow } from "@/agents/runtime";
import { aiProviderLabel } from "@/core/env";
import { ensureSchema } from "@/core/db/migrate";
import { seed } from "@/sim/seed";
import {
  SchedulingConstraintSetSchema,
  type ConstraintIntent,
  type SchedulingConstraintSet,
} from "@/core/constraints";
import {
  isoWeekdayOf,
  validateConstraintSet,
} from "@/core/constraintValidation";
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
    /** Field paths (e.g. "hard.allowedDaysOfWeek") where presence and absence
     * are BOTH acceptable — for genuinely bistable encodings. Documented per
     * case; not counted in field tallies either way. */
    optional?: string[];
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
  "preferredDates",
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
  optional: string[] = [],
): { exact: boolean; diffs: string[] } {
  let exact = true;
  const diffs: string[] = [];
  const short = (x: unknown) => JSON.stringify(x ?? null).slice(0, 60);
  const walk = (scope: "hard" | "soft", keys: readonly string[]) => {
    for (const key of keys) {
      const e = (expected[scope] as Record<string, unknown>)[key];
      const p = (predicted[scope] as Record<string, unknown>)[key];
      const has = (x: unknown) =>
        x != null && (!Array.isArray(x) || x.length > 0);
      const label = `${scope}.${key}`;
      if (optional.includes(label)) continue;
      const t = tallies.get(label) ?? { tp: 0, fp: 0, fn: 0 };
      if (has(e) && has(p) && canon(e) === canon(p)) t.tp++;
      else if (has(e) && !has(p))
        (t.fn++,
          (exact = false),
          diffs.push(`${label}: exp ${short(e)} / got —`));
      else if (!has(e) && has(p))
        (t.fp++,
          (exact = false),
          diffs.push(`${label}: exp — / got ${short(p)}`));
      else if (has(e) && has(p))
        (t.fp++,
          t.fn++,
          (exact = false),
          diffs.push(`${label}: exp ${short(e)} / got ${short(p)}`));
      tallies.set(label, t);
    }
  };
  walk("hard", HARD_FIELDS);
  walk("soft", SOFT_FIELDS);
  return { exact, diffs };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const CANDIDATE = (process.env.CANDIDATE ?? "baseline") as
  | "baseline"
  | "extractor";

interface CategoryRow {
  n: number;
  intentOk: number;
  fullMatch: number;
  quarantined: number;
}

const tallies = new Map<string, FieldTally>();
const byCategory = new Map<string, CategoryRow>();
const failures: Array<{
  id: string;
  category: string;
  why: string;
  body?: string;
  expected?: unknown;
  predicted?: unknown;
}> = [];

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
let liveRuns = 0;
let fallbackRuns = 0;

async function predictFor(body: string): Promise<SchedulingConstraintSet> {
  if (CANDIDATE === "baseline")
    return fromLegacyInterpretation(ruleClassifyReply(body));
  const run = await extractConstraints(
    { caseId: null, replyBody: body },
    { caseId: null },
  );
  if (run.mode === "live") liveRuns++;
  else fallbackRuns++;
  return run.output;
}

const short2 = (x: unknown) => JSON.stringify(x ?? null).slice(0, 60);

async function main() {
  const liveAtStart = CANDIDATE === "extractor" && aiLiveWanted();
  if (CANDIDATE === "extractor") {
    console.log(
      liveAtStart
        ? `\nProvider: ${aiProviderLabel()} — running ${corpus.cases.length} live extractions…`
        : `\nWARNING: extractor is in FALLBACK mode — ${fallbackReasonNow()}.\nThis measures the review-handoff floor, NOT extraction quality.\nSet AI_PROVIDER=bedrock and AWS_BEARER_TOKEN_BEDROCK in .env.local (or .env), then rerun.`,
    );
  }
  for (const c of corpus.cases) {
    const r = row(c.category);
    r.n++;
    const guard = guardReply(c.body);

    if (c.expected.guard) {
      guardTotal++;
      let reached = guard.hit;
      if (!reached && CANDIDATE === "baseline") {
        const legacyIntent = ruleClassifyReply(c.body).intent;
        reached = legacyIntent === "needs_human" || legacyIntent === "question";
      } else if (!reached) {
        const p = await predictFor(c.body);
        // Layered detection: the extractor's clinical flag or an ambiguous
        // routing both put the message in front of a human.
        reached = p.clinicalContentDetected || p.intent === "ambiguous";
      }
      if (reached) {
        guardReached++;
        r.intentOk++;
        r.fullMatch++;
      } else {
        failures.push({
          id: c.id,
          category: c.category,
          why: "guard miss — auto-handled instead of reaching a human",
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
    const predictedRaw = await predictFor(c.body);

    // Normalize BOTH sides through the same deterministic validator before
    // comparing, so semantically identical sets (e.g. an explicit end at
    // clinic close vs an open-ended window) are not scored as mismatches.
    const expV = validateConstraintSet(expected);
    const predV = validateConstraintSet(predictedRaw);
    const expectedN = expV.ok ? expV.normalized : expected;
    const predicted = predV.ok ? predV.normalized : predictedRaw;

    const intentOk = predicted.intent === expectedN.intent;
    const { exact, diffs } = compareFields(
      expectedN,
      predicted,
      tallies,
      c.expected.optional ?? [],
    );
    const unresolvedOk =
      expectedN.unresolvedStatements.length > 0 ===
      predicted.unresolvedStatements.length > 0;
    const clinicalOk = !predicted.clinicalContentDetected; // routine message must not be flagged
    if (intentOk) r.intentOk++;
    const full = intentOk && exact && unresolvedOk && predV.ok && clinicalOk;
    if (full) r.fullMatch++;
    else {
      const why: string[] = [];
      if (!intentOk) why.push(`intent ${predicted.intent}≠${expectedN.intent}`);
      if (!predV.ok)
        why.push(`invalid-set (${predV.errors.map((x) => x.code).join(",")})`);
      if (!exact) why.push(...diffs.slice(0, 4));
      if (!clinicalOk) why.push("false clinical flag on routine message");
      if (!unresolvedOk)
        why.push(
          predicted.unresolvedStatements.length > 0
            ? `unresolved-flag: got ${short2(predicted.unresolvedStatements[0])}`
            : "unresolved-flag: expected something unresolved, got none",
        );
      failures.push({
        id: c.id,
        category: c.category,
        why: why.join(" · "),
        body: c.body,
        expected: {
          intent: expectedN.intent,
          hard: expectedN.hard,
          soft: expectedN.soft,
          unresolved: expectedN.unresolvedStatements,
        },
        predicted: {
          intent: predicted.intent,
          hard: predicted.hard,
          soft: predicted.soft,
          unresolved: predicted.unresolvedStatements,
          summary: predicted.summary,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  const pct = (a: number, b: number) =>
    b === 0 ? "  —" : `${Math.round((100 * a) / b)}%`.padStart(4);
  const header =
    CANDIDATE === "baseline"
      ? "Deterministic baseline vs constraint corpus (guard + ruleClassifyReply)"
      : `Constraint extractor vs corpus — ${liveRuns > 0 ? aiProviderLabel() : `FALLBACK MODE (${fallbackReasonNow()})`} · live ${liveRuns} / fallback ${fallbackRuns}`;
  console.log(`\n${header}\n`);
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
    console.log(
      `\nFailed cases (${failures.length}) — full expected/predicted dumps in the results JSON:`,
    );
    for (const f of failures)
      console.log(
        `  ${f.id.padEnd(4)} ${f.category.padEnd(17)} ${f.why.slice(0, 240)}`,
      );
  }

  const out = {
    at: new Date().toISOString(),
    candidate: CANDIDATE,
    provider:
      CANDIDATE === "extractor"
        ? liveRuns > 0
          ? aiProviderLabel()
          : `fallback (${fallbackReasonNow()})`
        : "rules",
    liveRuns,
    fallbackRuns,
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
  const outFile = `constraint-results-${CANDIDATE}.json`;
  fs.writeFileSync(
    path.join(process.cwd(), "eval", outFile),
    JSON.stringify(out, null, 2),
  );
  console.log(`\nWritten to eval/${outFile}\n`);
}

if (CANDIDATE === "extractor") {
  // The extractor reads the doctor roster from the DB (same reset semantics
  // as npm run eval, which also reseeds).
  ensureSchema();
  seed();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
