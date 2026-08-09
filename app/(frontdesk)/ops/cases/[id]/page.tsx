"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePoll, useFeed } from "@/lib/usePoll";
import { jfetch, fmtWhenManila, agentLabel } from "@/lib/format";
import {
  Avatar,
  Button,
  Card,
  Chip,
  ChoiceCard,
  Disclosure,
  Empty,
  Eyebrow,
  Field,
  Modal,
  RailRow,
  RescheduleLine,
  Select,
  SegmentBar,
  Spinner,
  cn,
} from "@/components/ui";
import { CaseIcon } from "@/components/CaseIcon";
import {
  CASE_STATE,
  isPlainEntry,
  outcomeLabel,
  plainDetail,
  plainTitle,
} from "@/components/copy";
import { DecisionCard } from "@/components/DecisionCard";
import { ConstraintEditor } from "@/components/ConstraintEditor";

type Tab = "activity" | "messages";
type FollowUpOutcome =
  | "accept_current"
  | "decline"
  | "choose_another"
  | "no_answer";

function buildPatientIndex(recs: any[], messages: any[]) {
  const recToPatient = new Map(
    recs.map((r: any) => [
      r.id,
      { patientId: r.patientId, patientName: r.payload?.patientName },
    ]),
  );
  const apptToPatient = new Map<
    string,
    { patientId: string; patientName: string }
  >();
  for (const r of recs) {
    const p = r.payload ?? {};
    if (p.patientId) {
      if (p.appointmentId)
        apptToPatient.set(p.appointmentId, {
          patientId: p.patientId,
          patientName: p.patientName,
        });
      if (p.createdAppointmentId)
        apptToPatient.set(p.createdAppointmentId, {
          patientId: p.patientId,
          patientName: p.patientName,
        });
    }
  }
  const msgToPatient = new Map(
    messages.map((m: any) => [
      m.id,
      {
        patientId: m.patientId,
        patientName: recToPatient.get(m.recommendationId)?.patientName,
      },
    ]),
  );

  return (refs: any): { patientId: string; patientName: string } | null => {
    if (!refs) return null;
    if (refs.recommendationId && recToPatient.has(refs.recommendationId))
      return recToPatient.get(refs.recommendationId)!;
    if (refs.appointmentId && apptToPatient.has(refs.appointmentId))
      return apptToPatient.get(refs.appointmentId)!;
    if (refs.messageId && msgToPatient.has(refs.messageId))
      return msgToPatient.get(refs.messageId)!;
    return null;
  };
}

function groupActivity(
  items: any[],
  resolvePatient: ReturnType<typeof buildPatientIndex>,
) {
  const caseLevel: any[] = [];
  const byPatient = new Map<string, { patientName: string; items: any[] }>();
  for (const it of items) {
    const p = resolvePatient(it.refs);
    if (!p) {
      caseLevel.push(it);
      continue;
    }
    if (!byPatient.has(p.patientId))
      byPatient.set(p.patientId, {
        patientName: p.patientName ?? "Patient",
        items: [],
      });
    byPatient.get(p.patientId)!.items.push(it);
  }
  return { caseLevel, byPatient };
}

function ActivityRow({ it, tech }: { it: any; tech: boolean }) {
  return (
    <li className="relative py-1.5 pl-4">
      <span
        className="absolute -left-[3px] top-[13px] h-[5px] w-[5px] rounded-full bg-line"
        aria-hidden
      />
      <div className="flex items-baseline gap-2">
        {tech && (
          <Chip tone="neutral" className="!px-1.5 !text-micro">
            {agentLabel(it.actor)}
          </Chip>
        )}
        <p className="min-w-0 flex-1 text-sm leading-snug text-ink">
          {plainTitle(it)}
        </p>
        <span className="tnum shrink-0 text-xs text-muted">
          {new Date(it.at).toLocaleTimeString("en-PH", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "Asia/Manila",
          })}
        </span>
      </div>
      {(tech ? it.detail : plainDetail(it)) && (
        <p className="mt-0.5 text-xs leading-snug text-muted">
          {tech ? it.detail : plainDetail(it)}
        </p>
      )}
    </li>
  );
}

function SummaryLine({ s, state }: { s: any; state: string }) {
  if (!s || s.affected === 0) return null;
  const bits = [
    `${s.affected} patient${s.affected === 1 ? "" : "s"}`,
    s.confirmed > 0 && `${s.confirmed} confirmed`,
    s.rebooked - s.confirmed > 0 &&
      `${s.rebooked - s.confirmed} waiting to hear back`,
    s.declinedOrCallback > 0 && `${s.declinedOrCallback} to call`,
    state === "resolved" &&
      s.minutesRecovered > 0 &&
      `${s.minutesRecovered} care minutes saved`,
  ].filter(Boolean);
  return <p className="text-sm text-muted">{bits.join(" · ")}</p>;
}

function buildPatients(recs: any[], convs: any[]) {
  const map = new Map<
    string,
    { id: string; name: string; recs: any[]; conv?: any }
  >();
  for (const r of recs) {
    const p = r.payload ?? {};
    const pid = r.patientId;
    if (!map.has(pid))
      map.set(pid, {
        id: pid,
        name: p.patientName ?? "Patient",
        recs: [],
      });
    map.get(pid)!.recs.push(r);
  }
  for (const cv of convs) {
    const pid = cv.patientId;
    if (!map.has(pid))
      map.set(pid, {
        id: pid,
        name: cv.patientName ?? "Patient",
        recs: [],
      });
    map.get(pid)!.conv = cv;
  }
  return [...map.values()].map((p) => {
    let activeRec: any = null;
    if (p.conv?.recommendations?.length) {
      activeRec = p.conv.recommendations.at(-1);
    }
    if (!activeRec && p.conv?.currentRecommendationId) {
      activeRec = p.recs.find((r) => r.id === p.conv.currentRecommendationId);
    }
    if (!activeRec) {
      activeRec = p.recs.find((r) => r.status === "proposed") ?? p.recs[0] ?? null;
    }
    return { ...p, activeRec };
  });
}

function needsDecision(rec: any): boolean {
  return (
    !!rec &&
    (rec.status === "proposed" ||
      rec.outcome === "superseded" ||
      rec.outcome === "needs_human")
  );
}

function statusTitle(rec: any): string {
  if (rec.outcome === "superseded") return "Counter-offer — needs your review";
  const oc = outcomeLabel(rec);
  if (oc.label === "Confirmed") return "Confirmed";
  if (oc.label.startsWith("Declined")) return "Declined — needs a call";
  if (oc.label === "Message sent" || oc.label === "Waiting for reply")
    return "Approved — sent, no reply yet";
  return oc.label;
}

const dotToneClass: Record<string, string> = {
  warn: "bg-warn",
  accent: "bg-accent",
  ok: "bg-ok",
  bad: "bg-bad",
  neutral: "bg-line",
};

const statusToneClass: Record<string, string> = {
  warn: "border-warn-line bg-warn-soft",
  accent: "border-accent-line bg-accent-soft",
  ok: "border-ok-line bg-ok-soft",
  bad: "border-bad-line bg-bad-soft",
  neutral: "border-line bg-surface-alt",
};

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const {
    data,
    refresh,
    error: loadError,
  } = usePoll<any>(id ? `/api/cases/${id}` : null, 1800);
  const feed = useFeed(id);
  const [tab, setTab] = useState<Tab>("activity");
  const [tech, setTech] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState(true);
  const [busyAll, setBusyAll] = useState(false);
  const [busyPatient, setBusyPatient] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [followUp, setFollowUp] = useState<any | null>(null);
  const [followOutcome, setFollowOutcome] = useState<FollowUpOutcome | null>(
    null,
  );
  const [followSlots, setFollowSlots] = useState<any[]>([]);
  const [followSlot, setFollowSlot] = useState("");
  const [followError, setFollowError] = useState<string | null>(null);

  const c = data?.case;
  const recs = data?.recommendations ?? [];
  const messages = data?.messages ?? [];
  const conversations = data?.conversations ?? [];
  const proposed = recs.filter((r: any) => r.status === "proposed");
  const decidedSubstantive = recs.filter(
    (r: any) =>
      r.status !== "proposed" && r.outcome !== "superseded" && !r.supersededBy,
  );
  const activity = useMemo(
    () => (tech ? feed.items : feed.items.filter(isPlainEntry)),
    [feed.items, tech],
  );

  const resolvePatient = useMemo(
    () => buildPatientIndex(recs, messages),
    [recs, messages],
  );
  const grouped = useMemo(
    () => groupActivity(activity, resolvePatient),
    [activity, resolvePatient],
  );

  const patients = useMemo(
    () => buildPatients(recs, conversations),
    [recs, conversations],
  );

  const metrics = useMemo(() => {
    if (patients.length === 0) return null;
    const total = patients.length;
    let confirmed = 0;
    let waitingForYou = 0;
    let waitingOnPatient = 0;
    let toCall = 0;
    for (const p of patients) {
      const rec = p.activeRec;
      if (!rec) continue;
      if (needsDecision(rec)) {
        waitingForYou++;
        continue;
      }
      const oc = outcomeLabel(rec);
      if (oc.label === "Confirmed") confirmed++;
      else if (oc.label.startsWith("Declined")) toCall++;
      else if (oc.label === "Message sent" || oc.label === "Waiting for reply")
        waitingOnPatient++;
    }
    return { total, confirmed, waitingForYou, waitingOnPatient, toCall };
  }, [patients]);

  useEffect(() => {
    if (!data || patients.length === 0) return;
    if (!selectedId) {
      const needsReview = patients.find((p) => needsDecision(p.activeRec));
      setSelectedId((needsReview ?? patients[0]).id);
    }
  }, [data, patients, selectedId]);

  useEffect(() => {
    if (!followUp || followOutcome !== "choose_another") return;
    const appointment = followUp.currentAppointment;
    if (!appointment) return;
    const activeAppointment = ["booked", "confirmed"].includes(
      appointment.status,
    );
    const ignore = activeAppointment
      ? `&ignoreAppointmentId=${appointment.id}`
      : "";
    setFollowSlots([]);
    setFollowSlot("");
    setFollowError(null);
    jfetch<any>(
      `/api/slots?doctorId=${appointment.doctorId}&type=${appointment.type}${ignore}`,
    )
      .then((result) => setFollowSlots(result.slots ?? []))
      .catch((error) => setFollowError((error as Error).message));
  }, [followUp, followOutcome]);

  // A bad case id previously sat on "Loading…" forever, because the poll error
  // was never read. Say what happened and offer the way back.
  if (!c) {
    if (loadError) {
      return (
        <Empty
          action={
            <Link href="/ops">
              <Button variant="secondary" tabIndex={-1}>
                Back to front desk
              </Button>
            </Link>
          }
        >
          We couldn&apos;t open this case — it may have been reset or removed.
        </Empty>
      );
    }
    return <Empty>Loading…</Empty>;
  }
  const st = CASE_STATE[c.state] ?? {
    label: c.state,
    tone: "neutral" as const,
  };

  const selectedPatient =
    patients.find((p) => p.id === selectedId) ?? patients[0] ?? null;

  function togglePatient(id: string) {
    setSelectedId(id);
    setTab("activity");
  }

  async function approveAll() {
    setBusyAll(true);
    setApproveAllOpen(false);
    try {
      await jfetch(`/api/cases/${c.id}/approve-all`, { method: "POST" });
      refresh();
    } finally {
      setBusyAll(false);
    }
  }
  async function resolveCase() {
    await jfetch(`/api/cases/${c.id}/resolve`, { method: "POST" });
    setResolveOpen(false);
    refresh();
  }
  async function submitFollowUp() {
    if (!followUp || !followOutcome) return;
    setBusyPatient(followUp.patientId);
    setFollowError(null);
    try {
      await jfetch(
        `/api/cases/${c.id}/patients/${followUp.patientId}/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            action: followOutcome,
            startUtc:
              followOutcome === "choose_another" ? followSlot : undefined,
          }),
        },
      );
      setFollowUp(null);
      setFollowOutcome(null);
      setFollowSlot("");
      refresh();
    } catch (error) {
      setFollowError((error as Error).message);
    } finally {
      setBusyPatient(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-2.5">
        <Link
          href="/ops"
          className="inline-flex w-fit items-center gap-1 rounded-ctl text-sm font-semibold text-accent hover:underline"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Front desk
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <CaseIcon type={c.type} tone={st.tone} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold text-ink">{c.title}</h1>
              <Chip tone={st.tone}>{st.label}</Chip>
            </div>
            <SummaryLine s={data?.scoreboard} state={c.state} />
          </div>
          {proposed.length > 1 && (
            <Button
              disabled={busyAll}
              loading={busyAll}
              onClick={() => setApproveAllOpen(true)}
            >
              Approve all {proposed.length}
            </Button>
          )}
        </div>
      </div>

      {/* The recovery scoreboard PRODUCT.md asks for, as a proportion rather
          than five tiles: how far this disruption has been walked back. */}
      {metrics && (
        <SegmentBar
          caption="Recovery"
          total={metrics.total}
          totalLabel={metrics.total === 1 ? "patient affected" : "patients affected"}
          right={
            metrics.confirmed === metrics.total && metrics.total > 0 ? (
              <Chip tone="ok">Everyone rebooked</Chip>
            ) : undefined
          }
          segments={[
            { label: "confirmed", value: metrics.confirmed, tone: "ok" },
            {
              label: "waiting on patient",
              value: metrics.waitingOnPatient,
              tone: "accent",
            },
            {
              label: "waiting for you",
              value: metrics.waitingForYou,
              tone: "warn",
            },
            { label: "to call", value: metrics.toCall, tone: "bad" },
          ]}
        />
      )}

      {/* Escalated banner */}
      {c.state === "escalated" && (
        <RailRow
          tone="bad"
          className="flex flex-wrap items-center gap-3 px-4 py-3"
        >
          <p className="flex-1 text-base font-semibold text-ink">
            This one needs a person — the system stopped on purpose.
          </p>
          {conversations.length === 0 && (
            <Button
              variant="secondary"
              small
              onClick={() => setResolveOpen(true)}
            >
              Resolve manually
            </Button>
          )}
        </RailRow>
      )}

      {/* Constraint reviews */}
      {Object.values(data?.case?.meta?.constraintsByAppt ?? {})
        .filter((e: any) => e.disposition === "constraint_review")
        .map((entry: any) => (
          <ConstraintEditor
            key={`${entry.appointmentId}:${entry.extractedAt ?? ""}`}
            caseId={id as string}
            latest={entry}
            conversations={conversations}
            onDone={refresh}
          />
        ))}

      {/* Patient list + panel */}
      {patients.length > 0 && (
        <div className="grid items-start gap-3 lg:grid-cols-[264px_1fr]">
          <aside className="flex flex-col gap-2">
            <Eyebrow className="px-0.5">
              Patients in this case · {patients.length}
            </Eyebrow>
            {/* Horizontal strip on narrow screens so the decision panel stays
                above the fold; a vertical list once there is room beside it. */}
            <div className="scroll-quiet flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {patients.map((p) => {
                const oc = p.activeRec
                  ? outcomeLabel(p.activeRec)
                  : { label: "No action", tone: "neutral" as const };
                const isActive = selectedId === p.id;
                const decides = needsDecision(p.activeRec);
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePatient(p.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex w-[220px] shrink-0 items-center gap-2.5 rounded-card border px-3 py-2.5 text-left lg:w-auto",
                      "transition-colors duration-fast ease-snappy",
                      isActive
                        ? "border-accent bg-accent-soft"
                        : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <Avatar name={p.name} size={32} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm font-semibold text-ink">
                        {p.name}
                      </b>
                      <span
                        className={cn(
                          "block truncate text-xs",
                          decides ? "font-semibold text-warn" : "text-muted",
                        )}
                      >
                        {decides ? "Needs your decision" : oc.label}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        dotToneClass[oc.tone] ?? "bg-line",
                      )}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </aside>

          <div>
            {selectedPatient ? (
              <Card className="overflow-hidden">
                {/* Panel head */}
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5">
                  <Avatar name={selectedPatient.name} size={36} />
                  <div className="min-w-0">
                    <h2 className="text-md font-bold text-ink">
                      {selectedPatient.name}
                    </h2>
                    <span className="text-sm text-muted">
                      {selectedPatient.activeRec?.payload?.from?.when
                        ? `Originally ${selectedPatient.activeRec.payload.from.when}`
                        : "Patient"}
                    </span>
                  </div>
                  {selectedPatient.activeRec && (
                    <Chip
                      tone={outcomeLabel(selectedPatient.activeRec).tone}
                      className="ml-auto"
                    >
                      {statusTitle(selectedPatient.activeRec)}
                    </Chip>
                  )}
                </div>

                {/* Decision / Status box */}
                <div className="p-4">
                  {needsDecision(selectedPatient.activeRec) ? (
                    <DecisionCard
                      rec={selectedPatient.activeRec}
                      messages={messages}
                      onDone={refresh}
                    />
                  ) : selectedPatient.activeRec ? (
                    (() => {
                      const rec = selectedPatient.activeRec;
                      const oc = outcomeLabel(rec);
                      const p = rec.payload ?? {};
                      const to = (p.options ?? []).find(
                        (o: any) =>
                          o.id ===
                          (p.executedOptionId ??
                            p.modifiedOptionId ??
                            p.chosenOptionId),
                      );
                      const theme = statusToneClass[oc.tone];
                      const wantsFollowUp =
                        selectedPatient.conv?.currentRecommendationId ===
                          rec.id &&
                        (oc.label === "Waiting for reply" ||
                          oc.label === "Message sent");
                      return (
                        <div
                          className={cn(
                            "rounded-card border px-4 py-3.5",
                            theme,
                          )}
                        >
                          <div className="eyebrow">{statusTitle(rec)}</div>
                          {rec.kind === "reschedule" && to && (
                            <RescheduleLine
                              fromLabel={p.from?.when}
                              toUtc={to.startUtc}
                              doctorName={to.doctorName}
                            />
                          )}
                          {rec.kind !== "reschedule" && (
                            <p className="tnum text-md font-bold text-ink">
                              {p.when ?? p.from?.when ?? "—"}
                            </p>
                          )}
                          {wantsFollowUp && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                small
                                disabled={!!busyPatient}
                                loading={busyPatient === rec.patientId}
                                onClick={() => {
                                  setFollowUp(selectedPatient.conv);
                                  setFollowOutcome(null);
                                  setFollowError(null);
                                }}
                              >
                                Follow up
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="rounded-card border border-line bg-surface-alt px-4 py-3 text-sm text-muted">
                      No active recommendation for this patient.
                    </div>
                  )}
                </div>

                {/* Thread tabs */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line bg-surface-alt px-4">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setTab("messages")}
                      className={cn(
                        "-mb-px border-b-2 px-2.5 py-2.5 text-base font-semibold transition-colors duration-fast",
                        tab === "messages"
                          ? "border-accent text-ink"
                          : "border-transparent text-muted hover:text-ink",
                      )}
                    >
                      Messages
                      {selectedPatient.conv?.messages?.length ? (
                        <span className="ml-1 text-xs text-muted">
                          {selectedPatient.conv.messages.length}
                        </span>
                      ) : null}
                    </button>
                    <button
                      onClick={() => setTab("activity")}
                      className={cn(
                        "-mb-px border-b-2 px-2.5 py-2.5 text-base font-semibold transition-colors duration-fast",
                        tab === "activity"
                          ? "border-accent text-ink"
                          : "border-transparent text-muted hover:text-ink",
                      )}
                    >
                      Agent activity
                      {grouped.byPatient.get(selectedPatient.id)?.items
                        .length ? (
                        <span className="ml-1 text-xs text-muted">
                          {
                            grouped.byPatient.get(selectedPatient.id)!.items
                              .length
                          }
                        </span>
                      ) : null}
                    </button>
                  </div>
                  {tab === "activity" && (
                    <label className="flex cursor-pointer select-none items-center gap-1.5 py-2 text-sm font-semibold text-muted">
                      <input
                        type="checkbox"
                        checked={tech}
                        onChange={(e) => setTech(e.target.checked)}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      Technical detail
                    </label>
                  )}
                </div>

                {/* Panel content */}
                <div className="px-4 py-4">
                  {tab === "messages" && (
                    <div className="flex flex-col gap-3">
                      {!selectedPatient.conv?.messages?.length && (
                        <Empty>No email sent for this patient.</Empty>
                      )}
                      {selectedPatient.conv?.messages?.map((m: any) => (
                        <div
                          key={m.id}
                          className={cn(
                            "max-w-[92%] rounded-card border p-3.5",
                            m.direction === "inbound"
                              ? "border-line bg-surface"
                              : "ml-auto border-accent-line bg-accent-soft/60",
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                            <b className="font-semibold text-ink-soft">
                              {m.direction === "inbound" ? "Patient" : "Clinic"}
                            </b>
                            {m.status === "draft_created" && (
                              <Chip tone="warn">Draft — not sent</Chip>
                            )}
                            <span className="tnum ml-auto font-mono text-xs">
                              {fmtWhenManila(m.createdAt)}
                            </span>
                          </div>
                          {m.subject && (
                            <p className="mt-1.5 text-base font-bold text-ink">
                              {m.subject}
                            </p>
                          )}
                          <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-ink-soft">
                            {m.body ||
                              "No new text above the quoted history."}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {tab === "activity" && (
                    <div className="space-y-1">
                      {grouped.byPatient.get(selectedPatient.id)?.items
                        ?.length ? (
                        <ol className="relative ml-1.5 space-y-0 border-l border-line px-3">
                          {grouped.byPatient
                            .get(selectedPatient.id)!
                            .items.map((it) => (
                              <ActivityRow key={it.id} it={it} tech={tech} />
                            ))}
                        </ol>
                      ) : (
                        <Empty>Activity will appear here as the case moves.</Empty>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              <Empty>No patients in this case.</Empty>
            )}
          </div>
        </div>
      )}

      {/* Case-level activity — everything not attributable to one patient. */}
      {grouped.caseLevel.length > 0 && (
        <Disclosure
          open={caseOpen}
          onToggle={() => setCaseOpen((v) => !v)}
          label="Case log"
          count={grouped.caseLevel.length}
        >
          <ol className="relative ml-1.5 border-l border-line px-3">
            {grouped.caseLevel.map((it) => (
              <ActivityRow key={it.id} it={it} tech={tech} />
            ))}
          </ol>
        </Disclosure>
      )}

      {/* Approve all modal */}
      <Modal
        open={approveAllOpen}
        onClose={() => setApproveAllOpen(false)}
        title={`Approve all ${proposed.length} suggestion${proposed.length === 1 ? "" : "s"}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setApproveAllOpen(false)}>
              Back
            </Button>
            <Button variant="success" disabled={busyAll} onClick={approveAll}>
              {busyAll ? <Spinner /> : "Yes — approve all"}
            </Button>
          </>
        }
      >
        <p>
          Every pending suggestion on this case will be executed: calendar holds
          booked and patient emails sent for each one. You can still handle each
          patient&apos;s reply individually afterwards.
        </p>
      </Modal>

      {/* Resolve modal */}
      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Resolve this case manually?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>
              Back
            </Button>
            <Button onClick={resolveCase}>Yes, resolve it</Button>
          </>
        }
      >
        <p>
          Use this after you&apos;ve sorted it out by phone or in person. The
          record stays in Done.
        </p>
      </Modal>

      {/* Follow-up modal */}
      <Modal
        open={!!followUp}
        onClose={() => {
          setFollowUp(null);
          setFollowOutcome(null);
          setFollowError(null);
        }}
        title={`Follow up with ${followUp?.patientName ?? "patient"}`}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setFollowUp(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !!busyPatient ||
                !followOutcome ||
                (followOutcome === "choose_another" && !followSlot)
              }
              onClick={submitFollowUp}
            >
              {busyPatient ? (
                <Spinner />
              ) : followOutcome === "no_answer" ? (
                "Record attempt"
              ) : (
                "Save outcome"
              )}
            </Button>
          </>
        }
      >
        {followError && (
          <p
            role="alert"
            className="mb-3 rounded-ctl border border-bad-line bg-bad-soft px-3 py-2 text-sm font-semibold text-bad"
          >
            {followError}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {followUp?.activeHold && (
            <ChoiceCard
              selected={followOutcome === "accept_current"}
              onClick={() => setFollowOutcome("accept_current")}
              title="Accepted current time"
              detail="Confirm the temporary hold."
            />
          )}
          <ChoiceCard
            selected={followOutcome === "decline"}
            onClick={() => setFollowOutcome("decline")}
            title="Declined"
            detail={
              followUp?.activeHold
                ? "Release the temporary hold."
                : "Record as handled manually."
            }
          />
          {followUp?.currentAppointment && (
            <ChoiceCard
              selected={followOutcome === "choose_another"}
              onClick={() => setFollowOutcome("choose_another")}
              title="Choose another time"
              detail="Book a valid confirmed time."
            />
          )}
          <ChoiceCard
            selected={followOutcome === "no_answer"}
            onClick={() => setFollowOutcome("no_answer")}
            title="No answer"
            detail="Keep this open for later."
          />
        </div>
        {followOutcome === "choose_another" && (
          <Field
            label="Valid date and time"
            className="mt-4"
            hint="Only times the validator accepts are listed."
          >
            {(fieldId) => (
              <Select
                id={fieldId}
                value={followSlot}
                onChange={(event) => setFollowSlot(event.target.value)}
              >
                <option value="">Select a time</option>
                {followSlots.map((slot: any) => (
                  <option key={slot.startUtc} value={slot.startUtc}>
                    {fmtWhenManila(slot.startUtc)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </Modal>
    </div>
  );
}
