/**
 * Gemini function-calling loop (Live Agentic Mode). Uses the current official
 * @google/genai SDK. The model can only act through the agent's declared
 * tools; it finishes by calling the terminal `submit_result` tool whose input
 * schema is the agent's Zod contract. Invalid input is fed back once as a tool
 * error; a second failure throws, which the runtime converts into a visible
 * deterministic fallback (and, if that also fails, a case escalation).
 */
import { GoogleGenAI, FunctionCallingConfigMode, type Content, type Part } from "@google/genai";
import { env, geminiModel } from "@/core/env";
import { timeline } from "@/core/timeline";
import { zodToGemini } from "./zodToGemini";
import type { AgentCtx, AgentDef, ToolDef } from "./types";

const STEP_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function generateWithRetry(ai: GoogleGenAI, req: Parameters<GoogleGenAI["models"]["generateContent"]>[0]) {
  try {
    return await withTimeout(ai.models.generateContent(req), STEP_TIMEOUT_MS, "Gemini call");
  } catch (first) {
    // One retry for transient network/5xx/timeout conditions.
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await withTimeout(ai.models.generateContent(req), STEP_TIMEOUT_MS, "Gemini call (retry)");
    } catch {
      throw first;
    }
  }
}

function extractCalls(res: unknown): Array<{ name: string; args: Record<string, unknown> }> {
  const r = res as { functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }> };
  const direct = r.functionCalls;
  if (Array.isArray(direct) && direct.length) {
    return direct.filter((c) => c?.name).map((c) => ({ name: c.name as string, args: c.args ?? {} }));
  }
  const parts: Part[] =
    (res as { candidates?: Array<{ content?: { parts?: Part[] } }> }).candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p): p is Part & { functionCall: { name: string; args?: Record<string, unknown> } } => Boolean((p as any).functionCall?.name))
    .map((p) => ({ name: p.functionCall.name, args: (p.functionCall.args as Record<string, unknown>) ?? {} }));
}

function extractText(res: unknown): string {
  const r = res as { text?: string; candidates?: Array<{ content?: { parts?: Part[] } }> };
  if (typeof r.text === "string" && r.text) return r.text;
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => (p as { text?: string }).text ?? "").join("").trim();
}

function modelContent(res: unknown, calls: Array<{ name: string; args: Record<string, unknown> }>): Content {
  const parts = (res as { candidates?: Array<{ content?: { parts?: Part[] } }> }).candidates?.[0]?.content?.parts;
  if (parts?.length) return { role: "model", parts };
  return { role: "model", parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) };
}

export interface GeminiLoopStats {
  steps: number;
  toolCalls: number;
  toolErrors: number;
}

export async function runGeminiLoop<In, Out>(
  def: AgentDef<In, Out>,
  prompt: string,
  ctx: AgentCtx,
  onToolEvent?: (kind: "call" | "result" | "error", name: string, detail: string) => void
): Promise<{ output: Out; stats: GeminiLoopStats }> {
  const ai = new GoogleGenAI({ apiKey: env().GEMINI_API_KEY });
  const model = geminiModel();

  let result: Out | null = null;
  let resultAttempts = 0;
  const tools: ToolDef[] = [
    ...def.tools,
    {
      name: "submit_result",
      description:
        "Submit your final structured result. You MUST finish by calling this tool exactly once. The input must match the schema precisely.",
      schema: def.resultSchema,
      run: async (input: Out) => {
        result = input;
        return { accepted: true };
      },
    },
  ];

  const functionDeclarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToGemini(t.schema),
  }));

  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  const stats: GeminiLoopStats = { steps: 0, toolCalls: 0, toolErrors: 0 };
  const maxSteps = def.maxSteps ?? 8;
  let nudged = false;

  while (stats.steps < maxSteps && result === null) {
    stats.steps += 1;
    const res = await generateWithRetry(ai, {
      model,
      contents,
      config: {
        systemInstruction: def.system,
        temperature: 0.2,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      },
    });

    const calls = extractCalls(res);
    const text = extractText(res);
    if (text && ctx.caseId) timeline(ctx.caseId, def.name, "thought", text.slice(0, 220), text.length > 220 ? text.slice(0, 800) : null);

    if (calls.length === 0) {
      if (!nudged) {
        nudged = true;
        contents.push({ role: "model", parts: [{ text: text || "(no tool call)" }] });
        contents.push({
          role: "user",
          parts: [{ text: "You must finish by calling the submit_result tool with a schema-valid payload. Call it now." }],
        });
        continue;
      }
      throw new Error(`${def.name} agent ended without calling submit_result`);
    }

    contents.push(modelContent(res, calls));
    const responseParts: Part[] = [];
    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      let payload: unknown;
      if (!tool) {
        payload = { error: `unknown tool ${call.name}` };
        stats.toolErrors += 1;
        onToolEvent?.("error", call.name, "unknown tool");
      } else {
        const parsed = tool.schema.safeParse(call.args);
        if (!parsed.success) {
          stats.toolErrors += 1;
          if (tool.name === "submit_result") resultAttempts += 1;
          payload = {
            error: "invalid_input",
            issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 8),
          };
          onToolEvent?.("error", call.name, "schema validation failed");
          if (tool.name === "submit_result" && resultAttempts >= 2) {
            throw new Error(
              `${def.name} agent produced schema-invalid submit_result twice: ${(payload as any).issues.join("; ")}`
            );
          }
        } else {
          stats.toolCalls += 1;
          onToolEvent?.("call", call.name, JSON.stringify(call.args).slice(0, 240));
          try {
            payload = await tool.run(parsed.data, ctx);
            if (!tool.quiet) onToolEvent?.("result", call.name, JSON.stringify(payload ?? null).slice(0, 240));
          } catch (e) {
            stats.toolErrors += 1;
            payload = { error: String((e as Error).message ?? e).slice(0, 300) };
            onToolEvent?.("error", call.name, (payload as any).error);
          }
        }
      }
      responseParts.push({ functionResponse: { name: call.name, response: { result: payload } } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  if (result === null) throw new Error(`${def.name} agent hit the ${maxSteps}-step cap without submitting a result`);
  const validated = def.resultSchema.safeParse(result);
  if (!validated.success) throw new Error(`${def.name} final result failed validation: ${validated.error.message.slice(0, 300)}`);
  return { output: validated.data, stats };
}
