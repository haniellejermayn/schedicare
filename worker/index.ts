/**
 * SchediCare worker process. Run alongside `next dev`:
 *   npm run worker
 * Polls the event queue (~800ms), routes events sequentially, runs the daily
 * sweep once per demo day, and — when live Gmail is connected — polls known
 * threads for real patient replies.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { ensureSchema } from "@/core/db/migrate";
import { env } from "@/core/env";
import { audit } from "@/core/audit";
import { claimNextEvent, completeEvent, failEvent, enqueueEvent } from "./queue";
import { routeEvent, bootBanner } from "./router";
import { runDailySweep } from "./sweep";
import { pickMailProvider } from "@/integrations/factory";

const POLL_MS = 800;
const GMAIL_POLL_MS = 20_000;
let stopping = false;

async function loop() {
  while (!stopping) {
    const ev = claimNextEvent();
    if (!ev) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    try {
      console.log(`[worker] event ${ev.type} (${ev.id})`);
      await routeEvent(ev);
      completeEvent(ev.id);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      console.error(`[worker] event ${ev.type} failed: ${msg}`);
      audit({ actor: "worker", action: "event.error", detail: { type: ev.type, id: ev.id, error: msg, attempt: ev.attempts } });
      const retry = ev.attempts < 2;
      failEvent(ev.id, retry);
      if (!retry && (ev.payload as any)?.caseId) {
        const { escalateCase } = await import("@/core/cases");
        try {
          escalateCase((ev.payload as any).caseId, "worker", `Event ${ev.type} failed twice: ${msg}`);
        } catch { /* case may not exist */ }
      }
    }
  }
}

/** Live-Gmail inbound polling: known threads only, seen-message dedupe. */
async function pollGmailInbound() {
  if (env().MAIL_PROVIDER !== "gmail") return;
  while (!stopping) {
    await new Promise((r) => setTimeout(r, GMAIL_POLL_MS));
    try {
      const pick = pickMailProvider();
      if (!pick.live) continue;
      const outbound = db
        .select()
        .from(schema.messages)
        .where(and(eq(schema.messages.direction, "outbound"), eq(schema.messages.status, "sent"), isNotNull(schema.messages.threadId)))
        .all();
      const threads = [...new Set(outbound.map((m) => m.threadId!))];
      if (threads.length === 0) continue;
      const seen = db
        .select({ id: schema.messages.providerMessageId })
        .from(schema.messages)
        .where(isNotNull(schema.messages.providerMessageId))
        .all()
        .map((r) => r.id!)
        .filter(Boolean);
      const inbound = await pick.provider.pollReplies(threads, seen);
      for (const mail of inbound) {
        const parent = outbound.find((m) => m.threadId === mail.threadId);
        if (!parent) continue;
        const row = db
          .insert(schema.messages)
          .values({
            caseId: parent.caseId,
            recommendationId: parent.recommendationId,
            appointmentId: parent.appointmentId,
            patientId: parent.patientId,
            direction: "inbound",
            subject: `Re: ${parent.subject ?? ""}`,
            body: mail.body,
            status: "received",
            provider: "gmail",
            providerMessageId: mail.providerMessageId,
            threadId: mail.threadId,
            createdAt: new Date().toISOString(),
          })
          .returning()
          .get();
        enqueueEvent("patient_reply", { messageId: row.id });
      }
    } catch (e) {
      console.error(`[worker] gmail poll error: ${String((e as Error).message).slice(0, 200)}`);
    }
  }
}

async function main() {
  ensureSchema();
  console.log(bootBanner());
  audit({ actor: "worker", action: "worker.started", detail: { pid: process.pid } });
  await runDailySweep().catch((e) => console.error(`[worker] sweep failed: ${e?.message ?? e}`));
  void pollGmailInbound();
  await loop();
}

process.on("SIGINT", () => {
  stopping = true;
  setTimeout(() => process.exit(0), 300);
});
process.on("SIGTERM", () => {
  stopping = true;
  setTimeout(() => process.exit(0), 300);
});

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
