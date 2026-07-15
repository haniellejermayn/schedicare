import { db, schema } from "./db/client";
import { eq } from "drizzle-orm";
import { RuleSetSchema, type RuleSet } from "./types";

/** Dr. Elena Santos — follow-ups in the morning, routine consults after lunch. */
export const SANTOS_RULES: RuleSet = {
  workDays: [1, 2, 3, 4, 5, 6],
  windows: {
    follow_up: ["08:00-12:00"],
    routine: ["13:00-17:00"],
    urgent: ["08:00-12:00", "13:00-17:00"],
  },
  durationMin: { routine: 30, follow_up: 20, urgent: 30 },
  bufferAfterMin: 10,
  maxPerDay: 14,
  maxPerBlock: { am: 8, pm: 8 },
};

/** Dr. Marco Reyes — consult-heavy mornings, follow-ups only after lunch, longer buffers. */
export const REYES_RULES: RuleSet = {
  workDays: [1, 2, 3, 4, 5],
  windows: {
    routine: ["08:00-12:00", "13:00-16:30"],
    follow_up: ["13:00-16:30"],
    urgent: ["08:00-12:00", "13:00-16:30"],
  },
  durationMin: { routine: 30, follow_up: 20, urgent: 30 },
  bufferAfterMin: 15,
  maxPerDay: 12,
  maxPerBlock: { am: 6, pm: 6 },
};

export function getRules(doctorId: string): RuleSet {
  const row = db.select().from(schema.doctorRules).where(eq(schema.doctorRules.doctorId, doctorId)).get();
  if (!row) throw new Error(`No rules for doctor ${doctorId}`);
  return RuleSetSchema.parse(row.rules);
}

export function setRules(doctorId: string, rules: RuleSet): RuleSet {
  const parsed = RuleSetSchema.parse(rules);
  db.insert(schema.doctorRules)
    .values({ doctorId, rules: parsed, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.doctorRules.doctorId,
      set: { rules: parsed, updatedAt: new Date().toISOString() },
    })
    .run();
  return parsed;
}
