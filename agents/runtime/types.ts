import type { z } from "zod";

export type AgentName = "orchestrator" | "assessment" | "scheduling" | "risk" | "recovery" | "comms";

export interface AgentCtx {
  caseId: string | null;
}

export interface ToolDef<I = any, O = any> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  run: (input: I, ctx: AgentCtx) => Promise<O> | O;
  /** Suppress verbose timeline logging for chatty tools. */
  quiet?: boolean;
}

export interface AgentDef<In, Out> {
  name: AgentName;
  /** Present-progressive verb line for the live feed, e.g. "Assessing blast radius". */
  feedVerb: (input: In) => string;
  system: string;
  tools: ToolDef[];
  resultSchema: z.ZodType<Out>;
  maxSteps?: number;
  buildPrompt: (input: In) => string;
  /** Deterministic implementation returning the exact same result shape. */
  fallback: (input: In, ctx: AgentCtx) => Promise<Out>;
}

export interface AgentRunResult<Out> {
  output: Out;
  mode: "live" | "fallback";
  fallbackReason?: string;
  runId: string;
  steps: number;
  toolCalls: number;
  latencyMs: number;
}

export class AgentFailure extends Error {
  constructor(
    message: string,
    public readonly stage: "live" | "fallback"
  ) {
    super(message);
  }
}
