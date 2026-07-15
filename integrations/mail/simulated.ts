import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { id } from "@/core/ids";
import type { InboundMail, MailDraft, MailProvider } from "./types";

/** Deterministic Gmail stand-in over the sim_mail table. */
export class SimulatedMailProvider implements MailProvider {
  readonly name = "simulated" as const;

  async createDraft(d: MailDraft) {
    const threadId = d.threadId ?? `simthread_${id(8)}`;
    const row = db
      .insert(schema.simMail)
      .values({
        id: `simdraft_${id(8)}`,
        kind: "draft",
        threadId,
        toAddr: d.to,
        fromAddr: "care@riverside-clinic.example",
        subject: d.subject,
        body: d.body,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    return { draftId: row.id, threadId };
  }

  async updateDraft(draftId: string, d: MailDraft) {
    db.update(schema.simMail)
      .set({ toAddr: d.to, subject: d.subject, body: d.body })
      .where(eq(schema.simMail.id, draftId))
      .run();
    return { draftId };
  }

  async sendDraft(draftId: string) {
    const draft = db.select().from(schema.simMail).where(eq(schema.simMail.id, draftId)).get();
    if (!draft) throw new Error(`simulated draft ${draftId} not found`);
    db.update(schema.simMail).set({ kind: "sent" }).where(eq(schema.simMail.id, draftId)).run();
    return { messageId: draft.id.replace("simdraft_", "simmsg_"), threadId: draft.threadId ?? undefined };
  }

  async pollReplies(threadIds: string[], seenMessageIds: string[]): Promise<InboundMail[]> {
    if (threadIds.length === 0) return [];
    const rows = db
      .select()
      .from(schema.simMail)
      .where(inArray(schema.simMail.threadId, threadIds))
      .all()
      .filter((r) => r.kind === "inbound" && !seenMessageIds.includes(r.id));
    return rows.map((r) => ({
      providerMessageId: r.id,
      threadId: r.threadId ?? "",
      from: r.fromAddr ?? "",
      body: r.body,
      receivedAt: r.createdAt,
    }));
  }

  /** Test/simulator helper: drop an inbound reply into a thread. */
  async injectInbound(threadId: string, from: string, body: string) {
    const row = db
      .insert(schema.simMail)
      .values({
        id: `siminb_${id(8)}`,
        kind: "inbound",
        threadId,
        toAddr: "care@riverside-clinic.example",
        fromAddr: from,
        subject: "Re: your appointment",
        body,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    return row.id;
  }
}
