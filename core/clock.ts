/**
 * Demo clock. All time in the system flows through demoNow(), which is anchored
 * to DEMO_NOW at process start and advances in real time from there. Restarting
 * a process re-anchors it, so the demo is always "the morning of the demo day"
 * (2026-08-10 07:30 Asia/Manila by default) no matter when it is actually run.
 */
import { formatInTimeZone } from "date-fns-tz";
import { env, CLINIC_TZ } from "./env";

const anchor = new Date(env().DEMO_NOW);
const bootedAt = Date.now();

export function demoNow(): Date {
  return new Date(anchor.getTime() + (Date.now() - bootedAt));
}

export function demoNowIso(): string {
  return demoNow().toISOString();
}

/** Current demo date (yyyy-MM-dd) in the clinic timezone. */
export function demoToday(): string {
  return formatInTimeZone(demoNow(), CLINIC_TZ, "yyyy-MM-dd");
}

export function manilaDate(d: Date | string): string {
  return formatInTimeZone(typeof d === "string" ? new Date(d) : d, CLINIC_TZ, "yyyy-MM-dd");
}

export function fmtManila(d: Date | string, pattern: string): string {
  return formatInTimeZone(typeof d === "string" ? new Date(d) : d, CLINIC_TZ, pattern);
}

/** Human label like "Mon Aug 10 · 9:30 AM" in clinic time. */
export function fmtWhen(d: Date | string): string {
  return fmtManila(d, "EEE MMM d · h:mm a");
}

export function fmtTime(d: Date | string): string {
  return fmtManila(d, "h:mm a");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
