"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePoll, useFeed } from "@/lib/usePoll";
import { jfetch, fmtWhenManila, agentLabel } from "@/lib/format";
import { Button, Chip, Empty, Modal, RailRow, RescheduleLine, Spinner, Tabs, cn } from "@/components/ui";
import { CASE_STATE, isPlainEntry, outcomeLabel, plainDetail, plainTitle } from "@/components/copy";
import { DecisionCard } from "@/components/DecisionCard";

type Tab = "activity" | "messages";

function SummaryLine({ s, state }: { s: any; state: string }) {
  if (!s || s.affected === 0) return null;
  const bits = [
    `${s.affected} patient${s.affected === 1 ? "" : "s"}`,
    s.confirmed > 0 && `${s.confirmed} confirmed`,
    s.rebooked - s.confirmed > 0 && `${s.rebooked - s.confirmed} waiting to hear back`,
    s.declinedOrCallback > 0 && `${s.declinedOrCallback} to call`,
    state === "resolved" && s.minutesRecovered > 0 && `${s.minutesRecovered} care minutes saved`,
  ].filter(Boolean);
  return <p className="text-[13px] text-muted">{bits.join(" · ")}</p>;
}

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { data, refresh } = usePoll<any>(id ? `/api/cases/${id}` : null, 1800);
  const feed = useFeed(id);
  const [tab, setTab] = useState<Tab>("activity");
  const [tech, setTech] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [busyPatient, setBusyPatient] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  const c = data?.case;
  const recs = data?.recommendations ?? [];
  const messages = data?.messages ?? [];
  const conversations = data?.conversations ?? [];
  const proposed = recs.filter((r: any) => r.status === "proposed");
  const decidedSubstantive = recs.filter((r: any) => r.status !== "proposed" && r.outcome !== "superseded");

  const activity = useMemo(() => (tech ? feed.items : feed.items.filter(isPlainEntry)), [feed.items, tech]);

  if (!c) return <Empty>Loading…</Empty>;
  const st = CASE_STATE[c.state] ?? { label: c.state, tone: "neutral" as const };

  async function approveAll() {
    setBusyAll(true);
    try {
      await jfetch(`/api/cases/${c.id}/approve-all`, { method: "POST" });
      refresh();
    } finally {
      setBusyAll(false);
    }
  }
  async function markHandled() {
    await jfetch(`/api/cases/${c.id}/resolve`, { method: "POST" });
    setResolveOpen(false);
    refresh();
  }
  async function patientAction(patientId: string, action: "mark_called" | "mark_handled" | "release_hold") {
    setBusyPatient(`${patientId}:${action}`);
    try {
      await jfetch(`/api/cases/${c.id}/patients/${patientId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      refresh();
    } finally {
      setBusyPatient(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link href="/ops" className="text-[13px] font-semibold text-accent hover:underline">
          ‹ Front desk
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">{c.title}</h1>
          <Chip tone={st.tone}>{st.label}</Chip>
        </div>
        <div className="mt-1"><SummaryLine s={data?.scoreboard} state={c.state} /></div>
      </div>

      {/* Escalated banner */}
      {c.state === "escalated" && (
        <RailRow tone="bad" className="flex items-center gap-3 px-4 py-3">
          <p className="text-[14px] font-semibold text-ink">This one needs a person — the system stopped on purpose.</p>
          {conversations.length === 0 && (
            <Button variant="secondary" small className="ml-auto" onClick={() => setResolveOpen(true)}>
              Mark handled
            </Button>
          )}
        </RailRow>
      )}

      {/* Decisions */}
      {proposed.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">For your review</h2>
            {proposed.length > 1 && (
              <Button small disabled={busyAll} onClick={approveAll}>
                {busyAll ? <Spinner /> : `Approve all ${proposed.length}`}
              </Button>
            )}
          </div>
          {proposed.map((r: any) => (
            <DecisionCard key={r.id} rec={r} messages={messages} onDone={refresh} />
          ))}
        </section>
      )}

      {/* Patients (post-decision outcomes) */}
      {decidedSubstantive.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="eyebrow">Patients</h2>
          {decidedSubstantive.map((r: any) => {
            const p = r.payload ?? {};
            const oc = outcomeLabel(r);
            const to = (p.options ?? []).find((o: any) => o.id === (p.executedOptionId ?? p.modifiedOptionId ?? p.chosenOptionId));
            const conversation = conversations.find((x: any) => x.patientId === r.patientId);
            const actions = conversation?.currentRecommendationId === r.id ? conversation.actions : null;
            return (
              <RailRow key={r.id} tone={oc.tone} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-ink">{p.patientName}</p>
                  {r.kind === "reschedule" && to ? (
                    <RescheduleLine fromLabel={p.from?.when} toUtc={to.startUtc} doctorName={to.doctorName} />
                  ) : (
                    <p className="tnum text-[13px] text-muted">{p.when ?? p.from?.when ?? ""}</p>
                  )}
                </div>
                <Chip tone={oc.tone}>{oc.label}</Chip>
                </div>
                {actions && (actions.markCalled || actions.markHandled || actions.releaseHold) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {actions.markCalled && (
                      <Button variant="secondary" small disabled={!!busyPatient} onClick={() => patientAction(r.patientId, "mark_called")}>
                        {busyPatient === `${r.patientId}:mark_called` ? <Spinner /> : "Mark called"}
                      </Button>
                    )}
                    {actions.markHandled && (
                      <Button variant="secondary" small disabled={!!busyPatient} onClick={() => patientAction(r.patientId, "mark_handled")}>
                        {busyPatient === `${r.patientId}:mark_handled` ? <Spinner /> : "Mark handled"}
                      </Button>
                    )}
                    {actions.releaseHold && (
                      <Button variant="danger" small disabled={!!busyPatient} onClick={() => patientAction(r.patientId, "release_hold")}>
                        {busyPatient === `${r.patientId}:release_hold` ? <Spinner /> : "Release hold"}
                      </Button>
                    )}
                  </div>
                )}
              </RailRow>
            );
          })}
        </section>
      )}

      {/* Tabs: Activity | Messages */}
      <section>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "activity", label: "Activity" },
            { id: "messages", label: "Messages", count: messages.length },
          ]}
          right={
            tab === "activity" ? (
              <label className="flex cursor-pointer items-center gap-1.5 pb-2 text-[12px] font-semibold text-muted">
                <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} className="accent-[#1D4ED8]" />
                Technical detail
              </label>
            ) : undefined
          }
        />

        {tab === "activity" && (
          <div className="mt-3">
            {activity.length === 0 && <Empty>Activity will appear here as the case moves.</Empty>}
            <ol className="relative ml-1.5 space-y-0 border-l border-line">
              {activity.map((it) => (
                <li key={it.id} className="relative py-1.5 pl-4">
                  <span className="absolute -left-[3px] top-[13px] h-[5px] w-[5px] rounded-full bg-line" aria-hidden />
                  <div className="flex items-baseline gap-2">
                    {tech && <Chip tone="neutral" className="!px-1.5 !text-[10px]">{agentLabel(it.actor)}</Chip>}
                    <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{plainTitle(it)}</p>
                    <span className="tnum shrink-0 text-[11px] text-muted">
                      {new Date(it.at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}
                    </span>
                  </div>
                  {(tech ? it.detail : plainDetail(it)) && (
                    <p className="mt-0.5 text-[12px] leading-snug text-muted">{tech ? it.detail : plainDetail(it)}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {tab === "messages" && (
          <div className="mt-3 space-y-4">
            {conversations.length === 0 && <Empty>No patient conversations yet.</Empty>}
            {conversations.map((conversation: any) => {
              const latestRec = conversation.recommendations.at(-1);
              const oc = latestRec ? outcomeLabel(latestRec) : null;
              return (
                <section key={conversation.patientId} className="rounded-card border border-line bg-paper p-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-bold text-ink">{conversation.patientName}</h3>
                    {oc && <Chip tone={oc.tone}>{oc.label}</Chip>}
                  </div>
                  <div className="mt-2 space-y-2">
                    {conversation.messages.length === 0 && (
                      <p className="text-[13px] text-muted">No email sent for this patient.</p>
                    )}
                    {conversation.messages.map((m: any) => (
                      <div key={m.id} className={cn("max-w-[92%] rounded-card border p-3", m.direction === "inbound" ? "border-line bg-white" : "ml-auto border-accent-line bg-accent-soft/60")}>
                        <div className="flex items-center gap-2 text-[12px] text-muted">
                          <b className="text-ink/80">{m.direction === "inbound" ? "Patient" : "Clinic"}</b>
                          {m.status === "draft_created" && <Chip tone="warn">Draft — not sent</Chip>}
                          <span className="tnum ml-auto">{fmtWhenManila(m.createdAt)}</span>
                        </div>
                        {m.subject && <p className="mt-1 text-[13px] font-bold text-ink">{m.subject}</p>}
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/85">
                          {m.body || "No new text above the quoted history."}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Mark this case handled?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>Back</Button>
            <Button onClick={markHandled}>Yes, it&apos;s handled</Button>
          </>
        }
      >
        <p>Use this after you&apos;ve sorted it out by phone or in person. The record stays in Done.</p>
      </Modal>
    </div>
  );
}
