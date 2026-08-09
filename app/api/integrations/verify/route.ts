import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { bedrockModel, env, geminiModel } from "@/core/env";
import { setServiceHealth } from "@/core/status";
import { audit } from "@/core/audit";
import { authorizedClient } from "@/integrations/oauth";
import { GoogleCalendarProvider } from "@/integrations/calendar/google";
import { GmailProvider } from "@/integrations/mail/google";
import { runMcpHealthCheck } from "@/integrations/mcp";
import { demoNow } from "@/core/clock";
import { addDays } from "date-fns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { service: "gemini" | "calendar" | "gmail" | "mcp" } → live verification. */
export async function POST(req: Request) {
  boot();
  const { service } = await body<{ service: string }>(req);
  const started = Date.now();
  try {
    if (service === "gemini") {
      const e = env();
      if (e.AI_PROVIDER !== "gemini")
        return json({ ok: false, detail: "AI_PROVIDER is set to fallback" });
      if (!e.GEMINI_API_KEY)
        return json({ ok: false, detail: "GEMINI_API_KEY is not set" });
      const { ChatGoogle } = await import("@langchain/google/node");
      const model = new ChatGoogle({
        apiKey: e.GEMINI_API_KEY,
        model: geminiModel(),
        platformType: "gcp",
        temperature: 0,
        maxRetries: 0,
      });
      const res = await model.invoke("Reply with exactly: pong");
      const text = String(res.content).slice(0, 40);
      setServiceHealth("gemini", {
        status: "ok",
        detail: `verified (${Date.now() - started}ms)`,
      });
      return json({
        ok: true,
        detail: `Model ${geminiModel()} responded: "${text.trim()}"`,
      });
    }
    if (service === "bedrock") {
      const e = env();
      if (e.AI_PROVIDER !== "bedrock")
        return json({ ok: false, detail: "AI_PROVIDER is not set to bedrock" });
      if (!e.AWS_BEARER_TOKEN_BEDROCK)
        return json({
          ok: false,
          detail: "AWS_BEARER_TOKEN_BEDROCK is not set",
        });
      const { ChatBedrockConverse } = await import("@langchain/aws");
      const model = new ChatBedrockConverse({
        model: bedrockModel(),
        region: e.BEDROCK_AWS_REGION,
        temperature: 0,
        maxRetries: 0,
      });
      const res = await model.invoke("Reply with exactly: pong");
      const text = String(res.content).slice(0, 40);
      setServiceHealth("bedrock", {
        status: "ok",
        detail: `verified (${Date.now() - started}ms)`,
      });
      return json({
        ok: true,
        detail: `Claude on Bedrock responded: "${text.trim()}"`,
      });
    }
    if (service === "calendar") {
      const auth = authorizedClient();
      if (!auth)
        return json({
          ok: false,
          detail: "Google account not connected (run OAuth first)",
        });
      const provider = new GoogleCalendarProvider();
      const doctors = db.select().from(schema.doctors).all();
      const unmapped = doctors.filter(
        (d) => !d.calendarId || d.calendarId.startsWith("sim-"),
      );
      if (unmapped.length > 0)
        return json({
          ok: false,
          detail: `Google Calendar is connected, but live calendar mapping is missing for ${unmapped.map((d) => d.name).join(", ")}.`,
        });
      const santos = doctors.find((d) => d.id === "doc_santos")!;
      const calId = santos.calendarId!;
      const events = await provider.listEvents(calId, {
        startUtc: demoNow().toISOString(),
        endUtc: addDays(demoNow(), 7).toISOString(),
      });
      setServiceHealth("calendar", {
        status: "ok",
        detail: `verified (${Date.now() - started}ms)`,
      });
      return json({
        ok: true,
        detail: `Read ${events.length} event(s) from "${calId}" over the next 7 days.`,
      });
    }
    if (service === "gmail") {
      const auth = authorizedClient();
      if (!auth)
        return json({
          ok: false,
          detail: "Google account not connected (run OAuth first)",
        });
      const provider = new GmailProvider();
      const profile = await provider.profile();
      setServiceHealth("mail", {
        status: "ok",
        detail: `verified (${Date.now() - started}ms)`,
      });
      const patientInbox = env().DEMO_PATIENT_EMAIL.trim().toLowerCase();
      const at = patientInbox.lastIndexOf("@");
      const patientBase =
        at > 0
          ? `${patientInbox.slice(0, at).split("+")[0]}@${patientInbox.slice(at + 1)}`
          : patientInbox;
      if (
        patientBase &&
        patientBase === profile.emailAddress.trim().toLowerCase()
      )
        return json({
          ok: false,
          detail:
            "Gmail is connected, but DEMO_PATIENT_EMAIL is the same account. Use a second inbox for patient replies; same-account replies are outbound SENT mail.",
        });
      return json({
        ok: true,
        detail: `Gmail connected as ${profile.emailAddress}.`,
      });
    }
    if (service === "mcp") {
      const status = await runMcpHealthCheck();
      return json({
        ok: status.state === "connected",
        detail: status.detail,
        state: status.state,
        tools: status.state === "connected" ? status.tools : [],
      });
    }
    return err("service must be gemini | bedrock | calendar | gmail | mcp");
  } catch (e) {
    const detail = String((e as Error).message ?? e).slice(0, 300);
    if (service === "gemini")
      setServiceHealth("gemini", { status: "error", detail });
    if (service === "bedrock")
      setServiceHealth("bedrock", { status: "error", detail });
    if (service === "calendar")
      setServiceHealth("calendar", { status: "error", detail });
    if (service === "gmail")
      setServiceHealth("mail", { status: "error", detail });
    return json({ ok: false, detail });
  } finally {
    audit({
      actor: "staff",
      action: "integration.verify",
      detail: { service },
    });
  }
}
