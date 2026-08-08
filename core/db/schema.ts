import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { id as newId } from "../ids";

const pk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => newId());
const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

// ---------------------------------------------------------------------------
// Clinic domain
// ---------------------------------------------------------------------------

export const clinics = sqliteTable("clinics", {
  id: pk(),
  name: text("name").notNull(),
  address: text("address"),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  openTime: text("open_time").notNull().default("08:00"),
  closeTime: text("close_time").notNull().default("17:00"),
  createdAt: createdAt(),
});

export const doctors = sqliteTable("doctors", {
  id: pk(),
  clinicId: text("clinic_id").notNull(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  email: text("email"),
  color: text("color").notNull().default("#5B2FCE"),
  initials: text("initials").notNull().default("DR"),
  /** Google calendar id (or simulated calendar key). */
  calendarId: text("calendar_id"),
  status: text("status", { enum: ["available", "unavailable"] })
    .notNull()
    .default("available"),
  /** JSON array of yyyy-MM-dd dates the doctor has marked unavailable. */
  unavailableDates: text("unavailable_dates", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: createdAt(),
});

export const doctorRules = sqliteTable("doctor_rules", {
  doctorId: text("doctor_id").primaryKey(),
  rules: text("rules", { mode: "json" }).notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const patients = sqliteTable("patients", {
  id: pk(),
  clinicId: text("clinic_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  prefDayPart: text("pref_day_part", { enum: ["am", "pm", "any"] })
    .notNull()
    .default("any"),
  preferredDoctorId: text("preferred_doctor_id"),
  /** 0 = normal, 1 = elevated, 2 = high (staff-entered, operational only). */
  staffPriority: integer("staff_priority").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const attendanceHistory = sqliteTable("attendance_history", {
  id: pk(),
  patientId: text("patient_id").notNull(),
  kind: text("kind", {
    enum: ["attended", "no_show", "late_cancel", "cancelled_ok"],
  }).notNull(),
  at: text("at").notNull(),
});

export const appointments = sqliteTable("appointments", {
  id: pk(),
  clinicId: text("clinic_id").notNull(),
  doctorId: text("doctor_id").notNull(),
  patientId: text("patient_id").notNull(),
  type: text("type", { enum: ["routine", "follow_up", "urgent"] }).notNull(),
  startUtc: text("start_utc").notNull(),
  endUtc: text("end_utc").notNull(),
  /** "booked" means booked-but-unconfirmed. */
  status: text("status", {
    enum: [
      "booked",
      "confirmed",
      "completed",
      "no_show",
      "cancelled_by_patient",
      "cancelled_by_doctor",
      "superseded",
    ],
  })
    .notNull()
    .default("booked"),
  calendarEventId: text("calendar_event_id"),
  supersededBy: text("superseded_by"),
  /** Flag set when the patient declined all offers and asked for a call. */
  needsCallback: integer("needs_callback", { mode: "boolean" })
    .notNull()
    .default(false),
  bookedAt: text("booked_at").notNull(),
  source: text("source").notNull().default("seed"),
  createdAt: createdAt(),
});

export const waitlist = sqliteTable("waitlist", {
  id: pk(),
  clinicId: text("clinic_id").notNull(),
  patientId: text("patient_id").notNull(),
  doctorId: text("doctor_id"),
  type: text("type", { enum: ["routine", "follow_up", "urgent"] }).notNull(),
  dayPart: text("day_part", { enum: ["am", "pm", "any"] })
    .notNull()
    .default("any"),
  addedAt: text("added_at").notNull(),
  staffPriority: integer("staff_priority").notNull().default(0),
  status: text("status", {
    enum: ["waiting", "offered", "scheduled", "removed"],
  })
    .notNull()
    .default("waiting"),
});

// ---------------------------------------------------------------------------
// Coordination layer
// ---------------------------------------------------------------------------

export const events = sqliteTable("events", {
  id: pk(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  status: text("status", { enum: ["pending", "processing", "done", "failed"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  /** ISO timestamp (demo clock) before which the worker will not claim the event. */
  runAfter: text("run_after"),
  createdAt: createdAt(),
  processedAt: text("processed_at"),
});

export const cases = sqliteTable("cases", {
  id: pk(),
  clinicId: text("clinic_id").notNull(),
  type: text("type", {
    enum: [
      "doctor_emergency",
      "patient_cancellation",
      "confirmation",
      "no_show_risk",
      "slot_recovery",
    ],
  }).notNull(),
  severity: text("severity", { enum: ["low", "medium", "high", "critical"] })
    .notNull()
    .default("medium"),
  state: text("state", {
    enum: [
      "open",
      "assessing",
      "planning",
      "awaiting_approval",
      "executing",
      "resolving",
      "resolved",
      "escalated",
    ],
  })
    .notNull()
    .default("open"),
  title: text("title").notNull(),
  openedByEvent: text("opened_by_event"),
  meta: text("meta", { mode: "json" }),
  createdAt: createdAt(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  resolvedAt: text("resolved_at"),
});

export const caseTimeline = sqliteTable("case_timeline", {
  /** Integer autoincrement so the SSE feed can cursor on it. */
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: text("case_id").notNull(),
  actor: text("actor").notNull(),
  kind: text("kind", {
    enum: [
      "status",
      "thought",
      "tool_call",
      "tool_result",
      "transition",
      "recommendation",
      "decision",
      "effect",
      "message",
      "escalation",
      "error",
    ],
  }).notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  refs: text("refs", { mode: "json" }),
  at: text("at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: pk(),
  caseId: text("case_id"),
  agent: text("agent").notNull(),
  mode: text("mode", { enum: ["live", "fallback"] }).notNull(),
  status: text("status", { enum: ["running", "ok", "fallback_ok", "error"] })
    .notNull()
    .default("running"),
  input: text("input", { mode: "json" }),
  output: text("output", { mode: "json" }),
  steps: integer("steps").notNull().default(0),
  toolCalls: integer("tool_calls").notNull().default(0),
  toolErrors: integer("tool_errors").notNull().default(0),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: createdAt(),
});

export const recommendations = sqliteTable("recommendations", {
  id: pk(),
  caseId: text("case_id").notNull(),
  appointmentId: text("appointment_id"),
  patientId: text("patient_id"),
  kind: text("kind", {
    enum: [
      "reschedule",
      "waitlist_fill",
      "confirm_nudge",
      "preventive",
      "callback",
    ],
  }).notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  /** "Why?" chips: [{ label, pts }]. */
  explanation: text("explanation", { mode: "json" }),
  score: real("score"),
  status: text("status", {
    enum: [
      "proposed",
      "approved",
      "modified",
      "rejected",
      "executed",
      "failed",
      "superseded",
    ],
  })
    .notNull()
    .default("proposed"),
  decidedBy: text("decided_by"),
  decisionReason: text("decision_reason"),
  decidedAt: text("decided_at"),
  executedAt: text("executed_at"),
  supersededBy: text("superseded_by"),
  /** Post-execution patient outcome: accepted | declined | countered | pending. */
  outcome: text("outcome"),
  createdAt: createdAt(),
});

export const messages = sqliteTable("messages", {
  id: pk(),
  caseId: text("case_id"),
  recommendationId: text("recommendation_id"),
  appointmentId: text("appointment_id"),
  patientId: text("patient_id").notNull(),
  channel: text("channel", { enum: ["email"] })
    .notNull()
    .default("email"),
  direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status", {
    enum: [
      "draft",
      "approved",
      "draft_created",
      "sent",
      "received",
      "interpreted",
    ],
  }).notNull(),
  provider: text("provider"),
  providerDraftId: text("provider_draft_id"),
  providerMessageId: text("provider_message_id"),
  threadId: text("thread_id"),
  intent: text("intent"),
  intentDetail: text("intent_detail", { mode: "json" }),
  createdAt: createdAt(),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: text("at").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  caseId: text("case_id"),
  detail: text("detail", { mode: "json" }),
});

// ---------------------------------------------------------------------------
// Integration state
// ---------------------------------------------------------------------------

export const oauthTokens = sqliteTable("oauth_tokens", {
  provider: text("provider").primaryKey(),
  tokens: text("tokens", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const systemStatus = sqliteTable("system_status", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Backing store for the simulated Google Calendar provider. */
export const simCalendarEvents = sqliteTable("sim_calendar_events", {
  id: pk(),
  calendarId: text("calendar_id").notNull(),
  summary: text("summary").notNull(),
  startUtc: text("start_utc").notNull(),
  endUtc: text("end_utc").notNull(),
  status: text("status", { enum: ["confirmed", "cancelled"] })
    .notNull()
    .default("confirmed"),
  createdAt: createdAt(),
});

/** Backing store for the simulated Gmail provider. */
export const simMail = sqliteTable("sim_mail", {
  id: pk(),
  kind: text("kind", { enum: ["draft", "sent", "inbound"] }).notNull(),
  threadId: text("thread_id"),
  toAddr: text("to_addr"),
  fromAddr: text("from_addr"),
  subject: text("subject"),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/** Multi-turn scheduling negotiations — one per (case, appointment). DB is
 * the source of truth; turns are counted and capped here, never in a model. */
export const negotiations = sqliteTable("negotiations", {
  id: pk(),
  caseId: text("case_id").notNull(),
  appointmentId: text("appointment_id").notNull(),
  patientId: text("patient_id").notNull(),
  status: text("status", { enum: ["active", "resolved", "escalated"] })
    .notNull()
    .default("active"),
  /** Patient-facing rounds so far (offers + clarifications). */
  turn: integer("turn").notNull().default(0),
  /** Accumulated merged SchedulingConstraintSet. */
  constraintSet: text("constraint_set", { mode: "json" }),
  /** History: [{doctorId, startUtc, label, offeredAt, outcome, note?}] */
  offeredSlots: text("offered_slots", { mode: "json" })
    .$type<any[]>()
    .notNull()
    .default([]),
  lastAction: text("last_action"),
  lastReason: text("last_reason"),
  createdAt: createdAt(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
