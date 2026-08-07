/**
 * Gemini provider: constructs the LangChain Google model and delegates to the
 * shared provider-agnostic tool loop (toolLoop.ts). Same submit_result
 * discipline as every other provider.
 */
import { ChatGoogle } from "@langchain/google/node";
import { env, geminiModel } from "@/core/env";
import { runToolLoop, type LoopStats } from "./toolLoop";
import type { AgentCtx, AgentDef } from "./types";

export async function runGeminiLoop<In, Out>(
  def: AgentDef<In, Out>,
  prompt: string,
  ctx: AgentCtx,
  onToolEvent: (
    kind: "call" | "result" | "error",
    name: string,
    detail: string,
  ) => void,
): Promise<{ output: Out; stats: LoopStats }> {
  const model = new ChatGoogle({
    apiKey: env().GEMINI_API_KEY,
    model: geminiModel(),
    platformType: "gcp",
    temperature: 0.2,
    maxRetries: 1,
  });
  return runToolLoop(model, "Gemini", def, prompt, ctx, onToolEvent);
}
