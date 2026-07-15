/**
 * Attendance-risk scoring. Deliberately rule-based and transparent: every
 * point is attributable to a named factor, which becomes the "Why?" chips in
 * the UI. Gemini may explain the score; it never computes it.
 */
import { differenceInCalendarDays, differenceInHours } from "date-fns";
import { fmtManila } from "./clock";
import { CLINIC_TZ } from "./env";
import { formatInTimeZone } from "date-fns-tz";
import type { RiskFactor, RiskResult } from "./types";

export interface RiskInput {
  status: string; // appointment status ("booked" = unconfirmed)
  startUtc: string;
  bookedAt: string;
  now: Date;
  history: Array<{ kind: "attended" | "no_show" | "late_cancel" | "cancelled_ok" }>;
}

export function scoreNoShowRisk(input: RiskInput): RiskResult {
  const factors: RiskFactor[] = [];
  const start = new Date(input.startUtc);
  const hoursUntil = differenceInHours(start, input.now);

  const unconfirmed = input.status === "booked";
  if (unconfirmed) {
    factors.push({ label: "Not yet confirmed", pts: 25 });
    if (hoursUntil <= 48) factors.push({ label: "Unconfirmed within 48h of visit", pts: 10 });
  } else {
    factors.push({ label: "Patient confirmed", pts: -15 });
  }

  const leadDays = differenceInCalendarDays(start, new Date(input.bookedAt));
  if (leadDays >= 14) factors.push({ label: `Booked ${leadDays} days ahead`, pts: 10 });
  else if (leadDays <= 1) factors.push({ label: "Booked at short notice", pts: -5 });

  const noShows = input.history.filter((h) => h.kind === "no_show").length;
  if (noShows > 0) factors.push({ label: `${noShows} prior no-show${noShows > 1 ? "s" : ""}`, pts: Math.min(30, noShows * 15) });

  const lateCancels = input.history.filter((h) => h.kind === "late_cancel").length;
  if (lateCancels > 0)
    factors.push({ label: `${lateCancels} prior late cancellation${lateCancels > 1 ? "s" : ""}`, pts: Math.min(16, lateCancels * 8) });

  const attended = input.history.filter((h) => h.kind === "attended").length;
  if (attended >= 3 && noShows === 0) factors.push({ label: `${attended} visits attended, no misses`, pts: -15 });

  const localHour = Number(formatInTimeZone(start, CLINIC_TZ, "H"));
  const localMin = Number(formatInTimeZone(start, CLINIC_TZ, "m"));
  if (localHour < 9) factors.push({ label: `Early slot (${fmtManila(start, "h:mm a")})`, pts: 8 });
  else if (localHour === 13 && localMin === 0) factors.push({ label: "First slot after lunch", pts: 5 });

  const raw = factors.reduce((s, f) => s + f.pts, 0);
  const score = Math.max(0, Math.min(100, raw));
  const band: RiskResult["band"] = score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  return { score, band, factors };
}
