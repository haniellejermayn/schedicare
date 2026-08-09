import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";
import { timeline } from "@/core/timeline";
import { getCase } from "@/core/cases";
import { bannedContentLint, type DraftPurpose } from "@/agents/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PURPOSE: Record<string, DraftPurpose> = {
  reschedule: "reschedule_offer",
  waitlist_fill: "waitlist_offer",
  confirm_nudge: "confirm_nudge",
  preventive: "preventive",
};

/**
 * Staff edit of the drafted patient message, BEFORE approval. Staff-authored
 * wording is human content — the approval gate still applies, and the same
 * clinical-content lint that guards model drafts guards edits too (the
 * scheduler never carries medical guidance, whoever wrote it). Subjects stay
 * standardized and are not editable.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  boot();
  const b = await body<{ body: string }>(req);
  const text = (b.body ?? "").trim();
  if (text.length < 10) return err("message body is too short");
  const rec = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, params.id))
    .get();
  if (!rec) return err("recommendation not found", 404);
  if (rec.status !== "proposed")
    return err(`recommendation already ${rec.status}`, 409);
  const c = getCase(rec.caseId);
  if (c.state !== "awaiting_approval" && c.state !== "escalated")
    return err(
      `case is ${c.state} — the message can only be edited while a proposal is pending`,
      409,
    );
  const payload = rec.payload as any;
  if (!payload.draft) return err("this suggestion has no message to edit", 422);

  const purpose = PURPOSE[rec.kind] ?? "reschedule_offer";
  const probe = {
    patientId: payload.patientId ?? "patient",
    patientName: payload.patientName ?? "Patient",
    appointmentId: payload.appointmentId,
    context: {},
  } as any;
  const { warnings } = bannedContentLint(purpose, [probe], {
    drafts: [
      {
        patientId: probe.patientId,
        appointmentId: payload.appointmentId,
        subject: payload.draft.subject,
        body: text,
      },
    ],
  } as any);
  if (warnings.length > 0)
    return err(
      "that edit contains clinical language, which patient messages may never include — please reword",
      422,
    );

  db.update(schema.recommendations)
    .set({
      payload: {
        ...payload,
        draft: { ...payload.draft, body: text },
        draftEditedByStaff: true,
      },
    })
    .where(eq(schema.recommendations.id, rec.id))
    .run();
  timeline(
    rec.caseId,
    "staff",
    "decision",
    `Edited the message to ${payload.patientName ?? "the patient"}`,
    undefined,
    { recommendationId: rec.id },
  );
  audit({
    actor: "staff",
    action: "recommendation.draft_edited",
    refType: "recommendation",
    refId: rec.id,
    caseId: rec.caseId,
  });
  return json({ ok: true });
}
