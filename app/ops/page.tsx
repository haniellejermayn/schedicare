"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePoll, useFeed } from "@/lib/usePoll";
import { jfetch } from "@/lib/format";
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner, StatusBadge } from "@/components/ui";
import { CaseQueue, LiveFeed, RecommendationCard, Scoreboard } from "@/components/ops";

export default function OpsPage() {
  const { data: status } = usePoll<any>("/api/status", 4000);
  const { data: caseList, refresh: refreshCases } = usePoll<any>("/api/cases", 2000);
  const [selected, setSelected] = useState<string | null>(null);
  const { data: detail, refresh: refreshDetail } = usePoll<any>(selected ? `/api/cases/${selected}` : null, 1500);
  const feed = useFeed(selected);
  const [busyAll, setBusyAll] = useState(false);

  const cases = caseList?.cases ?? [];

  // Auto-select the most interesting case: awaiting approval > active > latest.
  useEffect(() => {
    if (selected && cases.some((c: any) => c.id === selected)) return;
    const waiting = cases.find((c: any) => c.state === "awaiting_approval");
    const active = cases.find((c: any) => !["resolved"].includes(c.state));
    setSelected(waiting?.id ?? active?.id ?? cases[0]?.id ?? null);
  }, [cases, selected]);

  // Refresh detail promptly when new feed items arrive for the case.
  useEffect(() => {
    if (feed.bump > 0) refreshDetail();
  }, [feed.bump, refreshDetail]);

  const c = detail?.case;
  const recs = detail?.recommendations ?? [];
  const proposed = recs.filter((r: any) => r.status === "proposed");
  const resilience = status && status.mode !== "live";

  async function approveAll() {
    if (!selected) return;
    setBusyAll(true);
    try {
      await jfetch(`/api/cases/${selected}/approve-all`, { method: "POST" });
      refreshDetail();
      refreshCases();
    } finally {
      setBusyAll(false);
    }
  }

  async function resolveEscalated() {
    if (!selected) return;
    await jfetch(`/api/cases/${selected}/resolve`, { method: "POST" });
    refreshDetail();
    refreshCases();
  }

  return (
    <div className="flex h-[calc(100vh-96px)] min-h-0 flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-scd-ink">Staff Ops Center</h1>
        <span className="rounded-pill bg-scd-lavender px-3 py-1 text-[12px] font-bold text-scd-deep">
          Nothing is sent or written until you approve.
        </span>
        {c && <Scoreboard s={detail?.scoreboard} />}
      </div>

      {resilience && (
        <div className="animate-scd-in rounded-card border border-[#eeddb8] bg-[#F9EFDC] px-4 py-2.5 text-[13px] font-semibold text-[#7A5310]">
          Presentation Resilience Mode — {status.reasons?.join("; ") || "simulated providers active"}. Every panel works identically; effects are labeled
          “Simulated”.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_360px] gap-3">
        {/* Left: queue */}
        <CaseQueue cases={cases} selected={selected} onSelect={setSelected} />

        {/* Middle: case detail */}
        <Card className="flex min-h-0 flex-col p-4">
          {!c ? (
            <EmptyState>Select a case — or trigger the demo cascade from the Doctor view.</EmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-extrabold text-scd-ink">{c.title}</h2>
                <StatusBadge status={c.state} />
                <Badge tone={c.severity === "high" || c.severity === "critical" ? "danger" : c.severity === "medium" ? "info" : "neutral"}>
                  {c.severity} severity
                </Badge>
                <span className="ml-auto flex items-center gap-2">
                  <Link href={`/ops/cases/${c.id}`} className="text-[12px] font-bold text-scd-primary hover:underline">
                    Full record →
                  </Link>
                </span>
              </div>

              {c.state === "awaiting_approval" && proposed.length > 0 && (
                <div className="mt-3 flex items-center gap-2 rounded-card border border-scd-primary/40 bg-scd-lavender/50 px-3 py-2">
                  <span className="text-[13px] font-bold text-scd-deep">
                    {proposed.length} recommendation{proposed.length === 1 ? "" : "s"} waiting for your review
                  </span>
                  <Button className="ml-auto" variant="primary" disabled={busyAll} onClick={approveAll}>
                    {busyAll ? <Spinner /> : `Approve all ${proposed.length}`}
                  </Button>
                </div>
              )}

              {c.state === "escalated" && (
                <div className="mt-3 flex items-center gap-2 rounded-card border border-scd-danger/40 bg-[#F9E2DE] px-3 py-2">
                  <span className="text-[13px] font-bold text-[#8C2B20]">Escalated to staff — automation stopped on purpose.</span>
                  <Button className="ml-auto" variant="outline" onClick={resolveEscalated}>
                    Mark handled
                  </Button>
                </div>
              )}

              <div className="scd-scroll mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {recs.length === 0 && (
                  <EmptyState>
                    {["open", "assessing", "planning"].includes(c.state) ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner /> Agents are working — recommendations land here for your approval.
                      </span>
                    ) : (
                      "No recommendations on this case."
                    )}
                  </EmptyState>
                )}
                {recs.map((r: any) => (
                  <RecommendationCard key={r.id} rec={r} messages={detail?.messages ?? []} onDecided={() => { refreshDetail(); refreshCases(); }} />
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Right: live feed */}
        <LiveFeed items={feed.items} connected={feed.connected} title={c ? "Live agent feed — this case" : "Live agent feed"} />
      </div>
    </div>
  );
}
