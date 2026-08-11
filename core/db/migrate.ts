import { sqlite } from "./client";

/**
 * Hand-written DDL kept 1:1 with core/db/schema.ts. A plain SQL migration keeps
 * setup zero-dependency and deterministic (no drizzle-kit at runtime).
 */
const DDL = `
CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  open_time TEXT NOT NULL DEFAULT '08:00', close_time TEXT NOT NULL DEFAULT '17:00',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, name TEXT NOT NULL, specialty TEXT NOT NULL,
  email TEXT, color TEXT NOT NULL DEFAULT '#5B2FCE', initials TEXT NOT NULL DEFAULT 'DR',
  calendar_id TEXT, status TEXT NOT NULL DEFAULT 'available',
  unavailable_dates TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS doctor_rules (
  doctor_id TEXT PRIMARY KEY, rules TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  phone TEXT, pref_day_part TEXT NOT NULL DEFAULT 'any', preferred_doctor_id TEXT,
  staff_priority INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance_history (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, doctor_id TEXT NOT NULL, patient_id TEXT NOT NULL,
  type TEXT NOT NULL, start_utc TEXT NOT NULL, end_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked', calendar_event_id TEXT, superseded_by TEXT,
  needs_callback INTEGER NOT NULL DEFAULT 0,
  booked_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'seed', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appts_doctor_start ON appointments (doctor_id, start_utc);
CREATE INDEX IF NOT EXISTS idx_appts_patient ON appointments (patient_id);
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, patient_id TEXT NOT NULL, doctor_id TEXT,
  type TEXT NOT NULL, day_part TEXT NOT NULL DEFAULT 'any', added_at TEXT NOT NULL,
  staff_priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'waiting'
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT, created_at TEXT NOT NULL, processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status, created_at);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL, type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium', state TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL, opened_by_event TEXT, meta TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS case_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, actor TEXT NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, refs TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_case ON case_timeline (case_id, id);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, case_id TEXT, agent TEXT NOT NULL, mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', input TEXT, output TEXT,
  steps INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0,
  tool_errors INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER, error TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, appointment_id TEXT, patient_id TEXT,
  kind TEXT NOT NULL, payload TEXT NOT NULL, explanation TEXT, score REAL,
  status TEXT NOT NULL DEFAULT 'proposed', decided_by TEXT, decision_reason TEXT,
  decided_at TEXT, executed_at TEXT, superseded_by TEXT, outcome TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recs_case ON recommendations (case_id, status);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, case_id TEXT, recommendation_id TEXT, appointment_id TEXT,
  patient_id TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'email', direction TEXT NOT NULL,
  subject TEXT, body TEXT NOT NULL, status TEXT NOT NULL, provider TEXT,
  provider_draft_id TEXT, provider_message_id TEXT, thread_id TEXT,
  intent TEXT, intent_detail TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_case ON messages (case_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, ref_type TEXT, ref_id TEXT, case_id TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS negotiations (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
  patient_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  turn INTEGER NOT NULL DEFAULT 0, constraint_set TEXT,
  offered_slots TEXT NOT NULL DEFAULT '[]', last_action TEXT, last_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nego_case_appt ON negotiations (case_id, appointment_id);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY, tokens TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_status (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sim_calendar_events (
  id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, summary TEXT NOT NULL,
  start_utc TEXT NOT NULL, end_utc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sim_mail (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, thread_id TEXT, to_addr TEXT, from_addr TEXT,
  subject TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

const TABLES = [
  "clinics",
  "doctors",
  "doctor_rules",
  "patients",
  "attendance_history",
  "appointments",
  "waitlist",
  "events",
  "cases",
  "case_timeline",
  "agent_runs",
  "recommendations",
  "negotiations",
  "messages",
  "audit_log",
  "oauth_tokens",
  "system_status",
  "sim_calendar_events",
  "sim_mail",
];

export function ensureSchema(): void {
  sqlite.exec(DDL);
}

/** Delete all rows (keeps schema). Used by demo reset, seeding, and tests. */
export function wipeData(opts: { keepOauth?: boolean } = {}): void {
  ensureSchema();
  const tx = sqlite.transaction(() => {
    for (const t of TABLES) {
      if (opts.keepOauth && t === "oauth_tokens") continue;
      sqlite.prepare(`DELETE FROM ${t}`).run();
    }
    sqlite
      .prepare(
        `DELETE FROM sqlite_sequence WHERE name IN ('case_timeline','audit_log')`,
      )
      .run();
  });
  tx();
}
