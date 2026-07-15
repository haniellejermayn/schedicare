import { db, schema } from "./db/client";
import { demoNowIso } from "./clock";

/** Append-only audit trail. Every trigger, agent action, decision, and external effect lands here. */
export function audit(entry: {
  actor: string;
  action: string;
  refType?: string;
  refId?: string;
  caseId?: string | null;
  detail?: unknown;
}): void {
  db.insert(schema.auditLog)
    .values({
      at: demoNowIso(),
      actor: entry.actor,
      action: entry.action,
      refType: entry.refType ?? null,
      refId: entry.refId ?? null,
      caseId: entry.caseId ?? null,
      detail: entry.detail ?? null,
    })
    .run();
}
