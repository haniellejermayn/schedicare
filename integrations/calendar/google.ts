import { google, type calendar_v3 } from "googleapis";
import { authorizedClient } from "../oauth";
import type { CalEvent, CalendarProvider, NewCalEvent, TimeRange } from "./types";

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google Calendar is not connected (no OAuth tokens)");
  }
}

/**
 * Live Google Calendar. Accepts an injected calendar_v3.Calendar client so
 * integration tests can run against a test double without network access.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google" as const;
  private cal: calendar_v3.Calendar;

  constructor(injected?: calendar_v3.Calendar) {
    if (injected) {
      this.cal = injected;
    } else {
      const auth = authorizedClient();
      if (!auth) throw new GoogleNotConnectedError();
      this.cal = google.calendar({ version: "v3", auth });
    }
  }

  async listEvents(calendarId: string, range: TimeRange): Promise<CalEvent[]> {
    const res = await this.cal.events.list({
      calendarId,
      timeMin: range.startUtc,
      timeMax: range.endUtc,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });
    return (res.data.items ?? [])
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        id: e.id ?? "",
        calendarId,
        summary: e.summary ?? "(busy)",
        startUtc: new Date(e.start!.dateTime!).toISOString(),
        endUtc: new Date(e.end!.dateTime!).toISOString(),
        status: e.status === "cancelled" ? ("cancelled" as const) : ("confirmed" as const),
      }));
  }

  async freeBusy(calendarId: string, range: TimeRange) {
    const res = await this.cal.freebusy.query({
      requestBody: { timeMin: range.startUtc, timeMax: range.endUtc, items: [{ id: calendarId }] },
    });
    const busy = res.data.calendars?.[calendarId]?.busy ?? [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ startUtc: new Date(b.start!).toISOString(), endUtc: new Date(b.end!).toISOString() }));
  }

  async createEvent(e: NewCalEvent): Promise<CalEvent> {
    const res = await this.cal.events.insert({
      calendarId: e.calendarId,
      requestBody: {
        summary: e.summary,
        description: e.description,
        start: { dateTime: e.startUtc },
        end: { dateTime: e.endUtc },
      },
    });
    return {
      id: res.data.id ?? "",
      calendarId: e.calendarId,
      summary: res.data.summary ?? e.summary,
      startUtc: e.startUtc,
      endUtc: e.endUtc,
      status: "confirmed",
    };
  }

  async updateEvent(calendarId: string, id: string, patch: Partial<NewCalEvent>): Promise<CalEvent> {
    const res = await this.cal.events.patch({
      calendarId,
      eventId: id,
      requestBody: {
        ...(patch.summary ? { summary: patch.summary } : {}),
        ...(patch.description ? { description: patch.description } : {}),
        ...(patch.startUtc ? { start: { dateTime: patch.startUtc } } : {}),
        ...(patch.endUtc ? { end: { dateTime: patch.endUtc } } : {}),
      },
    });
    return {
      id: res.data.id ?? id,
      calendarId,
      summary: res.data.summary ?? "",
      startUtc: res.data.start?.dateTime ? new Date(res.data.start.dateTime).toISOString() : (patch.startUtc ?? ""),
      endUtc: res.data.end?.dateTime ? new Date(res.data.end.dateTime).toISOString() : (patch.endUtc ?? ""),
      status: "confirmed",
    };
  }

  async deleteEvent(calendarId: string, id: string): Promise<void> {
    await this.cal.events.delete({ calendarId, eventId: id });
  }

  /** Destructive demo setup operation. Callers must validate the calendar ID. */
  async deleteAllEvents(calendarId: string): Promise<number> {
    const eventIds: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.cal.events.list({
        calendarId,
        maxResults: 250,
        pageToken,
        showDeleted: false,
        singleEvents: false,
      });
      eventIds.push(
        ...(res.data.items ?? []).flatMap((event) =>
          event.id ? [event.id] : [],
        ),
      );
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    let deleted = 0;
    for (const eventId of eventIds) {
      try {
        await this.cal.events.delete({ calendarId, eventId });
        deleted++;
      } catch (error) {
        const status =
          (error as { code?: number; response?: { status?: number } }).code ??
          (error as { response?: { status?: number } }).response?.status;
        if (status !== 404 && status !== 410) throw error;
      }
    }
    return deleted;
  }
}
