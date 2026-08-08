import "@/eval/loadEnv";
import { db, schema } from "@/core/db/client";
import { eq, inArray } from "drizzle-orm";

const c = db
  .select()
  .from(schema.cases)
  .all()
  .find((x) => x.state === "resolving" || x.state === "escalated");
if (!c) {
  console.log("no resolving/escalated case");
  process.exit(0);
}
console.log(`case ${c.id} — ${c.state} — ${c.title}`);
const recs = db
  .select()
  .from(schema.recommendations)
  .where(eq(schema.recommendations.caseId, c.id))
  .all();
console.table(
  recs.map((r) => ({
    kind: r.kind,
    status: r.status,
    outcome: r.outcome,
    supersededBy: r.supersededBy ? "yes" : "",
    patient: (r.payload as any)?.patientName ?? "",
    blocking:
      r.status === "failed" ||
      (!["called", "handled", "released"].includes(r.outcome ?? "") &&
        (r.outcome === "needs_human" ||
          r.outcome === "declined" ||
          (r.status === "executed" &&
            (r.outcome === "pending" || r.outcome === "sent"))))
        ? "◄ BLOCKS"
        : "",
  })),
);
const holds = recs
  .map((r) => (r.payload as any)?.createdAppointmentId)
  .filter(Boolean);
if (holds.length)
  console.table(
    db
      .select()
      .from(schema.appointments)
      .where(inArray(schema.appointments.id, holds))
      .all()
      .map((a) => ({
        id: a.id,
        status: a.status,
        blocking: a.status === "booked" ? "◄ BLOCKS" : "",
      })),
  );
