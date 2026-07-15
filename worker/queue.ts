import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/core/db/client";

/** Enqueue a coordination event; delaySec is real (wall-clock) time. */
export function enqueueEvent(type: string, payload: unknown, delaySec = 0): string {
  const runAfter = delaySec > 0 ? new Date(Date.now() + delaySec * 1000).toISOString() : null;
  const row = db
    .insert(schema.events)
    .values({ type, payload: payload as any, status: "pending", runAfter, createdAt: new Date().toISOString() })
    .returning()
    .get();
  return row.id;
}

/** Atomically claim the next runnable event (single-worker demo semantics). */
export function claimNextEvent(): typeof schema.events.$inferSelect | null {
  const now = new Date().toISOString();
  const next = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.status, "pending"), or(isNull(schema.events.runAfter), lte(schema.events.runAfter, now))))
    .orderBy(asc(schema.events.createdAt))
    .limit(1)
    .get();
  if (!next) return null;
  const updated = db
    .update(schema.events)
    .set({ status: "processing", attempts: sql`${schema.events.attempts} + 1` })
    .where(and(eq(schema.events.id, next.id), eq(schema.events.status, "pending")))
    .run();
  if (updated.changes === 0) return null; // lost a race
  return { ...next, status: "processing", attempts: next.attempts + 1 };
}

export function completeEvent(id: string): void {
  db.update(schema.events).set({ status: "done", processedAt: new Date().toISOString() }).where(eq(schema.events.id, id)).run();
}

export function failEvent(id: string, retry: boolean): void {
  db.update(schema.events)
    .set(retry ? { status: "pending", runAfter: new Date(Date.now() + 2000).toISOString() } : { status: "failed", processedAt: new Date().toISOString() })
    .where(eq(schema.events.id, id))
    .run();
}
