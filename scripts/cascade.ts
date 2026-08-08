/** npm run demo:cascade — trigger the flagship Dr. Santos emergency from the CLI. */
import "@/eval/loadEnv"; // .env.local / .env — must be the FIRST import
import { ensureSchema } from "@/core/db/migrate";
import { enqueueEvent } from "@/worker/queue";
import { SANTOS, DEMO_DAY } from "@/sim/seed";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";

ensureSchema();
const doctor = db
  .select()
  .from(schema.doctors)
  .where(eq(schema.doctors.id, SANTOS))
  .get();
if (!doctor) {
  console.error("[cascade] Seed data missing — run `npm run setup` first.");
  process.exit(1);
}
const dates = new Set([...(doctor.unavailableDates ?? []), DEMO_DAY]);
db.update(schema.doctors)
  .set({ status: "unavailable", unavailableDates: [...dates] })
  .where(eq(schema.doctors.id, SANTOS))
  .run();
audit({
  actor: "staff",
  action: "doctor.marked_unavailable",
  refType: "doctor",
  refId: SANTOS,
  detail: { date: DEMO_DAY, via: "cli" },
});
const id = enqueueEvent("doctor_emergency", {
  doctorId: SANTOS,
  date: DEMO_DAY,
  reason: "Family emergency — out for the day",
});
console.log(
  `[cascade] Dr. Santos marked unavailable for ${DEMO_DAY}; doctor_emergency event ${id} queued.`,
);
console.log(
  "[cascade] Watch it live in the Staff Ops Center: http://localhost:3000/ops",
);
