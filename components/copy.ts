/**
 * The secretary layer: every status the system knows, said in plain language.
 * DB values never change; only what people read does. The activity filter
 * decides what a non-technical person sees by default — outcomes and actions,
 * never agent names, tool calls, or runtime modes.
 */
import type { FeedItem } from "@/lib/usePoll";

export type Tone = "warn" | "accent" | "ok" | "bad" | "neutral";

export const CASE_STATE: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Finding times", tone: "accent" },
  assessing: { label: "Finding times", tone: "accent" },
  planning: { label: "Finding times", tone: "accent" },
  awaiting_approval: { label: "Needs your review", tone: "warn" },
  executing: { label: "Booking & notifying", tone: "accent" },
  resolving: { label: "Waiting on patients", tone: "accent" },
  resolved: { label: "Resolved", tone: "ok" },
  escalated: { label: "Needs a person", tone: "bad" },
};

export const APPT_STATUS: Record<string, { label: string; tone: Tone }> = {
  booked: { label: "Unconfirmed", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "ok" },
  completed: { label: "Completed", tone: "neutral" },
  no_show: { label: "No-show", tone: "bad" },
  cancelled_by_patient: { label: "Cancelled by patient", tone: "bad" },
  cancelled_by_doctor: { label: "Cancelled by clinic", tone: "bad" },
  superseded: { label: "Moved", tone: "neutral" },
};

export function appointmentStatus(appt: {
  status: string;
  source?: string | null;
}) {
  if (appt.status === "booked" && appt.source === "schedicare") {
    return { label: "Temporary hold", tone: "warn" as Tone };
  }
  return (
    APPT_STATUS[appt.status] ?? { label: appt.status, tone: "neutral" as Tone }
  );
}

export const REC_STATUS: Record<string, { label: string; tone: Tone }> = {
  proposed: { label: "To review", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  modified: { label: "Approved (time changed)", tone: "ok" },
  rejected: { label: "Won't send", tone: "neutral" },
  executed: { label: "Sent", tone: "accent" },
  failed: { label: "Couldn't complete", tone: "bad" },
};

/** Human status for one patient's thread after execution. */
export function outcomeLabel(rec: {
  status: string;
  outcome?: string | null;
}): { label: string; tone: Tone } {
  if (rec.outcome === "called") return { label: "Called by staff", tone: "ok" };
  if (rec.outcome === "handled")
    return { label: "Handled manually", tone: "ok" };
  if (rec.outcome === "released")
    return { label: "Hold released", tone: "neutral" };
  if (rec.status === "rejected")
    return { label: "Will call instead", tone: "neutral" };
  if (rec.status === "failed")
    return { label: "Couldn't complete — see activity", tone: "bad" };
  if (rec.status !== "executed")
    return REC_STATUS[rec.status] ?? { label: rec.status, tone: "neutral" };
  switch (rec.outcome) {
    case "accepted":
      return { label: "Confirmed", tone: "ok" };
    case "declined":
      return { label: "Declined — call listed", tone: "bad" };
    case "superseded":
      return { label: "Asked for a new time", tone: "accent" };
    case "needs_human":
      return { label: "Needs a person", tone: "warn" };
    case "sent":
      return { label: "Message sent", tone: "neutral" };
    default:
      return { label: "Waiting for reply", tone: "accent" };
  }
}

export function kindLabel(kind: string): string {
  return kind === "reschedule"
    ? "New time"
    : kind === "waitlist_fill"
      ? "Waitlist offer"
      : kind === "clarification"
        ? "Ask the patient"
        : kind === "confirm_nudge"
          ? "Confirmation reminder"
          : "Check-in message";
}

/** Remove implementation labels while retaining the staff-facing explanation. */
export function plainPriorityReason(reason: string): string {
  return reason
    .replace(/\s*\(\s*staffPriority\s*=\s*\d+\s*\)/gi, "")
    .replace(/\s*\bstaffPriority\s*=\s*\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ------------------------------------------------------------- activity feed */

const TECHNICAL_KINDS = new Set(["tool_call", "tool_result", "thought"]);
const TECHNICAL_DETAIL = /^(Gemini reasoning live|Deterministic mode)/;

/** Default view: what a secretary should see. */
export function isPlainEntry(it: FeedItem): boolean {
  if (TECHNICAL_KINDS.has(it.kind)) return false;
  return true;
}

/** Strip runtime jargon from details in the default view. */
export function plainDetail(it: FeedItem): string | null {
  if (!it.detail) return null;
  if (TECHNICAL_DETAIL.test(it.detail)) return null;
  return it.detail;
}

/** Rewrite state-transition titles into the plain vocabulary. */
export function plainTitle(it: FeedItem): string {
  if (it.kind === "transition") {
    const m = it.title.match(/(\w+) → (\w+)/);
    if (m) {
      const to = CASE_STATE[m[2]]?.label ?? m[2];
      return to === "Resolved" ? "All settled" : to;
    }
  }
  return it.title;
}
