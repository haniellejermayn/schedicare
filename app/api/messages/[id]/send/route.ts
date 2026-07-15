import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";
import { timeline } from "@/core/timeline";
import { pickMailProvider, markMailHealthy, markMailUnhealthy } from "@/integrations/factory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live Gmail keeps agent-drafted messages as drafts; a staff member explicitly
 * sends each one here. (Simulated mail auto-sends at execution and never hits
 * this endpoint.)
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  boot();
  const msg = db.select().from(schema.messages).where(eq(schema.messages.id, params.id)).get();
  if (!msg) return err("message not found", 404);
  if (msg.direction !== "outbound") return err("only outbound drafts can be sent", 409);
  if (msg.status === "sent") return json({ ok: true, alreadySent: true });
  if (msg.status !== "draft_created") return err(`message is ${msg.status}, not draft_created`, 409);
  if (!msg.providerDraftId) return err("message has no provider draft id", 409);

  const pick = pickMailProvider();
  try {
    const sent = await pick.provider.sendDraft(msg.providerDraftId);
    if (pick.live) markMailHealthy();
    db.update(schema.messages)
      .set({ status: "sent", providerMessageId: sent.messageId ?? null, threadId: sent.threadId ?? msg.threadId })
      .where(eq(schema.messages.id, msg.id))
      .run();
    if (msg.caseId) timeline(msg.caseId, "staff", "effect", `${pick.live ? "Gmail" : "Simulated mail"}: message sent`, msg.subject ?? undefined, { messageId: msg.id });
    audit({ actor: "staff", action: "mail.sent", refType: "message", refId: msg.id, caseId: msg.caseId ?? undefined });
    return json({ ok: true });
  } catch (e) {
    if (pick.live) markMailUnhealthy(e);
    return err(`send failed: ${String((e as Error).message).slice(0, 200)}`, 502);
  }
}
