"use client";
import { useMemo, useRef, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, FitDots, SectionTitle, Spinner, StatusBadge, WhyChip, cn } from "@/components/ui";
import { agentLabel, fmtWhenManila, jfetch, typeLabel } from "@/lib/format";
import type { FeedItem } from "@/lib/usePoll";

/* ------------------------------------------------------------------------ */
/* Live agent feed                                                            */
/* ------------------------------------------------------------------------ */
const kindIcon: Record<string, string> = {
  status: "◆",
  thought: "…",
  tool_call: "⚙",
  tool_result: "⚙",
  transition: "→",
  recommendation: "★",
  decision: "✓",
  effect: "⚡",
  message: "✉",
  escalation: "▲",
  error: "!",
};
const kindTone: Record<string, string> = {
  error: "text-scd-danger",
  escalation: "text-scd-warning",
  effect: "text-scd-primary",
  decision: "text-scd-success",
  recommendation: "text-scd-deep",
};

export function LiveFeed({ items, connected, title = "Live agent feed" }: { items: FeedItem[]; connected: boolean; title?: string }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);
  return (
    <Card className="flex h-full min-h-0 flex-col p-4">
      <SectionTitle
        right={
          <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold", connected ? "text-scd-success" : "text-scd-muted")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-scd-success animate-scd-blink" : "bg-scd-line")} />
            {connected ? "streaming" : "connecting"}
          </span>
        }
      >
        {title}
      </SectionTitle>
      <div className="scd-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {items.length === 0 && <EmptyState>Quiet for now. Agent activity appears here the moment a case starts.</EmptyState>}
        {items.map((it) => (
          <div key={it.id} className="animate-scd-in rounded-xl px-2 py-1.5 hover:bg-scd-bg/70">
            <div className="flex items-baseline gap-2">
              <span className={cn("w-4 text-center text-[12px] font-bold", kindTone[it.kind] ?? "text-scd-muted")}>{kindIcon[it.kind] ?? "·"}</span>
              <span className="shrink-0 rounded-pill bg-scd-chip px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-scd-deep">
                {agentLabel(it.actor)}
              </span>
              <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-scd-ink">{it.title}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-scd-muted">
                {new Date(it.at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Manila" })}
              </span>
            </div>
            {it.detail && <p className="ml-6 mt-0.5 text-[12px] leading-snug text-scd-muted">{it.detail}</p>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Recovery scoreboard                                                        */
/* ------------------------------------------------------------------------ */
export function Scoreboard({ s }: { s: any }) {
  if (!s) return null;
  const cell = (label: string, value: string | number, tone?: string) => (
    <div className="flex flex-col items-center rounded-card bg-white px-3 py-2 shadow-ambient border border-scd-line/60">
      <span className={cn("text-lg font-extrabold tabular-nums", tone ?? "text-scd-ink")}>{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-scd-muted">{label}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-5 gap-2">
      {cell("Affected", s.affected)}
      {cell("Rebooked", s.rebooked, "text-scd-primary")}
      {cell("Confirmed", s.confirmed, "text-scd-success")}
      {cell("Needs call", s.declinedOrCallback, s.declinedOrCallback > 0 ? "text-scd-warning" : undefined)}
      {cell("Care mins saved", s.minutesRecovered, "text-scd-deep")}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Case queue                                                                 */
/* ------------------------------------------------------------------------ */
const sevTone: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};
export function CaseQueue({ cases, selected, onSelect }: { cases: any[]; selected: string | null; onSelect: (id: string) => void }) {
  const active = cases.filter((c) => !["resolved"].includes(c.state));
  const done = cases.filter((c) => c.state === "resolved");
  const Row = ({ c }: { c: any }) => (
    <button
      onClick={() => onSelect(c.id)}
      className={cn(
        "w-full rounded-card border p-3 text-left transition-all",
        selected === c.id ? "border-scd-primary bg-scd-lavender/60 shadow-glow" : "border-scd-line/60 bg-white hover:border-scd-primary/50"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-bold text-scd-ink">{c.title}</span>
        <Badge tone={sevTone[c.severity]}>{c.severity}</Badge>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <StatusBadge status={c.state} />
        {c.pendingCount > 0 && <Badge tone="warning">{c.pendingCount} to review</Badge>}
      </div>
    </button>
  );
  return (
    <Card className="flex h-full min-h-0 flex-col p-4">
      <SectionTitle>Case queue</SectionTitle>
      <div className="scd-scroll mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {active.length === 0 && <EmptyState>No open cases. Trigger the demo cascade from the Doctor view or Admin.</EmptyState>}
        {active.map((c) => (
          <Row key={c.id} c={c} />
        ))}
        {done.length > 0 && (
          <>
            <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-scd-muted">Resolved</p>
            {done.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Recommendation card                                                        */
/* ------------------------------------------------------------------------ */
export function RecommendationCard({
  rec,
  messages,
  onDecided,
}: {
  rec: any;
  messages: any[];
  onDecided: () => void;
}) {
  const p = rec.payload ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "modify" | "reject">("none");
  const [optionId, setOptionId] = useState<string>(p.chosenOptionId ?? "");
  const [reason, setReason] = useState("");
  const [showWhy, setShowWhy] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [errText, setErrText] = useState<string | null>(null);

  const chosen = useMemo(
    () => (p.options ?? []).find((o: any) => o.id === (p.modifiedOptionId ?? p.chosenOptionId)) ?? (p.options ?? [])[0],
    [p]
  );
  const relatedMsgs = messages.filter((m) => m.recommendationId === rec.id);
  const outboundDraft = relatedMsgs.find((m) => m.direction === "outbound" && m.status === "draft_created");
  const decided = rec.status !== "proposed";

  async function decide(action: "approve" | "modify" | "reject") {
    setBusy(action);
    setErrText(null);
    try {
      await jfetch(`/api/recommendations/${rec.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ action, optionId: action === "modify" ? optionId : undefined, reason: reason || undefined }),
      });
      setMode("none");
      onDecided();
    } catch (e) {
      setErrText((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sendDraft() {
    if (!outboundDraft) return;
    setBusy("send");
    try {
      await jfetch(`/api/messages/${outboundDraft.id}/send`, { method: "POST" });
      onDecided();
    } catch (e) {
      setErrText((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const outcomeBadge =
    rec.status === "executed" ? (
      rec.outcome === "accepted" ? (
        <Badge tone="success">Patient confirmed ✓</Badge>
      ) : rec.outcome === "declined" ? (
        <Badge tone="danger">Declined — call listed</Badge>
      ) : rec.outcome === "superseded" ? (
        <Badge tone="info">Superseded by replan</Badge>
      ) : rec.outcome === "needs_human" ? (
        <Badge tone="warning">Needs a person</Badge>
      ) : rec.outcome === "sent" ? (
        <Badge tone="info">Message sent</Badge>
      ) : (
        <Badge tone="info">Awaiting reply…</Badge>
      )
    ) : null;

  const kindLabel =
    rec.kind === "reschedule" ? "Reschedule" : rec.kind === "waitlist_fill" ? "Waitlist backfill" : rec.kind === "confirm_nudge" ? "Confirmation nudge" : "Preventive outreach";

  return (
    <div className={cn("animate-scd-in rounded-card border bg-white p-4 shadow-ambient", decided ? "border-scd-line/60" : "border-scd-primary/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-extrabold text-scd-ink">{p.patientName ?? "Patient"}</span>
        <Badge tone="primary">{kindLabel}</Badge>
        {p.type && <Badge tone={p.type === "urgent" ? "danger" : "neutral"}>{typeLabel(p.type)}</Badge>}
        {(p.tags ?? []).map((t: string) => (
          <Badge key={t} tone="info">{t}</Badge>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <StatusBadge status={rec.status} />
          {outcomeBadge}
        </span>
      </div>

      {p.priorityReason && <p className="mt-1.5 text-[12px] text-scd-muted">{p.priorityReason}</p>}
      {p.replanNote && <p className="mt-1 text-[12px] font-semibold text-scd-info">Replanned after patient asked: {p.replanNote}</p>}

      {/* From → To */}
      {rec.kind === "reschedule" && chosen && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-scd-bg px-3 py-2 text-[13px]">
          <span className="text-scd-muted line-through">{p.from?.when}</span>
          <span className="text-scd-primary">→</span>
          <span className="font-bold text-scd-ink">{fmtWhenManila(chosen.startUtc)}</span>
          <span className="text-scd-muted">with {chosen.doctorName}</span>
          <span className="ml-auto flex items-center gap-2">
            <FitDots dots={chosen.dots} />
            <button onClick={() => setShowWhy((v) => !v)} className="rounded-pill bg-scd-lavender px-2 py-0.5 text-[11px] font-bold text-scd-deep hover:bg-[#e2d9ff]">
              Why?
            </button>
          </span>
        </div>
      )}
      {rec.kind === "waitlist_fill" && (
        <div className="mt-3 rounded-xl bg-scd-bg px-3 py-2 text-[13px]">
          Offer <b>{p.when}</b> with {p.doctorName} to <b>{p.patientName}</b>
          <span className="text-scd-muted"> — {p.rationale}</span>
        </div>
      )}
      {(rec.kind === "confirm_nudge" || rec.kind === "preventive") && (
        <div className="mt-3 rounded-xl bg-scd-bg px-3 py-2 text-[13px]">
          {p.from?.when} with {p.from?.doctorName}
          {p.riskFlag && <span className="text-scd-muted"> — risk {p.riskFlag.score}/100</span>}
        </div>
      )}

      {showWhy && chosen && (
        <div className="mt-2 animate-scd-in">
          <div className="flex flex-wrap gap-1.5">
            {(chosen.chips ?? []).map((c: any, i: number) => (
              <WhyChip key={i} label={c.label} pts={c.pts} />
            ))}
          </div>
          {p.rationale && <p className="mt-1.5 text-[12px] italic text-scd-muted">{p.rationale}</p>}
          {p.reorderReason && <p className="mt-1 text-[12px] text-scd-info">{p.reorderReason}</p>}
        </div>
      )}

      {/* Draft preview */}
      {p.draft && (
        <button onClick={() => setShowDraft((v) => !v)} className="mt-2 text-[12px] font-semibold text-scd-primary hover:underline">
          {showDraft ? "Hide" : "Preview"} patient message
        </button>
      )}
      {showDraft && p.draft && (
        <div className="mt-1.5 animate-scd-in rounded-xl border border-scd-line bg-scd-bg/70 p-3">
          <p className="text-[12px] font-bold text-scd-ink">{p.draft.subject}</p>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-scd-ink/80">{p.draft.body}</p>
        </div>
      )}

      {/* Decision reason on decided cards */}
      {decided && rec.decisionReason && (
        <p className="mt-2 text-[12px] text-scd-muted">
          <b>Staff note:</b> {rec.decisionReason}
        </p>
      )}

      {errText && <p className="mt-2 text-[12px] font-semibold text-scd-danger">{errText}</p>}

      {/* Actions */}
      {!decided && (
        <div className="mt-3">
          {mode === "none" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="success" disabled={!!busy} onClick={() => decide("approve")}>
                {busy === "approve" ? <Spinner /> : "Approve"}
              </Button>
              {rec.kind === "reschedule" && (p.options ?? []).length > 1 && (
                <Button variant="outline" disabled={!!busy} onClick={() => setMode("modify")}>
                  Modify time
                </Button>
              )}
              <Button variant="ghost" className="text-scd-danger" disabled={!!busy} onClick={() => setMode("reject")}>
                Reject
              </Button>
            </div>
          )}
          {mode === "modify" && (
            <div className="animate-scd-in rounded-xl border border-scd-line bg-scd-bg/60 p-3">
              <p className="text-[12px] font-bold text-scd-ink">Pick another validated option — every choice below already passed the placement rules.</p>
              <div className="mt-2 space-y-1.5">
                {(p.options ?? []).map((o: any) => (
                  <label key={o.id} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2", optionId === o.id ? "border-scd-primary bg-white" : "border-transparent bg-white/60 hover:border-scd-line")}>
                    <input type="radio" name={`opt-${rec.id}`} checked={optionId === o.id} onChange={() => setOptionId(o.id)} className="accent-scd-primary" />
                    <span className="text-[13px] font-semibold text-scd-ink">{fmtWhenManila(o.startUtc)}</span>
                    <span className="text-[12px] text-scd-muted">{o.doctorName}</span>
                    <span className="ml-auto">
                      <FitDots dots={o.dots} />
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" disabled={!!busy || !optionId} onClick={() => decide("modify")}>
                  {busy === "modify" ? <Spinner /> : "Use this time"}
                </Button>
                <Button variant="ghost" onClick={() => setMode("none")}>Back</Button>
              </div>
            </div>
          )}
          {mode === "reject" && (
            <div className="animate-scd-in rounded-xl border border-scd-line bg-scd-bg/60 p-3">
              <p className="text-[12px] font-bold text-scd-ink">Why reject? The reason is logged and shown to the team.</p>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Patient prefers a call — will phone her instead"
                className="mt-2 w-full rounded-xl border border-scd-line bg-white px-3 py-2 text-[13px] outline-none focus:border-scd-primary"
              />
              <div className="mt-2 flex gap-2">
                <Button variant="danger" disabled={!!busy || reason.trim().length < 3} onClick={() => decide("reject")}>
                  {busy === "reject" ? <Spinner /> : "Reject with reason"}
                </Button>
                <Button variant="ghost" onClick={() => setMode("none")}>Back</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Explicit Gmail send (live mode only leaves drafts) */}
      {outboundDraft && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-scd-info/40 bg-[#EFF4FD] px-3 py-2">
          <span className="text-[12px] font-semibold text-scd-info">Gmail draft is ready — nothing goes to the patient until you press Send.</span>
          <Button variant="primary" className="ml-auto" disabled={busy === "send"} onClick={sendDraft}>
            {busy === "send" ? <Spinner /> : "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}
