import { env } from "@/core/env";
import { setServiceHealth, serviceHealth, isForcedFallback } from "@/core/status";
import { audit } from "@/core/audit";
import type { CalendarProvider } from "./calendar/types";
import { SimulatedCalendarProvider } from "./calendar/simulated";
import { GoogleCalendarProvider } from "./calendar/google";
import { getStoredTokens, googleConfigured } from "./oauth";
import type { MailProvider } from "./mail/types";
import { SimulatedMailProvider } from "./mail/simulated";
import { GmailProvider } from "./mail/google";

/**
 * Provider access rules (part of the safety design):
 *  - Agents receive READ access only (freeBusy/listEvents). They have no write tools.
 *  - WRITE providers are handed out to exactly two callers:
 *      1. the Executor, for staff-approved recommendations, and
 *      2. direct human actions (patient booking/cancel, doctor emergency block),
 *         each audited under the human actor.
 *  - Live provider failure marks the service unhealthy and visibly degrades to
 *    the simulated provider (Presentation Resilience Mode). Never silent.
 */

function calendarLiveWanted(): boolean {
  return env().CALENDAR_PROVIDER === "google" && !isForcedFallback();
}

function mailLiveWanted(): boolean {
  return env().MAIL_PROVIDER === "gmail" && !isForcedFallback();
}

export function calendarConnectionState(): "ok" | "not_configured" | "no_tokens" {
  if (!googleConfigured()) return "not_configured";
  if (!getStoredTokens()) return "no_tokens";
  return "ok";
}

export type ProviderPick<T> = { provider: T; live: boolean; fallbackReason?: string };

export function pickCalendarProvider(): ProviderPick<CalendarProvider> {
  if (!calendarLiveWanted()) {
    const reason = isForcedFallback()
      ? "Presentation Resilience Mode forced"
      : "CALENDAR_PROVIDER=simulated";
    return { provider: new SimulatedCalendarProvider(), live: false, fallbackReason: reason };
  }
  const conn = calendarConnectionState();
  if (conn !== "ok") {
    setServiceHealth("calendar", {
      status: "not_configured",
      detail: conn === "not_configured" ? "Google OAuth credentials missing in .env" : "Google account not connected yet",
    });
    return {
      provider: new SimulatedCalendarProvider(),
      live: false,
      fallbackReason: conn === "not_configured" ? "Google OAuth not configured" : "Google account not connected",
    };
  }
  const health = serviceHealth("calendar");
  if (health.status === "error") {
    return { provider: new SimulatedCalendarProvider(), live: false, fallbackReason: health.detail ?? "recent Google Calendar failure" };
  }
  try {
    return { provider: new GoogleCalendarProvider(), live: true };
  } catch (e) {
    markCalendarUnhealthy(e);
    return { provider: new SimulatedCalendarProvider(), live: false, fallbackReason: String((e as Error).message) };
  }
}

export function pickMailProvider(): ProviderPick<MailProvider> {
  if (!mailLiveWanted()) {
    const reason = isForcedFallback() ? "Presentation Resilience Mode forced" : "MAIL_PROVIDER=simulated";
    return { provider: new SimulatedMailProvider(), live: false, fallbackReason: reason };
  }
  const conn = calendarConnectionState(); // same Google account/token
  if (conn !== "ok") {
    setServiceHealth("mail", {
      status: "not_configured",
      detail: conn === "not_configured" ? "Google OAuth credentials missing in .env" : "Google account not connected yet",
    });
    return {
      provider: new SimulatedMailProvider(),
      live: false,
      fallbackReason: conn === "not_configured" ? "Google OAuth not configured" : "Google account not connected",
    };
  }
  const health = serviceHealth("mail");
  if (health.status === "error") {
    return { provider: new SimulatedMailProvider(), live: false, fallbackReason: health.detail ?? "recent Gmail failure" };
  }
  try {
    return { provider: new GmailProvider(), live: true };
  } catch (e) {
    markMailUnhealthy(e);
    return { provider: new SimulatedMailProvider(), live: false, fallbackReason: String((e as Error).message) };
  }
}

export function markCalendarUnhealthy(e: unknown): void {
  const detail = String((e as Error)?.message ?? e).slice(0, 200);
  setServiceHealth("calendar", { status: "error", detail });
  audit({ actor: "system", action: "provider.calendar.unhealthy", detail: { detail } });
}

export function markCalendarHealthy(detail?: string): void {
  setServiceHealth("calendar", { status: "ok", detail });
}

export function markMailUnhealthy(e: unknown): void {
  const detail = String((e as Error)?.message ?? e).slice(0, 200);
  setServiceHealth("mail", { status: "error", detail });
  audit({ actor: "system", action: "provider.mail.unhealthy", detail: { detail } });
}

export function markMailHealthy(detail?: string): void {
  setServiceHealth("mail", { status: "ok", detail });
}

/** Read-only busy lookup used by the slot engine wrapper (agent-safe). */
export async function getBusyIntervals(calendarId: string | null, range: { startUtc: string; endUtc: string }) {
  if (!calendarId) return [];
  const pick = pickCalendarProvider();
  try {
    const busy = await pick.provider.freeBusy(calendarId, range);
    if (pick.live) markCalendarHealthy("freeBusy ok");
    return busy;
  } catch (e) {
    if (pick.live) {
      markCalendarUnhealthy(e);
      // Degrade visibly: retry once on the simulated provider so planning continues.
      return new SimulatedCalendarProvider().freeBusy(calendarId, range);
    }
    throw e;
  }
}
