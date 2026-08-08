/**
 * Demo clock. All time in the system flows through demoNow(), anchored to
 * DEMO_NOW and advancing in real time.
 *
 * The anchor is SHARED across processes via a small file (.tmp/clock-anchor):
 * the first process to boot writes the pairing (real time ↔ demo time), and
 * every later process reuses it, so the Next server and the worker agree on
 * "now" and the timeline never sorts staff actions before the events they
 * caused. Delete the file (or run demo:reset, which does) to re-anchor at
 * the demo-day morning. Tests keep the old per-process anchor for
 * determinism.
 */
import fs from "node:fs";
import path from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import { env, CLINIC_TZ } from "./env";

function resolveAnchor(): { anchor: number; bootedAt: number } {
  const fallback = {
    anchor: new Date(env().DEMO_NOW).getTime(),
    bootedAt: Date.now(),
  };
  if (process.env.VITEST || process.env.NODE_ENV === "test") return fallback;
  try {
    const file = path.join(process.cwd(), ".tmp", "clock-anchor");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        typeof saved?.anchor === "number" &&
        typeof saved?.real === "number" &&
        saved.demoNowEnv === env().DEMO_NOW
      )
        return { anchor: saved.anchor, bootedAt: saved.real };
    } catch {
      /* absent or corrupt — write fresh below */
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        anchor: fallback.anchor,
        real: fallback.bootedAt,
        demoNowEnv: env().DEMO_NOW,
      }),
    );
    return fallback;
  } catch {
    return fallback;
  }
}

const { anchor: anchorMs, bootedAt } = resolveAnchor();

export function demoNow(): Date {
  return new Date(anchorMs + (Date.now() - bootedAt));
}

export function demoNowIso(): string {
  return demoNow().toISOString();
}

/** Current demo date (yyyy-MM-dd) in the clinic timezone. */
export function demoToday(): string {
  return formatInTimeZone(demoNow(), CLINIC_TZ, "yyyy-MM-dd");
}

export function manilaDate(d: Date | string): string {
  return formatInTimeZone(
    typeof d === "string" ? new Date(d) : d,
    CLINIC_TZ,
    "yyyy-MM-dd",
  );
}

export function fmtManila(d: Date | string, pattern: string): string {
  return formatInTimeZone(
    typeof d === "string" ? new Date(d) : d,
    CLINIC_TZ,
    pattern,
  );
}

/** Human label like "Mon Aug 10 · 9:30 AM" in clinic time. */
export function fmtWhen(d: Date | string): string {
  return fmtManila(d, "EEE MMM d · h:mm a");
}

export function fmtTime(d: Date | string): string {
  return fmtManila(d, "h:mm a");
}

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
