import { seed } from "@/sim/seed";
import { claimNextEvent, completeEvent, failEvent } from "@/worker/queue";
import { dispatchEvent } from "@/graph/dispatch";
import { db, schema } from "@/core/db/client";
import { and, eq, isNull, lte, or } from "drizzle-orm";

/** Fresh deterministic demo state (same seed the demo uses). */
export function freshSeed() {
  return seed();
}

/**
 * In-process worker: drain the event queue synchronously (PACING_MS=0 in
 * tests). Delayed events (runAfter in the future) are left alone unless
 * `includeFuture`, which pulls them forward — used to simulate "time passes".
 */
export async function pump(opts: { includeFuture?: boolean; maxEvents?: number } = {}): Promise<number> {
  const max = opts.maxEvents ?? 200;
  let handled = 0;
  for (let i = 0; i < max; i++) {
    if (opts.includeFuture) {
      db.update(schema.events).set({ runAfter: null }).where(eq(schema.events.status, "pending")).run();
    }
    const ev = claimNextEvent();
    if (!ev) break;
    try {
      await dispatchEvent(ev);
      completeEvent(ev.id);
    } catch (e) {
      failEvent(ev.id, ev.attempts < 2);
      if (ev.attempts >= 2) throw e;
    }
    handled++;
  }
  return handled;
}

export function pendingEvents() {
  return db.select().from(schema.events).where(eq(schema.events.status, "pending")).all();
}
