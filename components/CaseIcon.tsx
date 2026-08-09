import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import type { Tone } from "@/components/copy";

/**
 * Cases carry a typed `type` enum, so the row marker can say what kind of
 * disruption this is instead of showing initials derived from the title
 * (which produced markers like "VS" for "Vacated slot: Liza Soriano").
 */
export type CaseType =
  | "doctor_emergency"
  | "patient_cancellation"
  | "confirmation"
  | "no_show_risk"
  | "slot_recovery";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const GLYPH: Record<CaseType, ReactNode> = {
  // A person, struck through — the doctor is out.
  doctor_emergency: (
    <>
      <path d="M4 20a7 7 0 0 1 11.2-5.6" {...s} />
      <circle cx="10" cy="7.5" r="3.5" {...s} />
      <path d="M15 19l5-5M20 19l-5-5" {...s} />
    </>
  ),
  // A calendar with a cancelled day.
  patient_cancellation: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" {...s} />
      <path d="M8 3v4M16 3v4M3 10h18M9.5 15.5l5 4M14.5 15.5l-5 4" {...s} />
    </>
  ),
  // An unanswered question — waiting on a confirmation.
  confirmation: (
    <>
      <circle cx="12" cy="12" r="9" {...s} />
      <path d="M9.4 9.3a2.7 2.7 0 1 1 3.4 3.2v1.4" {...s} />
      <path d="M12.7 17.2h.01" {...s} strokeWidth={2.4} />
    </>
  ),
  // Alert triangle — this appointment is at risk.
  no_show_risk: (
    <>
      <path d="M12 3.8 21 19.5H3L12 3.8Z" {...s} />
      <path d="M12 10v4M12 16.8h.01" {...s} />
    </>
  ),
  // An empty slot with a recovery turn.
  slot_recovery: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" {...s} />
      <path d="M20 4v4.5h-4.5" {...s} />
    </>
  ),
};

const TONE: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn border-warn-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  ok: "bg-ok-soft text-ok border-ok-line",
  bad: "bg-bad-soft text-bad border-bad-line",
  neutral: "bg-surface-alt text-muted border-line",
};

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  doctor_emergency: "Doctor out",
  patient_cancellation: "Patient cancelled",
  confirmation: "Unconfirmed visit",
  no_show_risk: "No-show risk",
  slot_recovery: "Open slot",
};

export function CaseIcon({
  type,
  tone = "neutral",
  size = 34,
}: {
  type: string;
  tone?: Tone;
  size?: number;
}) {
  const key = (type in GLYPH ? type : "slot_recovery") as CaseType;
  return (
    <span
      role="img"
      aria-label={CASE_TYPE_LABEL[key]}
      title={CASE_TYPE_LABEL[key]}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-ctl border",
        TONE[tone],
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        aria-hidden
      >
        {GLYPH[key]}
      </svg>
    </span>
  );
}
