"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
import { jfetch } from "@/lib/format";
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner, cn } from "@/components/ui";

function HealthBadge({ h }: { h: { status: string; detail?: string; at?: string } | null }) {
  if (!h || h.status === "unknown") return <Badge tone="neutral">Not verified yet</Badge>;
  const map: Record<string, { tone: "success" | "danger" | "warning" | "neutral" | "info"; label: string }> = {
    ok: { tone: "success", label: "Healthy" },
    error: { tone: "danger", label: "Error" },
    not_configured: { tone: "neutral", label: "Not configured" },
    simulated: { tone: "warning", label: "Simulated" },
    disabled: { tone: "neutral", label: "Disabled" },
  };
  const m = map[h.status] ?? { tone: "neutral" as const, label: h.status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

function ServiceCard({
  title,
  subtitle,
  configured,
  health,
  onVerify,
  verifying,
  verifyResult,
  children,
  docHint,
}: {
  title: string;
  subtitle: string;
  configured: boolean;
  health: any;
  onVerify?: () => void;
  verifying?: boolean;
  verifyResult?: { ok: boolean; detail: string } | null;
  children?: React.ReactNode;
  docHint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-extrabold text-scd-ink">{title}</h3>
        <Badge tone={configured ? "primary" : "neutral"}>{configured ? "Configured" : "Not configured"}</Badge>
        <HealthBadge h={health} />
        {onVerify && (
          <Button variant="outline" className="ml-auto !px-3 !py-1 text-[12px]" disabled={verifying || !configured} onClick={onVerify}>
            {verifying ? <Spinner /> : "Verify"}
          </Button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-scd-muted">{subtitle}</p>
      {health?.detail && <p className="mt-1.5 text-[12px] text-scd-ink/70">Last check: {health.detail}</p>}
      {verifyResult && (
        <p className={cn("mt-2 animate-scd-in rounded-xl px-3 py-2 text-[12px] font-semibold", verifyResult.ok ? "bg-[#E2F6ED] text-[#116B47]" : "bg-[#F9E2DE] text-[#8C2B20]")}>
          {verifyResult.detail}
        </p>
      )}
      {children}
      {docHint && <p className="mt-2 text-[11px] text-scd-muted">Setup guide: <code className="rounded bg-scd-chip px-1 py-0.5">{docHint}</code></p>}
    </Card>
  );
}

function IntegrationsInner() {
  const search = useSearchParams();
  const { data, refresh } = usePoll<any>("/api/integrations/status", 4000);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [mapMsg, setMapMsg] = useState<string | null>(null);
  const [oauthToast, setOauthToast] = useState<string | null>(null);

  useEffect(() => {
    const o = search.get("oauth");
    if (o === "ok") setOauthToast("Google account connected — Calendar and Gmail are authorized.");
    if (o === "error") setOauthToast("Google connection failed — check client id/secret and redirect URI, then try again.");
    if (o === "denied") setOauthToast("Google connection was cancelled before finishing.");
  }, [search]);

  async function verify(service: string) {
    setVerifying(service);
    try {
      const res = await jfetch<any>("/api/integrations/verify", { method: "POST", body: JSON.stringify({ service }) });
      setResults((r) => ({ ...r, [service]: { ok: res.ok, detail: res.detail + (res.tools?.length ? ` Tools: ${res.tools.join(", ")}` : "") } }));
      refresh();
    } catch (e) {
      setResults((r) => ({ ...r, [service]: { ok: false, detail: (e as Error).message } }));
    } finally {
      setVerifying(null);
    }
  }

  async function saveMapping(doctorId: string) {
    setMapMsg(null);
    try {
      await jfetch("/api/integrations/mapping", { method: "POST", body: JSON.stringify({ doctorId, calendarId: mapDraft[doctorId] }) });
      setMapMsg("Mapping saved.");
      setMapDraft((d) => {
        const { [doctorId]: _drop, ...rest } = d;
        return rest;
      });
      refresh();
    } catch (e) {
      setMapMsg((e as Error).message);
    }
  }

  if (!data) return <EmptyState>Loading integration status…</EmptyState>;
  const live = data.mode?.mode === "live";

  return (
    <div className="mx-auto max-w-[920px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-scd-ink">Integrations</h1>
        <Badge tone={live ? "success" : "warning"}>{live ? "Live Agentic Mode" : "Presentation Resilience Mode"}</Badge>
        {data.forcedFallback && <Badge tone="danger">Resilience forced from Admin</Badge>}
      </div>

      {!live && (data.mode?.reasons ?? []).length > 0 && (
        <div className="rounded-card border border-[#eeddb8] bg-[#F9EFDC] px-4 py-2.5 text-[13px] text-[#7A5310]">
          <b>Why resilience mode:</b> {data.mode.reasons.join(" · ")}
        </div>
      )}
      {oauthToast && (
        <div className="animate-scd-pop rounded-card border border-scd-primary/40 bg-scd-lavender/60 px-4 py-2.5 text-[13px] font-semibold text-scd-deep" role="status">
          {oauthToast} <button className="ml-1 underline" onClick={() => setOauthToast(null)}>ok</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <ServiceCard
          title="Gemini (Google AI)"
          subtitle={`Agent brain for live mode — model ${data.gemini.model}. Falls back to deterministic playbooks automatically.`}
          configured={data.gemini.provider === "gemini" && data.gemini.keyPresent}
          health={data.gemini.health}
          onVerify={() => verify("gemini")}
          verifying={verifying === "gemini"}
          verifyResult={results.gemini ?? null}
          docHint="docs/GEMINI_SETUP.md"
        >
          {!data.gemini.keyPresent && <p className="mt-2 text-[12px] text-scd-muted">Set <code className="rounded bg-scd-chip px-1">GEMINI_API_KEY</code> in <code className="rounded bg-scd-chip px-1">.env.local</code> and restart.</p>}
        </ServiceCard>

        <ServiceCard
          title="Google Calendar"
          subtitle={`Provider: ${data.google.calendarProvider}. Live writes happen only in the executor, after staff approval.`}
          configured={data.google.configured}
          health={data.google.calendarHealth}
          onVerify={() => verify("calendar")}
          verifying={verifying === "calendar"}
          verifyResult={results.calendar ?? null}
          docHint="docs/GOOGLE_WORKSPACE_SETUP.md"
        >
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={data.google.connected ? "success" : "neutral"}>{data.google.connected ? "Account connected" : "No account connected"}</Badge>
            <a href="/api/oauth/start" className={cn("rounded-pill px-3 py-1 text-[12px] font-bold", data.google.configured ? "bg-scd-primary text-white shadow-glow hover:bg-scd-deep" : "pointer-events-none bg-scd-chip text-scd-muted")}>
              {data.google.connected ? "Reconnect Google" : "Connect Google"}
            </a>
          </div>
        </ServiceCard>

        <ServiceCard
          title="Gmail"
          subtitle={`Provider: ${data.google.mailProvider}. Live mode keeps agent messages as drafts until staff press Send.`}
          configured={data.google.configured}
          health={data.google.mailHealth}
          onVerify={() => verify("gmail")}
          verifying={verifying === "gmail"}
          verifyResult={results.gmail ?? null}
          docHint="docs/GOOGLE_WORKSPACE_SETUP.md"
        />

        <ServiceCard
          title="Google Workspace MCP (experimental)"
          subtitle={`Transport: ${data.mcp.transport}. Optional path that exercises the same calendar/mail operations over MCP.`}
          configured={data.mcp.transport !== "disabled"}
          health={data.mcp.health}
          onVerify={() => verify("mcp")}
          verifying={verifying === "mcp"}
          verifyResult={results.mcp ?? null}
          docHint="docs/MCP_SETUP.md · docs/MCP_FEASIBILITY.md"
        >
          <p className="mt-2 text-[12px] text-scd-muted">Status: {data.mcp.status?.detail}</p>
        </ServiceCard>
      </div>

      <Card className="p-4">
        <SectionTitle>Doctor → calendar mapping</SectionTitle>
        <p className="mt-1 text-[12px] text-scd-muted">
          Point each doctor at a real Google Calendar id (e.g. <code className="rounded bg-scd-chip px-1">abc123@group.calendar.google.com</code>) for live
          mode, or keep the <code className="rounded bg-scd-chip px-1">sim-</code> ids for the simulated provider.
        </p>
        {mapMsg && <p className="mt-2 text-[12px] font-semibold text-scd-info">{mapMsg}</p>}
        <div className="mt-3 space-y-2">
          {(data.mapping ?? []).map((m: any) => (
            <div key={m.doctorId} className="flex items-center gap-2">
              <span className="w-44 text-[13px] font-bold text-scd-ink">{m.name}</span>
              <input
                value={mapDraft[m.doctorId] ?? m.calendarId ?? ""}
                onChange={(e) => setMapDraft((d) => ({ ...d, [m.doctorId]: e.target.value }))}
                className="flex-1 rounded-xl border border-scd-line bg-white px-3 py-1.5 font-mono text-[12px] outline-none focus:border-scd-primary"
              />
              <Button
                variant="outline"
                className="!px-3 !py-1 text-[12px]"
                disabled={mapDraft[m.doctorId] === undefined || mapDraft[m.doctorId] === m.calendarId}
                onClick={() => saveMapping(m.doctorId)}
              >
                Save
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle>How the two modes work</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-4 text-[12px] leading-relaxed text-scd-ink/85">
          <div>
            <p className="font-extrabold text-scd-ink">Live Agentic Mode</p>
            <p>
              Gemini plans each case through function calling; Google Calendar and Gmail receive real writes — but only from the executor, only after a staff
              approval, and Gmail messages stay as drafts until staff press Send.
            </p>
          </div>
          <div>
            <p className="font-extrabold text-scd-ink">Presentation Resilience Mode</p>
            <p>
              The same pipeline runs on deterministic playbooks and simulated providers with identical data shapes. Every simulated effect is labeled. The
              app switches automatically on any live failure — mid-demo, without stopping.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function IntegrationsPage() {
  // useSearchParams (for the OAuth result toast) requires a Suspense boundary
  // so the page can still be statically prerendered.
  return (
    <Suspense fallback={<EmptyState>Loading integration status…</EmptyState>}>
      <IntegrationsInner />
    </Suspense>
  );
}
