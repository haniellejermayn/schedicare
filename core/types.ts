import { z } from "zod";

export const APPOINTMENT_TYPES = ["routine", "follow_up", "urgent"] as const;
export type ApptType = (typeof APPOINTMENT_TYPES)[number];

export const DAY_PARTS = ["am", "pm", "any"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** Doctor scheduling rules — the constraints the Scheduling agent must obey. */
export const RuleSetSchema = z.object({
  /** ISO weekday numbers the doctor works (1 = Monday … 7 = Sunday). */
  workDays: z.array(z.number().int().min(1).max(7)).min(1),
  /** Allowed local time windows (HH:mm-HH:mm) per appointment type. */
  windows: z.record(z.enum(APPOINTMENT_TYPES), z.array(z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/))),
  /** Appointment duration in minutes per type. */
  durationMin: z.record(z.enum(APPOINTMENT_TYPES), z.number().int().min(10).max(120)),
  /** Idle buffer required after every appointment. */
  bufferAfterMin: z.number().int().min(0).max(60),
  maxPerDay: z.number().int().min(1).max(40),
  maxPerBlock: z.object({ am: z.number().int().min(0), pm: z.number().int().min(0) }),
});
export type RuleSet = z.infer<typeof RuleSetSchema>;

export interface Interval {
  startUtc: string;
  endUtc: string;
}

export interface Slot {
  doctorId: string;
  startUtc: string;
  endUtc: string;
  block: "am" | "pm";
  /** Clinic-local date yyyy-MM-dd. */
  day: string;
}

export const SlotSchema = z.object({
  doctorId: z.string(),
  startUtc: z.string(),
  endUtc: z.string(),
  block: z.enum(["am", "pm"]),
  day: z.string(),
});

/** A validated recovery option offered to staff. */
export const RecoveryOptionSchema = z.object({
  id: z.string(),
  doctorId: z.string(),
  doctorName: z.string(),
  startUtc: z.string(),
  endUtc: z.string(),
  block: z.enum(["am", "pm"]),
  day: z.string(),
  score: z.number(),
  dots: z.number().int().min(1).max(5),
  chips: z.array(z.object({ label: z.string(), pts: z.number() })),
  rank: z.number().int(),
});
export type RecoveryOption = z.infer<typeof RecoveryOptionSchema>;

export const REPLY_INTENTS = [
  "confirm",
  "cancel",
  "accept_offer",
  "reject_offer",
  "counter_proposal",
  "question",
  "needs_human",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export const ReplyInterpretationSchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  /** Optional structured constraint extracted from a counter-proposal. */
  constraint: z
    .object({
      afterTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      beforeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      dayPart: z.enum(["am", "pm"]).optional(),
      preferredDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .optional(),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(300),
});
export type ReplyInterpretation = z.infer<typeof ReplyInterpretationSchema>;

export interface RiskFactor {
  label: string;
  pts: number;
}
export interface RiskResult {
  score: number;
  band: "low" | "medium" | "high";
  factors: RiskFactor[];
}

export type CaseState =
  | "open"
  | "assessing"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "resolving"
  | "resolved"
  | "escalated";

export type Severity = "low" | "medium" | "high" | "critical";

/** Payload stored on a reschedule recommendation. */
export interface ReschedulePayload {
  appointmentId: string;
  patientName: string;
  type: ApptType;
  from: { doctorId: string; doctorName: string; startUtc: string; endUtc: string };
  chosenOptionId: string;
  options: RecoveryOption[];
  rationale: string;
  draft?: { subject: string; body: string };
  replanOf?: string;
  replanNote?: string;
}

export interface WaitlistFillPayload {
  slot: Slot & { doctorName: string };
  vacatedAppointmentId: string;
  candidates: Array<{
    waitlistId: string;
    patientId: string;
    patientName: string;
    score: number;
    dots: number;
    chips: Array<{ label: string; pts: number }>;
    rank: number;
  }>;
  chosenWaitlistId: string;
  rationale: string;
  draft?: { subject: string; body: string };
}

export interface NudgePayload {
  appointmentId: string;
  patientName: string;
  when: string;
  riskScore?: number;
  riskFactors?: RiskFactor[];
  rationale: string;
  draft?: { subject: string; body: string };
}
