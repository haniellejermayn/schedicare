import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { env } from "@/core/env";
import { timeline } from "@/core/timeline";
import { audit } from "@/core/audit";
import {
  serviceHealth,
  setServiceHealth,
  isForcedFallback,
} from "@/core/status";
import { runGeminiLoop } from "./gemini";
import { runBedrockLoop } from "./bedrock";
import { aiProviderLabel } from "@/core/env";
import {
  AgentFailure,
  type AgentCtx,
  type AgentDef,
  type AgentRunResult,
} from "./types";

/** The configured live provider, or null when running deterministic-only. */
export function liveProvider(): "gemini" | "bedrock" | null {
  const e = env();
  if (e.AI_PROVIDER === "gemini" && e.GEMINI_API_KEY) return "gemini";
  if (e.AI_PROVIDER === "bedrock" && e.AWS_BEARER_TOKEN_BEDROCK)
    return "bedrock";
  return null;
}

export function aiLiveWanted(): boolean {
  const provider = liveProvider();
  if (!provider) return false;
  if (isForcedFallback()) return false;
  if (serviceHealth(provider).status === "error") return false;
  return true;
}

export function fallbackReasonNow(): string {
  const e = env();
  if (isForcedFallback())
    return "Presentation Resilience Mode forced from /admin";
  if (e.AI_PROVIDER === "fallback") return "AI_PROVIDER=fallback";
  if (e.AI_PROVIDER === "gemini" && !e.GEMINI_API_KEY)
    return "GEMINI_API_KEY not configured";
  if (e.AI_PROVIDER === "bedrock" && !e.AWS_BEARER_TOKEN_BEDROCK)
    return "AWS_BEARER_TOKEN_BEDROCK not configured";
  const provider = liveProvider();
  if (provider && serviceHealth(provider).status === "error")
    return `${aiProviderLabel()} unavailable: ${serviceHealth(provider).detail ?? "recent API failure"}`;
  return "deterministic mode";
}

/**
 * Run one agent. Live Agentic Mode uses the Gemini function-calling loop; any
 * live failure (network, quota, schema-invalid output twice, step cap) is
 * recorded, marks Gemini unhealthy, and — when FALLBACK_ENABLED — degrades
 * VISIBLY to the deterministic implementation with the same result shape.
 * If the fallback itself throws, the caller escalates the case.
 */
export async function runAgent<In, Out>(
  def: AgentDef<In, Out>,
  input: In,
  ctx: AgentCtx,
): Promise<AgentRunResult<Out>> {
  const started = Date.now();
  const wantLive = aiLiveWanted();
  const run = db
    .insert(schema.agentRuns)
    .values({
      caseId: ctx.caseId,
      agent: def.name,
      mode: wantLive ? "live" : "fallback",
      status: "running",
      input: input as unknown,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();

  if (ctx.caseId)
    timeline(
      ctx.caseId,
      def.name,
      "status",
      `${def.feedVerb(input)}…`,
      wantLive
        ? `${aiProviderLabel()} reasoning live`
        : `Deterministic mode — ${fallbackReasonNow()}`,
    );

  const onToolEvent = (
    kind: "call" | "result" | "error",
    name: string,
    detail: string,
  ) => {
    if (!ctx.caseId) return;
    if (kind === "call")
      timeline(ctx.caseId, def.name, "tool_call", `${name}()`, detail);
    else if (kind === "result")
      timeline(ctx.caseId, def.name, "tool_result", `${name} → done`, detail);
    else timeline(ctx.caseId, def.name, "error", `${name} failed`, detail);
  };

  let liveError: string | null = null;
  const provider = liveProvider();
  if (wantLive && provider) {
    const runLoop = provider === "bedrock" ? runBedrockLoop : runGeminiLoop;
    try {
      const { output, stats } = await runLoop(
        def,
        def.buildPrompt(input),
        ctx,
        onToolEvent,
      );
      db.update(schema.agentRuns)
        .set({
          status: "ok",
          output: output as unknown,
          steps: stats.steps,
          toolCalls: stats.toolCalls,
          toolErrors: stats.toolErrors,
          latencyMs: Date.now() - started,
        })
        .where(eq(schema.agentRuns.id, run.id))
        .run();
      setServiceHealth(provider, { status: "ok", detail: "last agent run ok" });
      return {
        output,
        mode: "live",
        runId: run.id,
        steps: stats.steps,
        toolCalls: stats.toolCalls,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      liveError = String((e as Error).message ?? e).slice(0, 300);
      setServiceHealth(provider, { status: "error", detail: liveError });
      audit({
        actor: def.name,
        action: "agent.live_failed",
        caseId: ctx.caseId,
        detail: { error: liveError },
      });
      if (ctx.caseId)
        timeline(
          ctx.caseId,
          def.name,
          "error",
          `Live ${aiProviderLabel()} run failed — switching to deterministic fallback`,
          liveError,
        );
      if (!env().FALLBACK_ENABLED) {
        db.update(schema.agentRuns)
          .set({
            status: "error",
            error: liveError,
            latencyMs: Date.now() - started,
          })
          .where(eq(schema.agentRuns.id, run.id))
          .run();
        throw new AgentFailure(`${def.name}: ${liveError}`, "live");
      }
    }
  }

  // Deterministic fallback path (Presentation Resilience Mode).
  try {
    const output = def.resultSchema.parse(await def.fallback(input, ctx));
    db.update(schema.agentRuns)
      .set({
        mode: "fallback",
        status: "fallback_ok",
        output: output as unknown,
        error: liveError,
        latencyMs: Date.now() - started,
      })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    return {
      output,
      mode: "fallback",
      fallbackReason: liveError ?? fallbackReasonNow(),
      runId: run.id,
      steps: 1,
      toolCalls: 0,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 300);
    db.update(schema.agentRuns)
      .set({
        status: "error",
        error: liveError ? `${liveError} | fallback: ${msg}` : msg,
        latencyMs: Date.now() - started,
      })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    if (ctx.caseId)
      timeline(
        ctx.caseId,
        def.name,
        "error",
        "Deterministic fallback also failed",
        msg,
      );
    throw new AgentFailure(`${def.name} fallback failed: ${msg}`, "fallback");
  }
}
