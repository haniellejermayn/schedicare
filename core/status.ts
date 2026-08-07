import { db, schema } from "./db/client";
import { eq } from "drizzle-orm";
import { env, aiProviderLabel } from "./env";

export type ServiceState = {
  status:
    | "ok"
    | "error"
    | "not_configured"
    | "simulated"
    | "disabled"
    | "unknown";
  detail?: string;
  at?: string;
};

export function getStatus<T = unknown>(key: string): T | null {
  const row = db
    .select()
    .from(schema.systemStatus)
    .where(eq(schema.systemStatus.key, key))
    .get();
  return row ? (row.value as T) : null;
}

export function setStatus(key: string, value: unknown): void {
  const now = new Date().toISOString();
  db.insert(schema.systemStatus)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.systemStatus.key,
      set: { value, updatedAt: now },
    })
    .run();
}

export function serviceHealth(
  service: "gemini" | "bedrock" | "calendar" | "mail" | "mcp",
): ServiceState {
  return getStatus<ServiceState>(`health:${service}`) ?? { status: "unknown" };
}

export function setServiceHealth(
  service: "gemini" | "bedrock" | "calendar" | "mail" | "mcp",
  state: ServiceState,
): void {
  setStatus(`health:${service}`, { ...state, at: new Date().toISOString() });
}

export function isForcedFallback(): boolean {
  return getStatus<{ on: boolean }>("forced_fallback")?.on === true;
}

export function setForcedFallback(on: boolean, reason?: string): void {
  setStatus("forced_fallback", { on, reason: reason ?? null });
}

export type RuntimeMode = {
  mode: "live" | "resilience";
  reasons: string[];
  services: {
    ai: { live: boolean; detail: string };
    calendar: { live: boolean; detail: string };
    mail: { live: boolean; detail: string };
  };
};

/**
 * Effective runtime mode, recomputed from configuration + recorded health.
 * "Live Agentic Mode" requires Gemini to be configured and healthy; provider
 * degradation is reported per service and flips the overall banner.
 */
export function runtimeMode(): RuntimeMode {
  const e = env();
  const reasons: string[] = [];
  const forced = isForcedFallback();
  if (forced)
    reasons.push("Presentation Resilience Mode was forced from /admin.");

  const aiProvider = e.AI_PROVIDER;
  const aiKeyOk =
    aiProvider === "gemini"
      ? !!e.GEMINI_API_KEY
      : aiProvider === "bedrock"
        ? !!e.AWS_BEARER_TOKEN_BEDROCK
        : false;
  const aiHealth = aiProvider === "fallback" ? null : serviceHealth(aiProvider);
  let aiLive = aiProvider !== "fallback" && aiKeyOk && !forced;
  let aiDetail = aiLive ? aiProviderLabel() : "";
  if (aiProvider === "fallback") {
    aiDetail = "AI_PROVIDER=fallback — deterministic agents";
    reasons.push("AI_PROVIDER is set to fallback.");
  } else if (!aiKeyOk) {
    const keyName =
      aiProvider === "bedrock" ? "AWS_BEARER_TOKEN_BEDROCK" : "GEMINI_API_KEY";
    aiDetail = `${keyName} is not configured`;
    reasons.push(`${keyName} is not configured.`);
    aiLive = false;
  } else if (aiHealth && aiHealth.status === "error") {
    aiDetail = `${aiProviderLabel()} unavailable: ${aiHealth.detail ?? "recent API failure"}`;
    reasons.push(
      `${aiProviderLabel()} failed recently (${aiHealth.detail ?? "API error"}); deterministic agents are covering.`,
    );
    aiLive = false;
  }
  if (forced) aiLive = false;

  const calHealth = serviceHealth("calendar");
  let calLive = e.CALENDAR_PROVIDER === "google" && !forced;
  let calDetail = "Google Calendar";
  if (e.CALENDAR_PROVIDER !== "google") {
    calLive = false;
    calDetail = "Simulated calendar provider (configured)";
    reasons.push("CALENDAR_PROVIDER is set to simulated.");
  } else if (calHealth.status === "error") {
    calLive = false;
    calDetail = `Google Calendar unavailable: ${calHealth.detail ?? "error"}`;
    reasons.push(
      `Google Calendar failed (${calHealth.detail ?? "error"}); simulated calendar is covering.`,
    );
  } else if (calHealth.status === "not_configured") {
    calLive = false;
    calDetail = "Google Calendar not connected — simulated provider covering";
    reasons.push("Google Calendar OAuth is not connected.");
  }
  if (forced) calLive = false;

  const mailHealth = serviceHealth("mail");
  let mailLive = e.MAIL_PROVIDER === "gmail" && !forced;
  let mailDetail = "Gmail";
  if (e.MAIL_PROVIDER !== "gmail") {
    mailLive = false;
    mailDetail = "Simulated mail provider (configured)";
    reasons.push("MAIL_PROVIDER is set to simulated.");
  } else if (mailHealth.status === "error") {
    mailLive = false;
    mailDetail = `Gmail unavailable: ${mailHealth.detail ?? "error"}`;
    reasons.push(
      `Gmail failed (${mailHealth.detail ?? "error"}); simulated mail is covering.`,
    );
  } else if (mailHealth.status === "not_configured") {
    mailLive = false;
    mailDetail = "Gmail not connected — simulated provider covering";
    reasons.push("Gmail OAuth is not connected.");
  }
  if (forced) mailLive = false;

  const mode: RuntimeMode["mode"] = aiLive ? "live" : "resilience";
  return {
    mode,
    reasons,
    services: {
      ai: {
        live: aiLive,
        detail:
          aiDetail || (aiLive ? aiProviderLabel() : "deterministic agents"),
      },
      calendar: { live: calLive, detail: calDetail },
      mail: { live: mailLive, detail: mailDetail },
    },
  };
}
