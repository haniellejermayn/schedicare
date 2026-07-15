import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { id } from "@/core/ids";
import type { CalEvent, CalendarProvider, NewCalEvent, TimeRange } from "./types";

/**
 * Deterministic calendar over the sim_calendar_events table. Same interface,
 * same behaviour, no network. First-class citizen: the demo defaults to it.
 */
export class SimulatedCalendarProvider implements CalendarProvider {
  readonly name = "simulated" as const;

  async listEvents(calendarId: string, range: TimeRange): Promise<CalEvent[]> {
    const rows = db
      .select()
      .from(schema.simCalendarEvents)
      .where(
        and(
          eq(schema.simCalendarEvents.calendarId, calendarId),
          lt(schema.simCalendarEvents.startUtc, range.endUtc),
          gt(schema.simCalendarEvents.endUtc, range.startUtc)
        )
      )
      .all();
    return rows
      .filter((r) => r.status === "confirmed")
      .map((r) => ({
        id: r.id,
        calendarId: r.calendarId,
        summary: r.summary,
        startUtc: r.startUtc,
        endUtc: r.endUtc,
        status: r.status,
      }));
  }

  async freeBusy(calendarId: string, range: TimeRange) {
    const events = await this.listEvents(calendarId, range);
    return events.filter((e) => e.status === "confirmed").map((e) => ({ startUtc: e.startUtc, endUtc: e.endUtc }));
  }

  async createEvent(e: NewCalEvent): Promise<CalEvent> {
    const row = db
      .insert(schema.simCalendarEvents)
      .values({
        id: `sim_${id(10)}`,
        calendarId: e.calendarId,
        summary: e.summary,
        startUtc: e.startUtc,
        endUtc: e.endUtc,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    return { id: row.id, calendarId: row.calendarId, summary: row.summary, startUtc: row.startUtc, endUtc: row.endUtc, status: "confirmed" };
  }

  async updateEvent(calendarId: string, evId: string, patch: Partial<NewCalEvent>): Promise<CalEvent> {
    db.update(schema.simCalendarEvents)
      .set({
        ...(patch.summary ? { summary: patch.summary } : {}),
        ...(patch.startUtc ? { startUtc: patch.startUtc } : {}),
        ...(patch.endUtc ? { endUtc: patch.endUtc } : {}),
      })
      .where(and(eq(schema.simCalendarEvents.id, evId), eq(schema.simCalendarEvents.calendarId, calendarId)))
      .run();
    const row = db.select().from(schema.simCalendarEvents).where(eq(schema.simCalendarEvents.id, evId)).get();
    if (!row) throw new Error(`simulated event ${evId} not found`);
    return { id: row.id, calendarId: row.calendarId, summary: row.summary, startUtc: row.startUtc, endUtc: row.endUtc, status: row.status };
  }

  async deleteEvent(calendarId: string, evId: string): Promise<void> {
    db.update(schema.simCalendarEvents)
      .set({ status: "cancelled" })
      .where(and(eq(schema.simCalendarEvents.id, evId), eq(schema.simCalendarEvents.calendarId, calendarId)))
      .run();
  }
}
