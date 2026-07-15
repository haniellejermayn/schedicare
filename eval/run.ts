/**
 * npm run eval — measures the agentic system against the capstone's success
 * metrics, using the same in-process pipeline the tests exercise:
 *
 *   1. Reply understanding: intent accuracy over 50 labeled patient replies
 *      (guard-tripping messages must reach a human).
 *   2. Flagship pipeline: planning latency, option feasibility (validator
 *      re-check), slot recovery rate, confirmation rate, manual actions
 *      avoided, agent tool-call success, fallback rate, MCP status.
 *
 * Runs fully offline in resilience mode. With GEMINI_API_KEY + AI_PROVIDER=
 * gemini the same script measures the live path (latency/fallback will differ).
 * Results: printed + written to eval/results.json.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { seed } from "@/sim/seed";
import { db, schema } from "@/core/db/client";
import { claimNextEvent, completeEvent, failEvent, enqueueEvent } from "@/worker/queue";
import { routeEvent } from "@/worker/router";
import { handlePatientReply } from "@/worker/replies";
import { ruleClassifyReply, guardReply } from "@/agents/comms";
import { validatePlacementNow } from "@/core/scheduling";
import { getCase, pendingRecommendationCounts, transitionCase } from "@/core/cases";
import { runMcpHealthCheck } from "@/integrations/mcp";
import { runtimeMode } from "@/core/status";
import { caseScoreboard } from "@/lib/metrics";
import { demoNowIso } from "@/core/clock";
import { ensureSchema } from "@/core/db/migrate";
import { audit } from "@/core/audit";
import { timeline } from "@/core/timeline";
import { PERSONAS, personaReply } from "@/sim/personas";

async function pump(max = 300): Promise<number> {
  let n = 0;
  for (let i = 0; i < max; i++) {
    const ev = claimNextEvent();
    if (!ev) break;
    try {
      await routeEvent(ev);
      completeEvent(ev.id);
    } catch (e) {
      failEvent(ev.id, ev.attempts < 2);
      if (ev.attempts >= 2) throw e;
    }
    n++;
  }
  return n;
}

function injectReply(caseId: string, recId: string, body: string) {
  const rec = db.select().from(schema.recommendations).where(eq(schema.recommendations.id, recId)).get()!;
  const payload = rec.payload as any;
  const outbound = db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.recommendationId, recId), eq(schema.messages.direction, "outbound")))
    .all()
    .at(-1);
  if (!outbound) return Promise.resolve();
  const inbound = db
    .insert(schema.messages)
    .values({
      caseId,
      recommendationId: recId,
      appointmentId: outbound.appointmentId,
      patientId: payload.patientId,
      direction: "inbound",
      subject: `Re: ${outbound.subject}`,
      body,
      status: "received",
      provider: "simulated",
      threadId: outbound.threadId,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return handlePatientReply(inbound.id);
}

function approveAll(caseId: string) {
  const proposed = db
    .select()
    .from(schema.recommendations)
    .where(and(eq(schema.recommendations.caseId, caseId), eq(schema.recommendations.status, "proposed")))
    .all();
  for (const rec of proposed) {
    db.update(schema.recommendations)
      .set({ status: "approved", decidedBy: "staff", decidedAt: demoNowIso(), decisionReason: "eval: approve all" })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    audit({ actor: "staff", action: "recommendation.approve", refType: "recommendation", refId: rec.id, caseId, detail: { via: "eval" } });
  }
  timeline(caseId, "staff", "decision", `Eval: approved ${proposed.length} recommendations`);
  if (pendingRecommendationCounts(caseId).proposed === 0) {
    transitionCase(caseId, "executing", "staff", "Eval approval");
    enqueueEvent("execute_case", { caseId });
  }
  return proposed.length;
}

async function main() {
  ensureSchema();
  const results: any = { at: new Date().toISOString(), mode: runtimeMode() };

  // ------------------------------------------------------------------ 1) Reply understanding
  const dataset = JSON.parse(fs.readFileSync(path.join(process.cwd(), "eval", "replies.json"), "utf8"));
  let correct = 0;
  const confusion: Record<string, number> = {};
  const misses: Array<{ body: string; expected: string; got: string }> = [];
  for (const c of dataset.cases) {
    const guarded = guardReply(c.body);
    const got = guarded.hit ? "needs_human" : ruleClassifyReply(c.body).intent;
    if (got === c.expected) correct++;
    else {
      confusion[`${c.expected}→${got}`] = (confusion[`${c.expected}→${got}`] ?? 0) + 1;
      misses.push({ body: c.body, expected: c.expected, got });
    }
  }
  results.replyUnderstanding = {
    cases: dataset.cases.length,
    correct,
    accuracy: +(correct / dataset.cases.length).toFixed(3),
    confusion,
    misses,
  };

  // ------------------------------------------------------------------ 2) Flagship pipeline
  seed();
  const t0 = Date.now();
  const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, "doc_santos")).get()!;
  db.update(schema.doctors)
    .set({ status: "unavailable", unavailableDates: [...(doctor.unavailableDates ?? []), "2026-08-10"] })
    .where(eq(schema.doctors.id, "doc_santos"))
    .run();
  enqueueEvent("doctor_emergency", { doctorId: "doc_santos", date: "2026-08-10", reason: "eval run" });
  await pump();
  const planMs = Date.now() - t0;

  const c = db.select().from(schema.cases).where(eq(schema.cases.type, "doctor_emergency")).all().at(-1)!;
  const recs = db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, c.id)).all();

  // Feasibility: every offered option must still pass the hard validator.
  let optionsChecked = 0;
  let optionsValid = 0;
  for (const r of recs) {
    const p = r.payload as any;
    for (const o of p.options ?? []) {
      optionsChecked++;
      const v = await validatePlacementNow({ doctorId: o.doctorId, type: p.type, startUtc: o.startUtc, ignoreAppointmentId: p.appointmentId });
      if (v.ok) optionsValid++;
    }
  }

  // Staff approve everything; execute; personas reply; Miguel's counter replans.
  const approved = approveAll(c.id);
  await pump();
  const executedRecs = () =>
    db
      .select()
      .from(schema.recommendations)
      .where(and(eq(schema.recommendations.caseId, c.id), eq(schema.recommendations.status, "executed")))
      .all();
  let autoHandledReplies = 0;
  let totalReplies = 0;
  for (const r of executedRecs()) {
    const p = r.payload as any;
    const persona = PERSONAS[p.patientId];
    if (!persona) continue; // silent patients (Grace, Dennis)
    const text = personaReply(p.patientId, "first");
    if (!text) continue;
    totalReplies++;
    await injectReply(c.id, r.id, text.body);
  }
  await pump();
  // Handle at most one replan round (Miguel).
  if (getCase(c.id).state === "awaiting_approval") {
    approveAll(c.id);
    await pump();
    const replan = db
      .select()
      .from(schema.recommendations)
      .where(and(eq(schema.recommendations.caseId, c.id), eq(schema.recommendations.status, "executed")))
      .all()
      .find((r) => (r.payload as any).replanOf);
    if (replan) {
      totalReplies++;
      await injectReply(c.id, replan.id, personaReply((replan.payload as any).patientId, "replan")?.body ?? "Yes, that works.");
      await pump();
    }
  }
  const finalRecs = db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, c.id)).all();
  autoHandledReplies = db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.caseId, c.id), eq(schema.messages.direction, "inbound")))
    .all()
    .filter((m) => m.status === "interpreted" && m.intent && m.intent !== "needs_human").length;

  const board = caseScoreboard(c.id);
  const runs = db.select().from(schema.agentRuns).all();
  const toolCalls = runs.reduce((a, r) => a + r.toolCalls, 0);
  const toolErrors = runs.reduce((a, r) => a + r.toolErrors, 0);

  results.pipeline = {
    caseState: getCase(c.id).state,
    planningMsToApprovalGate: planMs,
    recommendations: recs.length,
    optionFeasibility: { checked: optionsChecked, valid: optionsValid, rate: optionsChecked ? +(optionsValid / optionsChecked).toFixed(3) : 1 },
    approvedByStaff: approved,
    scoreboard: board,
    slotRecoveryRate: board.affected ? +(board.rebooked / board.affected).toFixed(3) : 0,
    confirmationRate: board.rebooked ? +(board.confirmed / board.rebooked).toFixed(3) : 0,
    repliesInjected: totalReplies,
    repliesAutoHandled: autoHandledReplies,
    manualActionsAvoided: totalReplies ? +(autoHandledReplies / totalReplies).toFixed(3) : 0,
    agentRuns: {
      total: runs.length,
      live: runs.filter((r) => r.mode === "live").length,
      fallback: runs.filter((r) => r.mode === "fallback").length,
      errors: runs.filter((r) => r.status === "error").length,
      avgLatencyMs: runs.length ? Math.round(runs.reduce((a, r) => a + (r.latencyMs ?? 0), 0) / runs.length) : 0,
      toolCalls,
      toolErrors,
      toolSuccessRate: toolCalls ? +((toolCalls - toolErrors) / toolCalls).toFixed(3) : 1,
    },
  };

  results.mcp = await runMcpHealthCheck();

  fs.writeFileSync(path.join(process.cwd(), "eval", "results.json"), JSON.stringify(results, null, 2));

  const r = results;
  console.log("\n================ SchediCare evaluation ================");
  console.log(`Mode: ${r.mode.mode}${r.mode.reasons?.length ? ` (${r.mode.reasons.join("; ")})` : ""}`);
  console.log(`\n[1] Reply understanding: ${r.replyUnderstanding.correct}/${r.replyUnderstanding.cases} = ${(r.replyUnderstanding.accuracy * 100).toFixed(1)}% (target ≥ 90%)`);
  if (r.replyUnderstanding.misses.length) console.log("    misses:", r.replyUnderstanding.misses);
  console.log(`\n[2] Flagship pipeline (case ${r.pipeline.caseState})`);
  console.log(`    time to approval gate: ${r.pipeline.planningMsToApprovalGate} ms for ${r.pipeline.recommendations} recommendations`);
  console.log(`    option feasibility: ${r.pipeline.optionFeasibility.valid}/${r.pipeline.optionFeasibility.checked} = ${(r.pipeline.optionFeasibility.rate * 100).toFixed(1)}% (target 100%)`);
  console.log(`    slot recovery: ${r.pipeline.scoreboard.rebooked}/${r.pipeline.scoreboard.affected} = ${(r.pipeline.slotRecoveryRate * 100).toFixed(1)}% (target ≥ 70%)`);
  console.log(`    confirmed after replies: ${r.pipeline.scoreboard.confirmed} (${(r.pipeline.confirmationRate * 100).toFixed(1)}% of rebooked) · care minutes recovered: ${r.pipeline.scoreboard.minutesRecovered}`);
  console.log(`    manual actions avoided: ${r.pipeline.repliesAutoHandled}/${r.pipeline.repliesInjected} replies auto-handled = ${(r.pipeline.manualActionsAvoided * 100).toFixed(1)}% (target ≥ 80%)`);
  console.log(`    agent runs: ${r.pipeline.agentRuns.total} (live ${r.pipeline.agentRuns.live} / fallback ${r.pipeline.agentRuns.fallback}, errors ${r.pipeline.agentRuns.errors}), avg ${r.pipeline.agentRuns.avgLatencyMs} ms`);
  console.log(`    tool calls: ${r.pipeline.agentRuns.toolCalls} (success ${(r.pipeline.agentRuns.toolSuccessRate * 100).toFixed(1)}%)`);
  console.log(`\n[3] MCP: ${r.mcp.state} — ${r.mcp.detail}`);
  console.log("\nSaved: eval/results.json");
  console.log("=======================================================\n");
}

main().catch((e) => {
  console.error("[eval] failed:", e);
  process.exit(1);
});
