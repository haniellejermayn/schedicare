/**
 * Claude-on-Bedrock provider via the Converse API (@langchain/aws).
 *
 * Auth: the AWS SDK reads AWS_BEARER_TOKEN_BEDROCK from the environment (API
 * key / bearer-token auth) — no SigV4 credentials needed. Model selection is
 * BEDROCK_MODEL_ID, which must be an inference-profile ID for on-demand use
 * (region-prefixed, e.g. us.anthropic.claude-sonnet-4-6 /
 * us.anthropic.claude-haiku-4-5-20251001-v1:0); swap the prefix (us./eu./jp./
 * apac.) to match BEDROCK_AWS_REGION. Delegates to the shared tool loop so
 * behavior is identical to the Gemini path.
 */
import { ChatBedrockConverse } from "@langchain/aws";
import { bedrockModel, env } from "@/core/env";
import { runToolLoop, type LoopStats } from "./toolLoop";
import type { AgentCtx, AgentDef } from "./types";

export async function runBedrockLoop<In, Out>(
  def: AgentDef<In, Out>,
  prompt: string,
  ctx: AgentCtx,
  onToolEvent: (
    kind: "call" | "result" | "error",
    name: string,
    detail: string,
  ) => void,
): Promise<{ output: Out; stats: LoopStats }> {
  const model = new ChatBedrockConverse({
    model: bedrockModel(),
    region: env().BEDROCK_AWS_REGION,
    temperature: 0.2,
    maxRetries: 1,
  });
  return runToolLoop(model, "Claude on Bedrock", def, prompt, ctx, onToolEvent);
}
