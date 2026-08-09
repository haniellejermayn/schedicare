import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import {
  aiProviderLabel,
  autoSimulateReplies,
  bedrockModel,
  env,
  geminiModel,
} from "@/core/env";
import { runtimeMode, serviceHealth, isForcedFallback } from "@/core/status";
import { googleConfigured, getStoredTokens } from "@/integrations/oauth";
import { getMcpTransport } from "@/integrations/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  const e = env();
  const mode = runtimeMode();
  const doctors = db.select().from(schema.doctors).all();
  const tokens = getStoredTokens();
  const aiProvider = e.AI_PROVIDER;
  const aiHealth =
    aiProvider === "fallback"
      ? { status: "not_configured" }
      : serviceHealth(aiProvider);
  return json({
    mode,
    forcedFallback: isForcedFallback(),
    ai: {
      provider: aiProvider,
      keyPresent:
        aiProvider === "bedrock"
          ? Boolean(e.AWS_BEARER_TOKEN_BEDROCK)
          : aiProvider === "gemini"
            ? Boolean(e.GEMINI_API_KEY)
            : false,
      model:
        aiProvider === "bedrock"
          ? bedrockModel()
          : aiProvider === "gemini"
            ? geminiModel()
            : "deterministic",
      label:
        aiProvider === "fallback"
          ? "Deterministic fallback"
          : aiProviderLabel(),
      health: aiHealth,
    },
    gemini: {
      provider: e.AI_PROVIDER,
      keyPresent: Boolean(e.GEMINI_API_KEY),
      model: geminiModel(),
      health: serviceHealth("gemini"),
    },
    google: {
      configured: googleConfigured(),
      connected: Boolean(tokens),
      calendarProvider: e.CALENDAR_PROVIDER,
      mailProvider: e.MAIL_PROVIDER,
      autoSimulateReplies: autoSimulateReplies(),
      gmailPollMs: e.GMAIL_POLL_MS,
      patientInboxConfigured: Boolean(e.DEMO_PATIENT_EMAIL),
      calendarHealth: serviceHealth("calendar"),
      mailHealth: serviceHealth("mail"),
    },
    mcp: {
      transport: e.MCP_TRANSPORT,
      status: getMcpTransport().status(),
      calendarUrl: e.GOOGLE_CALENDAR_MCP_URL ? "configured" : "",
      gmailUrl: e.GOOGLE_GMAIL_MCP_URL ? "configured" : "",
      health: serviceHealth("mcp"),
    },
    mapping: doctors.map((d) => ({ doctorId: d.id, name: d.name, calendarId: d.calendarId })),
  });
}
