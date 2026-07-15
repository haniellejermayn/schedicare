"use client";
import { useState } from "react";
import { usePoll } from "@/lib/usePoll";
import { jfetch, fmtWhenManila } from "@/lib/format";
import { Badge, Button, Card, Dialog, EmptyState, SectionTitle, Spinner, cn } from "@/components/ui";

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="p-3.5">
      <p className={cn("text-2xl font-extrabold tabular-nums", tone ?? "text-scd-ink")}>{value}</p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-scd-muted">{label}</p>
    </Card>
  );
}

export default function AdminPage() {
  const { data: status, refresh: refreshStatus } = usePoll<any>("/api/status", 3000);
  const { data: metrics, refresh: refreshMetrics } = usePoll<any>("/api/admin/metrics", 3000);
  const [q, setQ] = useState("");
  const { data: auditData, refresh: refreshAudit } = usePoll<any>(`/api/admin/audit?q=${encodeURIComponent(q)}&limit=120`, 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "cascade" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function run(action: "reset" | "cascade" | "force") {
    setBusy(action);
    setToast(null);
    try {
      if (action === "reset") {
        const r = await jfetch<any>("/api/admin/reset", { method: "POST" });
        setToast(`Demo reset — ${r.patients} patients, ${r.appointments} appointments reseeded. Restart the worker if it's mid-case.`);
      } else if (action === "cascade") {
        await jfetch("/api/admin/cascade", { method: "POST" });
        setToast("Cascade triggered — Dr. Santos is out for Monday. Open the Ops Center to watch the agents work.");
      } else {
        const r = await jfetch<any>("/api/admin/force-fallback", { method: "POST" });
        setToast(r.forced ? "Presentation Resilience Mode forced ON — live services are ignored." : "Force lifted — the app uses live services when available.");
      }
      refreshStatus();
      refreshMetrics();
      refreshAudit();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const m = metrics;
  const live = status?.mode === "live";

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-scd-ink">Admin</h1>
        <Badge tone={live ? "success" : "warning"}>{live ? "Live Agentic Mode" : "Presentation Resilience Mode"}</Badge>
        {status && (
          <span className="text-[12px] text-scd-muted">
            Demo clock: <b className="text-scd-ink">{fmtWhenManila(status.demoNow)}</b> (Asia/Manila)
          </span>
        )}
      </div>

      {toast && (
        <div className="animate-scd-pop rounded-card border border-scd-primary/40 bg-scd-lavender/60 px-4 py-2.5 text-[13px] font-semibold text-scd-deep" role="status">
          {toast} <button className="ml-1 underline" onClick={() => setToast(null)}>ok</button>
        </div>
      )}

      {/* Demo controls */}
      <Card className="p-4">
        <SectionTitle>Demo controls</SectionTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!busy} onClick={() => setConfirm("reset")}>
            {busy === "reset" ? <Spinner /> : "Reset demo data"}
          </Button>
          <Button variant="primary" disabled={!!busy} onClick={() => setConfirm("cascade")}>
            {busy === "cascade" ? <Spinner /> : "⚡ Trigger demo cascade"}
          </Button>
          <Button variant="secondary" disabled={!!busy} onClick={() => run("force")}>
            {busy === "force" ? <Spinner /> : status?.forced ? "Lift forced resilience" : "Force Resilience Mode"}
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-scd-muted">
          Reset restores the exact pre-demo state (32 patients, Monday schedule, waitlist). Cascade marks Dr. Santos out and fires the doctor_emergency
          event — identical to pressing the button in the Doctor view. Force Resilience proves the fallback story live: flip it mid-demo and the pipeline
          keeps going on simulated providers.
        </p>
      </Card>

      {/* Metrics */}
      {m && (
        <>
          <div className="grid grid-cols-5 gap-3">
            <Metric label="Cases total" value={m.cases.total} />
            <Metric label="Awaiting approval" value={m.cases.awaitingApproval} tone="text-scd-warning" />
            <Metric label="Resolved" value={m.cases.resolved} tone="text-scd-success" />
            <Metric label="Escalated" value={m.cases.escalated} tone={m.cases.escalated > 0 ? "text-scd-danger" : undefined} />
            <Metric label="Care mins recovered" value={m.minutesRecovered} tone="text-scd-primary" />
          </div>
          <div className="grid grid-cols-5 gap-3">
            <Metric label="Agent runs" value={m.agentRuns.total} />
            <Metric label="Live / fallback" value={`${m.agentRuns.live} / ${m.agentRuns.fallback}`} />
            <Metric label="Avg agent latency" value={`${m.agentRuns.avgLatencyMs} ms`} />
            <Metric label="Tool calls (errors)" value={`${m.agentRuns.toolCalls} (${m.agentRuns.toolErrors})`} />
            <Metric label="Patient msgs needing a person" value={m.recommendations.needsHuman} tone={m.recommendations.needsHuman > 0 ? "text-scd-warning" : undefined} />
          </div>
        </>
      )}

      {/* Audit log */}
      <Card className="p-4">
        <SectionTitle
          right={
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter: actor, action, id…"
              className="w-64 rounded-pill border border-scd-line bg-white px-3 py-1.5 text-[12px] outline-none focus:border-scd-primary"
            />
          }
        >
          Audit log — every consequential action
        </SectionTitle>
        <div className="scd-scroll mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {(auditData?.entries ?? []).length === 0 && <EmptyState>No matching audit entries.</EmptyState>}
          {(auditData?.entries ?? []).map((e: any) => (
            <div key={e.id} className="flex items-baseline gap-2 rounded-xl px-2 py-1.5 hover:bg-scd-bg/70">
              <span className="shrink-0 text-[10px] tabular-nums text-scd-muted">
                {new Date(e.at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Manila" })}
              </span>
              <Badge tone={e.actor === "staff" ? "primary" : e.actor === "executor" ? "info" : "neutral"}>{e.actor}</Badge>
              <span className="text-[12px] font-bold text-scd-ink">{e.action}</span>
              {e.refId && <span className="truncate font-mono text-[11px] text-scd-muted">{e.refType}:{e.refId.slice(0, 14)}</span>}
              {e.detail && <span className="min-w-0 flex-1 truncate text-[11px] text-scd-muted">{JSON.stringify(e.detail)}</span>}
            </div>
          ))}
        </div>
      </Card>

      {/* Confirm dialogs */}
      <Dialog
        open={confirm === "reset"}
        onClose={() => setConfirm(null)}
        title="Reset all demo data?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" disabled={!!busy} onClick={() => run("reset")}>{busy === "reset" ? <Spinner /> : "Reset everything"}</Button>
          </>
        }
      >
        <p>All cases, recommendations, messages, events and the audit log are wiped; patients, appointments and the waitlist reseed to the exact demo-start state.</p>
      </Dialog>
      <Dialog
        open={confirm === "cascade"}
        onClose={() => setConfirm(null)}
        title="Trigger the flagship cascade?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="primary" disabled={!!busy} onClick={() => run("cascade")}>{busy === "cascade" ? <Spinner /> : "Mark Dr. Santos out"}</Button>
          </>
        }
      >
        <p>Marks Dr. Elena Santos unavailable for Monday, August 10 and enqueues the doctor_emergency event. Make sure the worker is running (<code className="rounded bg-scd-chip px-1">npm run worker</code>), then watch the Ops Center.</p>
      </Dialog>
    </div>
  );
}
