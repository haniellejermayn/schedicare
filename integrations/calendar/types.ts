export interface CalEvent {
  id: string;
  calendarId: string;
  summary: string;
  startUtc: string;
  endUtc: string;
  status: "confirmed" | "cancelled";
}

export interface NewCalEvent {
  calendarId: string;
  summary: string;
  description?: string;
  startUtc: string;
  endUtc: string;
}

export interface TimeRange {
  startUtc: string;
  endUtc: string;
}

/**
 * One interface, two implementations (google | simulated). The application
 * cannot tell them apart; the demo cannot be killed by OAuth or venue Wi-Fi.
 */
export interface CalendarProvider {
  readonly name: "google" | "simulated";
  listEvents(calendarId: string, range: TimeRange): Promise<CalEvent[]>;
  freeBusy(calendarId: string, range: TimeRange): Promise<Array<{ startUtc: string; endUtc: string }>>;
  createEvent(e: NewCalEvent): Promise<CalEvent>;
  updateEvent(calendarId: string, id: string, patch: Partial<NewCalEvent>): Promise<CalEvent>;
  deleteEvent(calendarId: string, id: string): Promise<void>;
}
