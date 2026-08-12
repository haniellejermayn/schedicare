import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEMO_PATIENTS = [
  { id: "pat_camille", name: "Camille" },
  { id: "pat_miguel", name: "Miguel" },
  { id: "pat_grace", name: "Grace" },
] as const;

type Tone = "neutral" | "accent" | "warn" | "ok" | "bad";

function publicStatus(args: {
  rec: typeof schema.recommendations.$inferSelect | undefined;
  caseRow: typeof schema.cases.$inferSelect | undefined;
  pendingConstraintReview: boolean;
  originalMoved: boolean;
}): { label: string; detail: string; tone: Tone; settled: boolean } {
  const { rec, caseRow, pendingConstraintReview, originalMoved } = args;
  if (pendingConstraintReview)
    return {
      label: "Needs staff review",
      detail: "The patient's requested times are being checked",
      tone: "warn",
      settled: false,
    };
  if (!rec) {
    if (originalMoved || caseRow)
      return {
        label: "Finding a new time",
        detail: "The clinic is checking valid openings",
        tone: "accent",
        settled: false,
      };
    return {
      label: "Ready",
      detail: "Waiting for the demo disruption",
      tone: "neutral",
      settled: false,
    };
  }

  if (rec.outcome === "accepted")
    return {
      label: "Confirmed",
      detail: "New appointment time accepted",
      tone: "ok",
      settled: true,
    };
  if (rec.outcome === "handled")
    return {
      label: "Offer declined",
      detail: "Staff follow-up completed",
      tone: "bad",
      settled: true,
    };
  if (rec.outcome === "released")
    return {
      label: "Offer declined",
      detail: "Temporary hold released by staff",
      tone: "bad",
      settled: true,
    };
  if (rec.outcome === "called")
    return {
      label: "Handled by staff",
      detail: "Follow-up call completed",
      tone: "ok",
      settled: true,
    };
  if (rec.outcome === "declined")
    return {
      label: "Offer declined",
      detail: "Staff follow-up is needed",
      tone: "bad",
      settled: false,
    };
  if (rec.outcome === "needs_human" || rec.status === "failed")
    return {
      label: "Needs staff help",
      detail: "Automation stopped for a person to review",
      tone: "warn",
      settled: false,
    };
  if (rec.status === "rejected")
    return {
      label: "Staff will follow up",
      detail: "The suggested offer was not sent",
      tone: "warn",
      settled: false,
    };
  if (rec.status === "proposed")
    return {
      label: "Needs staff approval",
      detail: "A safe replacement option is ready",
      tone: "warn",
      settled: false,
    };
  if (rec.status === "approved" || rec.status === "modified")
    return {
      label: "Booking new time",
      detail: "The approved offer is being prepared",
      tone: "accent",
      settled: false,
    };
  if (rec.outcome === "superseded")
    return {
      label: "Finding another time",
      detail: "The patient requested a different option",
      tone: "accent",
      settled: false,
    };
  return {
    label: "Waiting for patient",
    detail: "The clinic sent a replacement offer",
    tone: "accent",
    settled: false,
  };
}

export async function GET() {
  boot();
  const patientIds = new Set(DEMO_PATIENTS.map((patient) => patient.id));
  const cases = db
    .select()
    .from(schema.cases)
    .all()
    .filter((caseRow) => caseRow.type === "doctor_emergency");
  const caseById = new Map(cases.map((caseRow) => [caseRow.id, caseRow]));
  const recommendations = db
    .select()
    .from(schema.recommendations)
    .all()
    .filter(
      (rec) =>
        !!rec.patientId &&
        patientIds.has(rec.patientId as (typeof DEMO_PATIENTS)[number]["id"]) &&
        caseById.has(rec.caseId),
    );
  const appointments = db.select().from(schema.appointments).all();

  const patients = DEMO_PATIENTS.map((patient) => {
    const patientRecommendations = recommendations
      .filter((rec) => rec.patientId === patient.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const rec = patientRecommendations.find(
      (candidate) =>
        candidate.outcome !== "superseded" && !candidate.supersededBy,
    );
    const caseRow = rec
      ? caseById.get(rec.caseId)
      : [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const pendingConstraintReview = Object.values(
      ((caseRow?.meta as any)?.constraintsByAppt ?? {}) as Record<string, any>,
    ).some(
      (entry: any) =>
        entry.patientId === patient.id &&
        entry.disposition === "constraint_review" &&
        !entry.reviewedAt,
    );
    const status = publicStatus({
      rec,
      caseRow,
      pendingConstraintReview,
      originalMoved: appointments.some(
        (appointment) =>
          appointment.patientId === patient.id &&
          appointment.status === "superseded",
      ),
    });
    return {
      id: patient.id,
      name: patient.name,
      ...status,
      updatedAt:
        rec?.executedAt ??
        rec?.decidedAt ??
        rec?.createdAt ??
        caseRow?.updatedAt ??
        null,
    };
  });

  return json({
    patients,
    settled: patients.filter((patient) => patient.settled).length,
    total: patients.length,
    generatedAt: new Date().toISOString(),
  });
}

