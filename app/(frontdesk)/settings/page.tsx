"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
import { jfetch, fmtWhenManila } from "@/lib/format";
import {
  Button,
  Card,
  Chip,
  Empty,
  Modal,
  PageTitle,
  Spinner,
  Tabs,
  cn,
} from "@/components/ui";
import type { Tone } from "@/components/copy";

type Tab = "connections" | "demo" | "audit";

function healthTone(h: any): Tone {
  if (!h) return "neutral";
  return h.status === "ok" ? "ok" : h.status === "error" ? "bad" : "neutral";
}
function healthLabel(h: any): string {
  if (!h) return "Not checked yet";
  return h.status === "ok"
    ? "Healthy"
    : h.status === "error"
      ? "Problem"
      : h.status === "not_configured"
        ? "Not set up"
        : h.status;
}

function ServiceCard({
  title,
  subtitle,
  health,
  onVerify,
  verifying,
  result,
  children,
}: {
  title: string;
  subtitle: string;
  health: any;
  onVerify?: () => void;
  verifying?: boolean;
  result?: { ok: boolean; detail: string };
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-md font-bold text-ink">{title}</h3>
        <Chip tone={healthTone(health)}>{healthLabel(health)}</Chip>
        {onVerify && (
          <Button
            variant="secondary"
            small
            className="ml-auto"
            disabled={verifying}
            onClick={onVerify}
          >
            {verifying ? <Spinner /> : "Verify"}
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      {result && (
        <p
          className={cn(
            "mt-2 rounded-ctl border px-3 py-2 text-sm font-semibold",
            result.ok
              ? "border-ok-line bg-ok-soft text-ok"
              : "border-bad-line bg-bad-soft text-bad",
          )}
        >
          {result.detail}
        </p>
      )}
      {children}
    </Card>
  );
}

function Connections() {
  const search = useSearchParams();
  const { data, refresh } = usePoll<any>("/api/integrations/status", 4000);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [results, setResults] = useState<
    Record<string, { ok: boolean; detail: string }>
  >({});
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [mapMsg, setMapMsg] = useState<string | null>(null);
  const [oauthToast, setOauthToast] = useState<string | null>(null);

  useEffect(() => {
    const o = search.get("oauth");
    if (o === "ok")
      setOauthToast(
        "Google account connected — Calendar and Gmail are authorized.",
      );
    if (o === "error")
      setOauthToast(
        "Google connection failed — check client id/secret and redirect URI, then try again.",
      );
    if (o === "denied")
      setOauthToast("Google connection was cancelled before finishing.");
  }, [search]);

  async function verify(service: string) {
    setVerifying(service);
    try {
      const res = await jfetch<any>("/api/integrations/verify", {
        method: "POST",
        body: JSON.stringify({ service }),
      });
      setResults((r) => ({
        ...r,
        [service]: { ok: res.ok, detail: res.detail },
      }));
      refresh();
    } catch (e) {
      setResults((r) => ({
        ...r,
        [service]: { ok: false, detail: (e as Error).message },
      }));
    } finally {
      setVerifying(null);
    }
  }

  async function saveMapping(
    doctorId: string,
    existingCalendarId?: string | null,
  ) {
    const calendarId = (mapDraft[doctorId] ?? existingCalendarId ?? "").trim();

    if (!doctorId || !calendarId) {
      setMapMsg("Doctor and calendar ID are required.");
      return;
    }

    try {
      await jfetch("/api/integrations/mapping", {
        method: "POST",
        body: JSON.stringify({
          doctorId,
          calendarId,
        }),
      });

      setMapMsg(
        "Saved — new calendar events for this doctor go to that calendar.",
      );
      refresh();
    } catch (error) {
      setMapMsg((error as Error).message);
    }
  }

  if (!data) return <Empty>Loading…</Empty>;
  return (
    <div className="space-y-3">
      {oauthToast && (
        <p className="rounded-ctl border border-accent-line bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">
          {oauthToast}
        </p>
      )}

      <ServiceCard
        title={`AI (${data.ai?.provider === "bedrock" ? "Claude on Bedrock" : data.ai?.provider === "gemini" ? "Gemini" : "Fallback"})`}
        subtitle={
          data.ai?.provider === "bedrock"
            ? `Live semantic interpretation and agent reasoning with ${data.ai.model}.`
            : data.ai?.provider === "gemini"
              ? `Live semantic interpretation and agent reasoning with ${data.ai.model}.`
              : "Deterministic fallback is configured; no live model calls will run."
        }
        health={data.ai?.health}
        onVerify={() => verify(data.ai?.provider ?? "gemini")}
        verifying={verifying === data.ai?.provider}
        result={results[data.ai?.provider ?? "gemini"]}
      />

      <ServiceCard
        title="Google Calendar & Gmail"
        subtitle="Approving a recommendation reserves the selected slot and sends the reviewed message."
        health={data.google.calendarHealth}
        onVerify={() => verify("calendar")}
        verifying={verifying === "calendar"}
        result={results.calendar}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip tone={data.google.connected ? "ok" : "neutral"}>
            {data.google.connected
              ? "Account connected"
              : "No account connected"}
          </Chip>
          <Chip tone={data.google.autoSimulateReplies ? "bad" : "ok"}>
            {data.google.autoSimulateReplies
              ? "Simulated replies enabled"
              : `Actual replies only · ${data.google.gmailPollMs / 1000}s polling`}
          </Chip>
          <a
            href="/api/oauth/start"
            className={cn(
              "rounded-ctl px-3 py-1.5 text-sm font-semibold",
              data.google.configured
                ? "bg-accent text-white hover:bg-accent-press"
                : "pointer-events-none bg-surface-alt text-muted",
            )}
          >
            {data.google.connected ? "Reconnect Google" : "Connect Google"}
          </a>
          <Button
            variant="secondary"
            small
            disabled={verifying === "gmail"}
            onClick={() => verify("gmail")}
          >
            {verifying === "gmail" ? <Spinner /> : "Verify Gmail"}
          </Button>
          {results.gmail && (
            <span
              className={cn(
                "text-xs font-semibold",
                results.gmail.ok ? "text-ok" : "text-bad",
              )}
            >
              {results.gmail.detail}
            </span>
          )}
        </div>
        <div className="mt-4">
          <p className="eyebrow">Doctor → calendar</p>
          {mapMsg && (
            <p className="mt-1 text-xs font-semibold text-ok">{mapMsg}</p>
          )}
          <div className="mt-1.5 space-y-1.5">
            {(data.mapping ?? []).map((m: any) => (
              <div key={m.doctorId} className="flex items-center gap-2">
                <span className="w-24 text-sm font-semibold text-ink">
                  {m.name}
                </span>
                <input
                  value={mapDraft[m.doctorId] ?? m.calendarId ?? ""}
                  onChange={(e) =>
                    setMapDraft((d) => ({
                      ...d,
                      [m.doctorId]: e.target.value,
                    }))
                  }
                  placeholder="Google Calendar ID"
                  className="flex-1 rounded-ctl border border-line px-2.5 py-1.5 text-xs outline-none focus:border-accent"
                />
                <Button
                  variant="secondary"
                  small
                  onClick={() => saveMapping(m.doctorId, m.calendarId)}
                >
                  Save
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Keep the sim- ids to stay on the built-in calendar for that doctor.
          </p>
        </div>
      </ServiceCard>

      <ServiceCard
        title="MCP (experimental)"
        subtitle={`Transport: ${data.mcp.transport}. A readiness path proving the same integrations can run over the Model Context Protocol.`}
        health={data.mcp.health}
        onVerify={() => verify("mcp")}
        verifying={verifying === "mcp"}
        result={results.mcp}
      />
    </div>
  );
}

function DemoData() {
  const { data: status, refresh: refreshStatus } = usePoll<any>(
    "/api/status",
    3000,
  );
  const { data: metrics, refresh: refreshMetrics } = usePoll<any>(
    "/api/admin/metrics",
    3000,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "cascade" | null>(null);

  async function run(action: "reset" | "cascade" | "force") {
    setBusy(action);
    setToast(null);
    try {
      if (action === "reset") {
        const r = await jfetch<any>("/api/admin/reset", { method: "POST" });
        setToast(
          `Demo reset — ${r.demoDayAffected} live-reply patients staged for ${r.demoDay}. Google connection and calendar mappings were kept.`,
        );
      } else if (action === "cascade") {
        const r = await jfetch<any>("/api/admin/cascade", { method: "POST" });
        setToast(
          `Emergency triggered — Dr. Santos is out on ${r.date}. Open Front desk to review the suggestions.`,
        );
      } else {
        const r = await jfetch<any>("/api/admin/force-fallback", {
          method: "POST",
        });
        setToast(
          r.forced
            ? "Demo mode forced ON — live services are ignored until you turn this off."
            : "Force lifted — live services are used when available.",
        );
      }
      refreshStatus();
      refreshMetrics();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const m = metrics;
  return (
    <div className="space-y-3">
      {toast && (
        <p className="rounded-ctl border border-accent-line bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">
          {toast}
        </p>
      )}

      <Card className="p-4">
        <h3 className="text-md font-bold text-ink">Demo controls</h3>
        {status && (
          <p className="mt-1 text-sm text-muted">
            Demo clock:{" "}
            <b className="tnum text-ink">{fmtWhenManila(status.demoNow)}</b>{" "}
            (Asia/Manila) · Mode: {status.mode === "live" ? "Live" : "Demo"}
            {status.forced ? " (forced)" : ""}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => setConfirm("cascade")}
          >
            {busy === "cascade" ? <Spinner /> : "Trigger the emergency"}
          </Button>
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => run("force")}
          >
            {busy === "force" ? (
              <Spinner />
            ) : status?.forced ? (
              "Stop forcing demo mode"
            ) : (
              "Force demo mode"
            )}
          </Button>
          <Button
            variant="danger"
            disabled={!!busy}
            onClick={() => setConfirm("reset")}
          >
            {busy === "reset" ? <Spinner /> : "Reset demo data"}
          </Button>
        </div>
      </Card>

      {m && (
        <Card className="p-4">
          <h3 className="text-md font-bold text-ink">Today so far</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Cases handled", m.cases?.total ?? 0],
              ["Waiting for review", m.recommendations?.proposed ?? 0],
              ["Offers sent", m.recommendations?.executed ?? 0],
              ["Care minutes saved", m.minutesRecovered ?? 0],
            ].map(([label, v]) => (
              <div key={label as string}>
                <p className="tnum text-2xl font-bold text-ink">
                  {v as number}
                </p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>
          {m.agentRuns && (
            <p className="mt-3 text-xs text-muted">
              System runs: {m.agentRuns.total} ({m.agentRuns.live ?? 0} with
              Gemini, {m.agentRuns.fallback ?? 0} on built-in playbooks,{" "}
              {m.agentRuns.errors ?? 0} errors)
            </p>
          )}
        </Card>
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm === "reset"
            ? "Reset all demo data?"
            : "Trigger the doctor emergency?"
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Back
            </Button>
            <Button
              variant={confirm === "reset" ? "danger" : "primary"}
              onClick={() => run(confirm!)}
            >
              Yes, do it
            </Button>
          </>
        }
      >
        <p>
          {confirm === "reset"
            ? "Cases, messages and demo history are cleared; Google OAuth and doctor calendar mappings stay connected."
            : "Marks Dr. Santos out on the seeded showcase day and opens a case with three suggestions for the front desk to review."}
        </p>
      </Modal>
    </div>
  );
}

function Audit() {
  const [q, setQ] = useState("");
  const { data } = usePoll<any>(
    `/api/admin/audit?q=${encodeURIComponent(q)}&limit=120`,
    4000,
  );
  const rows = data?.entries ?? [];
  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the record — e.g. reject, doc_santos, mail"
        className="w-full rounded-ctl border border-line bg-surface px-3 py-2 text-base outline-none focus:border-accent"
      />
      <Card className="max-h-[480px] overflow-y-auto scroll-quiet">
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-muted">
            Nothing matches.
          </p>
        )}
        <ul className="divide-y divide-line">
          {rows.map((a: any) => (
            <li key={a.id} className="px-4 py-2">
              <div className="flex items-baseline gap-2">
                <Chip tone="neutral" className="!px-1.5 !text-micro">
                  {a.actor}
                </Chip>
                <span className="text-sm font-semibold text-ink">
                  {a.action}
                </span>
                <span className="tnum ml-auto shrink-0 text-xs text-muted">
                  {fmtWhenManila(a.at)}
                </span>
              </div>
              {a.detail && (
                <p className="mt-0.5 break-all text-xs leading-snug text-muted">
                  {JSON.stringify(a.detail).slice(0, 220)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted">
        Every consequential action — human or automatic — lands here with who
        did it.
      </p>
    </div>
  );
}

function SettingsInner() {
  const search = useSearchParams();
  const initial = (search.get("tab") as Tab) || "connections";
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <div className="space-y-5">
      <PageTitle subtitle="Integrations, demo controls, and the audit trail.">
        Settings
      </PageTitle>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "connections", label: "Connections" },
          { id: "demo", label: "Demo & data" },
          { id: "audit", label: "Record" },
        ]}
      />
      {tab === "connections" && <Connections />}
      {tab === "demo" && <DemoData />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Empty>Loading settings…</Empty>}>
      <SettingsInner />
    </Suspense>
  );
}
