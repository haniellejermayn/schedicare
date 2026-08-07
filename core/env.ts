/**
 * Central environment configuration. Every process (Next.js app, worker,
 * scripts, tests) reads the same parsed shape. Missing values degrade to
 * Presentation Resilience Mode defaults instead of crashing.
 */
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("file:./schedicare.db"),
  DEMO_NOW: z.string().default("2026-08-10T07:30:00+08:00"),
  AI_PROVIDER: z.enum(["gemini", "bedrock", "fallback"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().optional().default(""),
  /** Bedrock inference profile ID, e.g. us.anthropic.claude-sonnet-4-6. */
  BEDROCK_MODEL_ID: z.string().optional().default(""),
  BEDROCK_AWS_REGION: z.string().optional().default("ap-southeast-1"),
  /** Bedrock API key (bearer token). The AWS SDK reads this env var directly. */
  AWS_BEARER_TOKEN_BEDROCK: z.string().optional().default(""),
  CALENDAR_PROVIDER: z.enum(["google", "simulated"]).default("google"),
  MAIL_PROVIDER: z.enum(["gmail", "simulated"]).default("gmail"),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_REDIRECT_URI: z
    .string()
    .optional()
    .default("http://localhost:3000/api/oauth/callback"),
  MCP_TRANSPORT: z.enum(["disabled", "http"]).default("disabled"),
  GOOGLE_CALENDAR_MCP_URL: z.string().optional().default(""),
  GOOGLE_GMAIL_MCP_URL: z.string().optional().default(""),
  FALLBACK_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),
  PACING_MS: z
    .string()
    .optional()
    .default("900")
    .transform((v) => Math.max(0, Number(v) || 0)),
  AUTO_SIMULATE_REPLIES: z.string().optional(),
  /** Optional: route all seeded patient email to one inbox via Gmail plus-aliasing. */
  DEMO_PATIENT_EMAIL: z.string().optional().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** Test-only: drop the cached env so a subsequent env() re-reads process.env. */
export function resetEnvCache(): void {
  cached = null;
}

/** Default Gemini model if GEMINI_MODEL is unset. Documented in docs/GEMINI_SETUP.md. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function geminiModel(): string {
  return env().GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

/** Default Bedrock inference profile if BEDROCK_MODEL_ID is unset (US region
 * prefix — swap to eu./jp./apac. to match BEDROCK_AWS_REGION). */
export const DEFAULT_BEDROCK_MODEL = "global.anthropic.claude-sonnet-4-6";

export function bedrockModel(): string {
  return env().BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL;
}

/** Human label for the configured live AI provider. */
export function aiProviderLabel(): string {
  const e = env();
  if (e.AI_PROVIDER === "bedrock")
    return `Claude on Bedrock · ${bedrockModel()}`;
  return `Gemini · ${geminiModel()}`;
}

/** Whether simulated patient replies should be generated automatically. */
export function autoSimulateReplies(): boolean {
  const e = env();
  if (e.AUTO_SIMULATE_REPLIES != null)
    return e.AUTO_SIMULATE_REPLIES !== "false";
  return e.MAIL_PROVIDER === "simulated";
}

export const CLINIC_TZ = "Asia/Manila";
