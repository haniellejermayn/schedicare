import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { asc, eq } from "drizzle-orm";
import { caseScoreboard } from "@/lib/metrics";
import { latestReplyOnly } from "@/core/messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  boot();
  const c = db.select().from(schema.cases).where(eq(schema.cases.id, params.id)).get();
  if (!c) return err("case not found", 404);
  const recommendations = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.caseId, c.id))
    .orderBy(asc(schema.recommendations.createdAt))
    .all();
  const messages = db.select().from(schema.messages).where(eq(schema.messages.caseId, c.id)).orderBy(asc(schema.messages.createdAt), asc(schema.messages.id)).all();
  const patients = db.select().from(schema.patients).all();
  const appointments = db.select().from(schema.appointments).all();
  const patientIds = [...new Set([
    ...recommendations.map((r) => r.patientId).filter((id): id is string => !!id),
    ...messages.map((m) => m.patientId),
  ])];
  const conversations = patientIds.map((patientId) => {
    const patient = patients.find((p) => p.id === patientId);
    const patientRecommendations = recommendations.filter((r) => r.patientId === patientId);
    const currentRecommendation = [...patientRecommendations]
      .reverse()
      .find((r) => r.outcome !== "superseded");
    const payload = (currentRecommendation?.payload as any) ?? {};
    const activeHold = appointments.find(
      (a) =>
        a.status === "booked" &&
        a.source === "schedicare" &&
        a.id === (payload.createdAppointmentId ?? payload.appointmentId),
    );
    const currentAppointment = appointments.find(
      (a) => a.id === (payload.createdAppointmentId ?? payload.appointmentId),
    );
    const manuallyResolved = ["called", "handled", "released"].includes(currentRecommendation?.outcome ?? "");
    const needsManualAction =
      !!currentRecommendation &&
      !manuallyResolved &&
      (currentRecommendation.status === "rejected" ||
        currentRecommendation.status === "failed" ||
        ["needs_human", "declined", "pending", "sent"].includes(currentRecommendation.outcome ?? ""));
    return {
      patientId,
      patientName: patient?.name ?? (patientRecommendations.at(-1)?.payload as any)?.patientName ?? patientId,
      recommendations: patientRecommendations,
      currentRecommendationId: currentRecommendation?.id ?? null,
      currentAppointment: currentAppointment ?? null,
      activeHold: activeHold ?? null,
      actions: {
        followUp: needsManualAction || !!activeHold,
      },
      messages: messages
        .filter((m) => m.patientId === patientId)
        .map((m) => ({
          ...m,
          body: m.direction === "inbound" ? latestReplyOnly(m.body) : m.body,
        })),
    };
  });
  const timeline = db.select().from(schema.caseTimeline).where(eq(schema.caseTimeline.caseId, c.id)).orderBy(asc(schema.caseTimeline.id)).all();
  return json({ case: c, recommendations, messages, conversations, timeline, scoreboard: caseScoreboard(c.id) });
}
