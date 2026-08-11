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
 *
 * Dispatch failures are fatal here, deliberately unlike the production worker
 * (worker/index.ts), which retries with backoff and escalates the case. Tests
 * run single-threaded against simulated providers with a frozen clock, so
 * there is no transient fault for a retry to absorb: a throw is always a real
 * bug and the only useful thing to do is show it.
 *
 * This used to mirror the worker's retry, which hid failures rather than
 * surviving them. failEvent(id, retry=true) re-queues with runAfter = now + 2s,
 * but claimNextEvent() only returns events whose runAfter has passed — so the
 * next iteration claimed nothing, the loop broke, and the event was abandoned
 * with pump() returning normally. The `attempts >= 2` rethrow was unreachable.
 * A native-module load failure inside startCase() consequently surfaced as
 * `expected 'open' to be 'awaiting_approval'` in five unrelated-looking tests.
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
      failEvent(ev.id, false); // mark failed, never re-queue: the throw below is the report
      throw new Error(
        `pump(): event ${ev.type} (${ev.id}) failed — ${String((e as Error)?.message ?? e)}`,
        { cause: e },
      );
    }
    handled++;
  }
  return handled;
}

export function pendingEvents() {
  return db.select().from(schema.events).where(eq(schema.events.status, "pending")).all();
}
