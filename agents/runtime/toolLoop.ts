/**
 * Provider-agnostic live agent loop. Extracted from the original Gemini
 * runtime so every provider (Gemini, Claude on Bedrock, and whatever comes
 * next) runs the exact same discipline:
 *
 *   domain tools + a `submit_result` tool whose schema is the agent's Zod
 *   result schema → iterate on tool calls → the run ONLY ends via a
 *   schema-valid submit_result. Plain-text answers are nudged once; invalid
 *   submissions get the validation error back; running out of steps throws
 *   AgentFailure and runAgent() degrades to the fallback.
 *
 * Providers are thin constructors: gemini.ts / bedrock.ts build a LangChain
 * chat model and delegate here.
 */
import { tool } from "@langchain/core/tools";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentFailure, type AgentCtx, type AgentDef } from "./types";

const SUBMIT = "submit_result";

export interface LoopStats {
  steps: number;
  toolCalls: number;
  toolErrors: number;
}

export async function runToolLoop<In, Out>(
  model: BaseChatModel,
  providerLabel: string,
  def: AgentDef<In, Out>,
  prompt: string,
  ctx: AgentCtx,
  onToolEvent: (
    kind: "call" | "result" | "error",
    name: string,
    detail: string,
  ) => void,
): Promise<{ output: Out; stats: LoopStats }> {
  const domainTools = def.tools.map((t) =>
    tool(async (input: any) => JSON.stringify(await t.run(input, ctx)), {
      name: t.name,
      description: t.description,
      schema: t.schema as any,
    }),
  );
  const submitTool = tool(async () => "ok", {
    name: SUBMIT,
    description:
      "Submit your final answer in the required shape. Call exactly once, when done.",
    schema: def.resultSchema as any,
  });
  const bound = model.bindTools!([...domainTools, submitTool]);

  const messages: BaseMessage[] = [
    new SystemMessage(
      `${def.system}\n\nWhen you have gathered what you need, call ${SUBMIT} with the final answer. Never answer in plain text.`,
    ),
    new HumanMessage(prompt),
  ];

  const maxSteps = def.maxSteps ?? 6;
  const stats: LoopStats = { steps: 0, toolCalls: 0, toolErrors: 0 };

  for (let step = 0; step < maxSteps; step++) {
    stats.steps++;
    const ai = (await bound.invoke(messages)) as AIMessage;
    messages.push(ai);
    const calls = ai.tool_calls ?? [];

    if (calls.length === 0) {
      // Nudge once; plain-text answers are not accepted.
      messages.push(
        new HumanMessage(
          `Call ${SUBMIT} with your final answer in the required schema.`,
        ),
      );
      continue;
    }

    for (const call of calls) {
      if (call.name === SUBMIT) {
        const parsed = def.resultSchema.safeParse(call.args);
        if (parsed.success) return { output: parsed.data, stats };
        stats.toolErrors++;
        onToolEvent(
          "error",
          SUBMIT,
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
            .slice(0, 200),
        );
        messages.push(
          new ToolMessage({
            tool_call_id: call.id ?? SUBMIT,
            content: `Invalid result: ${parsed.error.message.slice(0, 400)}. Fix and resubmit.`,
          }),
        );
        continue;
      }
      const t = def.tools.find((x) => x.name === call.name);
      stats.toolCalls++;
      if (!t) {
        stats.toolErrors++;
        messages.push(
          new ToolMessage({
            tool_call_id: call.id ?? call.name,
            content: `Unknown tool ${call.name}`,
          }),
        );
        continue;
      }
      if (!t.quiet)
        onToolEvent("call", t.name, JSON.stringify(call.args).slice(0, 160));
      try {
        const checked = t.schema.safeParse(call.args);
        if (!checked.success)
          throw new Error(
            checked.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          );
        const result = await t.run(checked.data, ctx);
        if (!t.quiet)
          onToolEvent("result", t.name, JSON.stringify(result).slice(0, 160));
        messages.push(
          new ToolMessage({
            tool_call_id: call.id ?? t.name,
            content: JSON.stringify(result).slice(0, 8000),
          }),
        );
      } catch (e) {
        stats.toolErrors++;
        const msg = String((e as Error).message).slice(0, 200);
        onToolEvent("error", t.name, msg);
        messages.push(
          new ToolMessage({
            tool_call_id: call.id ?? t.name,
            content: `Tool error: ${msg}`,
          }),
        );
      }
    }
  }
  throw new AgentFailure(
    `${providerLabel} did not submit a valid result within ${maxSteps} steps`,
    "live",
  );
}
