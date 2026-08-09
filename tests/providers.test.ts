import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshSeed } from "./helpers";
import { pickCalendarProvider, pickMailProvider, getBusyIntervals } from "@/integrations/factory";
import { SimulatedCalendarProvider } from "@/integrations/calendar/simulated";
import { SimulatedMailProvider } from "@/integrations/mail/simulated";
import { GoogleCalendarProvider } from "@/integrations/calendar/google";
import { GmailProvider } from "@/integrations/mail/google";
import { DisabledMcpTransport, GoogleWorkspaceMcpTransport, runMcpHealthCheck } from "@/integrations/mcp";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { seed } from "@/sim/seed";

describe("provider factory (resilience)", () => {
  beforeEach(() => freshSeed());

  it("selects simulated providers under test env and labels them non-live", () => {
    const cal = pickCalendarProvider();
    const mail = pickMailProvider();
    expect(cal.live).toBe(false);
    expect(cal.provider.name).toBe("simulated");
    expect(mail.live).toBe(false);
    expect(mail.provider.name).toBe("simulated");
  });

  it("simulated calendar create/list/delete round-trips and feeds busy intervals", async () => {
    const sim = new SimulatedCalendarProvider();
    const ev = await sim.createEvent({
      calendarId: "sim-santos",
      summary: "Test block",
      description: "",
      startUtc: "2026-08-13T01:00:00.000Z",
      endUtc: "2026-08-13T02:00:00.000Z",
    });
    const listed = await sim.listEvents("sim-santos", { startUtc: "2026-08-13T00:00:00.000Z", endUtc: "2026-08-14T00:00:00.000Z" });
    expect(listed.some((e) => e.id === ev.id)).toBe(true);
    const busy = await getBusyIntervals("sim-santos", { startUtc: "2026-08-13T00:00:00.000Z", endUtc: "2026-08-14T00:00:00.000Z" });
    expect(busy.some((b) => b.startUtc === "2026-08-13T01:00:00.000Z")).toBe(true);
    await sim.deleteEvent("sim-santos", ev.id);
    const after = await sim.listEvents("sim-santos", { startUtc: "2026-08-13T00:00:00.000Z", endUtc: "2026-08-14T00:00:00.000Z" });
    expect(after.some((e) => e.id === ev.id)).toBe(false);
  });

  it("simulated mail: draft → send → inbound reply appears in pollReplies", async () => {
    const sim = new SimulatedMailProvider();
    const d = await sim.createDraft({ to: "x@example.com", subject: "Offer", body: "Reply YES" });
    const sent = await sim.sendDraft(d.draftId);
    expect(sent.threadId).toBeTruthy();
    await sim.injectInbound(sent.threadId!, "x@example.com", "YES");
    const replies = await sim.pollReplies([sent.threadId!], []);
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toBe("YES");
    // seen-id dedupe
    const again = await sim.pollReplies([sent.threadId!], [replies[0].providerMessageId]);
    expect(again).toHaveLength(0);
  });
});

describe("demo reset integration persistence", () => {
  beforeEach(() => freshSeed());

  it("keeps OAuth and live mappings without assigning simulated event ids", () => {
    db.insert(schema.oauthTokens)
      .values({
        provider: "google",
        tokens: { refresh_token: "test-only" },
        updatedAt: new Date().toISOString(),
      })
      .run();
    db.update(schema.doctors)
      .set({ calendarId: "primary" })
      .where(eq(schema.doctors.id, "doc_santos"))
      .run();
    db.update(schema.doctors)
      .set({ calendarId: "team-calendar@example.com" })
      .where(eq(schema.doctors.id, "doc_reyes"))
      .run();

    const summary = seed("lite", { preserveIntegrations: true });

    expect(summary.demoDayAffected).toBe(3);
    expect(
      db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.provider, "google")).get(),
    ).toBeTruthy();
    expect(
      db.select().from(schema.doctors).where(eq(schema.doctors.id, "doc_santos")).get()!.calendarId,
    ).toBe("primary");
    expect(
      db.select().from(schema.doctors).where(eq(schema.doctors.id, "doc_reyes")).get()!.calendarId,
    ).toBe("team-calendar@example.com");
    expect(
      db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_camille")).get()!.calendarEventId,
    ).toBeNull();
  });
});

describe("google providers with injected doubles (no network)", () => {
  it("calendar provider maps create/list/delete through the API client", async () => {
    const store: any[] = [];
    const fake = {
      events: {
        insert: vi.fn(async ({ requestBody }: any) => {
          const ev = { id: `gev_${store.length + 1}`, ...requestBody };
          store.push(ev);
          return { data: ev };
        }),
        list: vi.fn(async () => ({
          data: {
            items: store.map((e) => ({ id: e.id, summary: e.summary, start: { dateTime: e.start.dateTime }, end: { dateTime: e.end.dateTime }, status: "confirmed" })),
          },
        })),
        delete: vi.fn(async ({ eventId }: any) => {
          const i = store.findIndex((e) => e.id === eventId);
          if (i >= 0) store.splice(i, 1);
          return { data: {} };
        }),
      },
    };
    const provider = new GoogleCalendarProvider(fake as any);
    const created = await provider.createEvent({ calendarId: "primary", summary: "S", description: "D", startUtc: "2026-08-13T01:00:00.000Z", endUtc: "2026-08-13T01:30:00.000Z" });
    expect(created.id).toBe("gev_1");
    const listed = await provider.listEvents("primary", { startUtc: "2026-08-13T00:00:00.000Z", endUtc: "2026-08-14T00:00:00.000Z" });
    expect(listed).toHaveLength(1);
    expect(listed[0].startUtc).toBe(new Date("2026-08-13T01:00:00.000Z").toISOString());
    await provider.deleteEvent("primary", created.id);
    expect(store).toHaveLength(0);
    expect(fake.events.insert).toHaveBeenCalledOnce();
  });

  it("gmail provider builds RFC822 drafts, sends, and parses thread replies", async () => {
    const drafts: any[] = [];
    let sentMsg: any = null;
    const fake = {
      users: {
        drafts: {
          create: vi.fn(async ({ requestBody }: any) => {
            const d = { id: `d_${drafts.length + 1}`, message: { id: `m_${drafts.length + 1}`, threadId: `t_1`, raw: requestBody.message.raw } };
            drafts.push(d);
            return { data: d };
          }),
          send: vi.fn(async ({ requestBody }: any) => {
            sentMsg = { id: "m_sent", threadId: "t_1" };
            expect(requestBody.id).toBe("d_1");
            return { data: sentMsg };
          }),
        },
        threads: {
          get: vi.fn(async () => ({
            data: {
              messages: [
                { id: "m_sent", labelIds: ["SENT"], payload: { headers: [] } },
                {
                  id: "m_reply",
                  labelIds: ["INBOX"],
                  internalDate: "1754800000000",
                  payload: {
                    headers: [{ name: "From", value: "Pat <pat@example.com>" }],
                    mimeType: "text/plain",
                    body: { data: Buffer.from("Yes, that works!").toString("base64url") },
                  },
                },
              ],
            },
          })),
        },
        getProfile: vi.fn(async () => ({ data: { emailAddress: "clinic@example.com" } })),
      },
    };
    const provider = new GmailProvider(fake as any);
    const d = await provider.createDraft({ to: "pat@example.com", subject: "Offer ✓", body: "Reply YES" });
    expect(d.draftId).toBe("d_1");
    const raw = Buffer.from(drafts[0].message.raw, "base64url").toString("utf8");
    expect(raw).toContain("To: pat@example.com");
    expect(raw).toContain("Subject:");
    const sent = await provider.sendDraft(d.draftId);
    expect(sent.threadId).toBe("t_1");
    const replies = await provider.pollReplies(["t_1"], ["m_sent"]);
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toContain("Yes, that works!");
    expect(replies[0].providerMessageId).toBe("m_reply");
    const profile = await provider.profile();
    expect(profile.emailAddress).toBe("clinic@example.com");
  });
});

describe("MCP transport", () => {
  it("reports disabled cleanly", async () => {
    const t = new DisabledMcpTransport();
    expect((await t.status()).state).toBe("disabled");
    const health = await runMcpHealthCheck();
    expect(["disabled", "fallback"]).toContain(health.state);
  });

  it("reports unreachable HTTP endpoints as unavailable without throwing", async () => {
    const t = new GoogleWorkspaceMcpTransport({ calendar: "http://127.0.0.1:9/mcp", gmail: "http://127.0.0.1:9/mcp" });
    const s = await t.healthCheck();
    expect(s.state).toBe("unavailable");
    expect(s.detail.length).toBeGreaterThan(0);
  });
});
