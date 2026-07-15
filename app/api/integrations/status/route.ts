import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { env, geminiModel } from "@/core/env";
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
  return json({
    mode,
    forcedFallback: isForcedFallback(),
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
