"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePoll, useFeed } from "@/lib/usePoll";
import { jfetch, fmtWhenManila, agentLabel } from "@/lib/format";
import {
  Button,
  Chip,
  Empty,
  Modal,
  RailRow,
  RescheduleLine,
  Spinner,
  Tabs,
  cn,
} from "@/components/ui";
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
type DraftingState = {
  patientId: string;
  previousRecommendationId: string;
  operation: "replan" | "negotiate";
};

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
          <Chip tone="neutral" className="!px-1.5 !text-[10px]">
            {agentLabel(it.actor)}
          </Chip>
        )}
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
          {plainTitle(it)}
        </p>
        <span className="tnum shrink-0 text-[11px] text-muted">
          {new Date(it.at).toLocaleTimeString("en-PH", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "Asia/Manila",
          })}
        </span>
      </div>
      {(tech ? it.detail : plainDetail(it)) && (
        <p className="mt-0.5 break-words text-[12px] leading-snug text-muted">
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
  ].filter(Boolean);
  return <p className="text-[13px] text-muted">{bits.join(" · ")}</p>;
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
      activeRec = [...p.recs]
        .reverse()
        .find((r) => r.outcome !== "superseded" && !r.supersededBy) ?? null;
    }
    return { ...p, activeRec };
  });
}

function needsDecision(rec: any): boolean {
  return !!rec && rec.status === "proposed";
}

function statusTitle(rec: any): string {
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
  const { data, refresh } = usePoll<any>(id ? `/api/cases/${id}` : null, 1800);
  const feed = useFeed(id);
  const [tab, setTab] = useState<Tab>("activity");
  const [tech, setTech] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState(true);
  const [busyAll, setBusyAll] = useState(false);
  const [busyPatient, setBusyPatient] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [constraintOpen, setConstraintOpen] = useState<any | null>(null);
  const [drafting, setDrafting] = useState<DraftingState | null>(null);
  const [draftingSlow, setDraftingSlow] = useState(false);
  const [followUp, setFollowUp] = useState<any | null>(null);
  const [followOutcome, setFollowOutcome] = useState<FollowUpOutcome | null>(
    null,
  );
  const [followSlots, setFollowSlots] = useState<any[]>([]);
  const [followSlot, setFollowSlot] = useState("");
  const [followError, setFollowError] = useState<string | null>(null);
  const messagePanelRef = useRef<HTMLDivElement>(null);

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
    () =>
      (tech ? feed.items : feed.items.filter(isPlainEntry)).slice().reverse(),
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
  const selectedPatient =
    patients.find((p) => p.id === selectedId) ?? patients[0] ?? null;
  const pendingConstraints = useMemo(
    () =>
      Object.values(data?.case?.meta?.constraintsByAppt ?? {}).filter(
        (entry: any) =>
          entry.disposition === "constraint_review" && !entry.reviewedAt,
      ) as any[],
    [data?.case?.meta?.constraintsByAppt],
  );

  useEffect(() => {
    if (!drafting) return;
    const current = conversations.find(
      (conversation: any) => conversation.patientId === drafting.patientId,
    )?.currentRecommendationId;
    if (current && current !== drafting.previousRecommendationId) {
      setDrafting(null);
      setDraftingSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setDraftingSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [conversations, drafting]);

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
      if (pendingConstraints.some((entry) => entry.patientId === p.id)) {
        waitingForYou++;
        continue;
      }
      if (needsDecision(rec)) {
        waitingForYou++;
        continue;
      }
      const oc = outcomeLabel(rec);
      if (oc.label === "Confirmed") confirmed++;
      else if (
        oc.label.startsWith("Declined") ||
        oc.label === "Needs a person"
      )
        toCall++;
      else if (oc.label === "Message sent" || oc.label === "Waiting for reply")
        waitingOnPatient++;
    }
    return { total, confirmed, waitingForYou, waitingOnPatient, toCall };
  }, [patients, pendingConstraints]);

  useEffect(() => {
    if (!data || patients.length === 0) return;
    if (!selectedId) {
      const needsReview = patients.find((p) =>
        pendingConstraints.some((entry) => entry.patientId === p.id),
      );
      const needsAction = patients.find((p) => needsDecision(p.activeRec));
      setSelectedId((needsReview ?? needsAction ?? patients[0]).id);
    }
  }, [data, patients, pendingConstraints, selectedId]);

  useEffect(() => {
    if (tab !== "messages") return;
    const panel = messagePanelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [tab, selectedId, selectedPatient?.conv?.messages?.length]);

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

  if (!c) return <Empty>Loading…</Empty>;
  const st = CASE_STATE[c.state] ?? {
    label: c.state,
    tone: "neutral" as const,
  };

  function togglePatient(id: string) {
    setSelectedId(id);
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
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/ops"
          className="text-[13px] font-semibold text-accent hover:underline"
        >
          ‹ Front desk
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">
            {c.title}
          </h1>
          <Chip tone={st.tone}>{st.label}</Chip>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-muted">
              <input
                type="checkbox"
                checked={tech}
                onChange={(e) => setTech(e.target.checked)}
                className="accent-accent"
              />
              Technical detail
            </label>
            {proposed.length > 1 && (
              <Button
                small
                disabled={busyAll || pendingConstraints.length > 0}
                title={
                  pendingConstraints.length > 0
                    ? "Complete required reviews before approving all"
                    : undefined
                }
                onClick={() => setApproveAllOpen(true)}
              >
                {busyAll ? <Spinner /> : `Approve all ${proposed.length}`}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-1">
          <SummaryLine s={data?.scoreboard} state={c.state} />
        </div>
      </div>

      {pendingConstraints.length > 0 && (
        <div className="rounded-card border border-warn-line bg-warn-soft px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-ink">
                Required review · {pendingConstraints.length} patient
                {pendingConstraints.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                Review the extracted constraints before taking action for the
                affected patient. Other patients remain available.
              </p>
            </div>
            <Button
              small
              onClick={() => {
                const review = pendingConstraints[0];
                if (review.patientId) setSelectedId(review.patientId);
                setConstraintOpen(review);
              }}
            >
              Review now
            </Button>
          </div>
        </div>
      )}

      {/* Metric tiles */}
      {metrics && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="rounded-[10px] border border-line bg-white px-[13px] py-2">
            <span className="tnum block text-[16px] font-bold leading-none text-ink">
              {metrics.total}
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Patients affected
            </span>
          </div>
          <div className="rounded-[10px] border border-ok-line bg-ok-soft px-[13px] py-2">
            <span className="tnum block text-[16px] font-bold leading-none text-ok">
              {metrics.confirmed}
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Confirmed
            </span>
          </div>
          <div className="rounded-[10px] border border-warn-line bg-warn-soft px-[13px] py-2">
            <span className="tnum block text-[16px] font-bold leading-none text-warn">
              {metrics.waitingForYou}
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Waiting for you
            </span>
          </div>
          <div className="rounded-[10px] border border-accent-line bg-accent-soft px-[13px] py-2">
            <span className="tnum block text-[16px] font-bold leading-none text-accent">
              {metrics.waitingOnPatient}
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Waiting on patient
            </span>
          </div>
          <div className="rounded-[10px] border border-bad-line bg-bad-soft px-[13px] py-2">
            <span className="tnum block text-[16px] font-bold leading-none text-bad">
              {metrics.toCall}
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              To call
            </span>
          </div>
        </div>
      )}

      {/* Escalated banner */}
      {c.state === "escalated" && (
        <RailRow tone="bad" className="flex items-center gap-3 px-4 py-3">
          <p className="text-[14px] font-semibold text-ink">
            This one needs a person — the system stopped on purpose.
          </p>
          {conversations.length === 0 && (
            <Button
              variant="secondary"
              small
              className="ml-auto"
              onClick={() => setResolveOpen(true)}
            >
              Resolve manually
            </Button>
          )}
        </RailRow>
      )}

      {/* Patient list + panel */}
      {patients.length > 0 && (
        <div className="grid gap-3 md:grid-cols-[250px_1fr]">
          <aside className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Patients in this case</span>
            </div>
            {patients.map((p) => {
              const oc = p.activeRec
                ? outcomeLabel(p.activeRec)
                : { label: "No action", tone: "neutral" as const };
              const isActive = selectedId === p.id;
              const sub =
                needsDecision(p.activeRec)
                  ? "Needs your decision"
                  : oc.label;
              return (
                <button
                  key={p.id}
                  onClick={() => togglePatient(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-card border bg-white px-[11px] py-[9px] text-left transition-colors",
                    isActive
                      ? "border-accent bg-accent-soft"
                      : "border-line hover:border-strong",
                  )}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white"
                    style={{
                      backgroundColor:
                        p.activeRec?.payload?.doctorName
                          ? undefined
                          : undefined,
                    }}
                  >
                    {p.name
                      .split(" ")
                      .map((w: string) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] text-ink">
                      {p.name}
                    </b>
                    <span className="block truncate text-[11px] text-muted">
                      {sub}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      dotToneClass[oc.tone] ?? "bg-line",
                    )}
                  />
                </button>
              );
            })}
          </aside>

          <div>
            {selectedPatient ? (
              <div className="overflow-hidden rounded-card border border-line bg-white">
                {/* Panel head */}
                <div className="flex items-center gap-3 border-b border-line px-[18px] py-[14px]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">
                    {selectedPatient.name
                      .split(" ")
                      .map((w: string) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div>
                    <h2 className="text-[15px] font-bold text-ink">
                      {selectedPatient.name}
                    </h2>
                    <span className="text-[12px] text-muted">
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
                <div className="px-[15px] py-[13px]">
                  {drafting?.patientId === selectedPatient.id ? (
                    <div className="rounded-xl border border-accent-line bg-accent-soft px-[15px] py-[13px]">
                      <div className="flex items-start gap-3">
                        <Spinner />
                        <div>
                          <p className="text-[13px] font-semibold text-ink">
                            {drafting.operation === "replan"
                              ? "Preparing the next offer — rechecking the selected time and drafting the message."
                              : "Drafting a question — it will return here for approval."}
                          </p>
                          {draftingSlow && (
                            <button
                              className="mt-1 text-[12px] font-semibold text-accent hover:underline"
                              onClick={() => setTab("activity")}
                            >
                              Still working—check Agent activity
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : pendingConstraints.some(
                    (entry) => entry.patientId === selectedPatient.id,
                  ) || needsDecision(selectedPatient.activeRec) ? (
                    (() => {
                      const constraintReview = pendingConstraints.find(
                        (entry) =>
                          entry.patientId === selectedPatient.id ||
                          entry.appointmentId ===
                            (selectedPatient.activeRec.appointmentId ??
                              selectedPatient.activeRec.payload?.appointmentId),
                      );
                      return (
                        <DecisionCard
                          rec={selectedPatient.activeRec}
                          messages={messages}
                          onDone={refresh}
                          constraintReview={constraintReview}
                          onReviewConstraints={() =>
                            setConstraintOpen(constraintReview)
                          }
                        />
                      );
                    })()
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
                        selectedPatient.conv?.actions?.followUp;
                      return (
                        <div
                          className={cn(
                            "rounded-xl border px-[15px] py-[13px]",
                            theme,
                          )}
                        >
                          <div className="text-[11px] font-bold uppercase tracking-wider text-muted">
                            {statusTitle(rec)}
                          </div>
                          {rec.kind === "reschedule" && to && (
                            <RescheduleLine
                              fromLabel={p.from?.when}
                              toUtc={to.startUtc}
                              doctorName={to.doctorName}
                            />
                          )}
                          {rec.kind !== "reschedule" && (
                            <p className="tnum text-[15px] font-bold text-ink">
                              {p.when ?? p.from?.when ?? "—"}
                            </p>
                          )}
                          {wantsFollowUp && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                small
                                disabled={!!busyPatient}
                                onClick={() => {
                                  setFollowUp(selectedPatient.conv);
                                  setFollowOutcome(null);
                                  setFollowError(null);
                                }}
                              >
                                {busyPatient === rec.patientId ? (
                                  <Spinner />
                                ) : (
                                  "Follow up"
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="rounded-xl border border-line bg-surface-alt px-4 py-3 text-[13px] text-muted">
                      No active recommendation for this patient.
                    </div>
                  )}
                </div>

                {/* Thread tabs */}
                <div className="flex items-center justify-between border-t border-b border-line bg-surface-alt px-[18px]">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setTab("messages")}
                      className={cn(
                        "border-b-2 px-2 py-2 text-[13px] font-semibold",
                        tab === "messages"
                          ? "border-accent text-ink"
                          : "border-transparent text-muted hover:text-ink",
                      )}
                    >
                      Messages
                      {selectedPatient.conv?.messages?.length ? (
                        <span className="ml-1 text-[11px] text-muted">
                          {selectedPatient.conv.messages.length}
                        </span>
                      ) : null}
                    </button>
                    <button
                      onClick={() => setTab("activity")}
                      className={cn(
                        "border-b-2 px-2 py-2 text-[13px] font-semibold",
                        tab === "activity"
                          ? "border-accent text-ink"
                          : "border-transparent text-muted hover:text-ink",
                      )}
                    >
                      Agent activity
                      {grouped.byPatient.get(selectedPatient.id)?.items
                        .length ? (
                        <span className="ml-1 text-[11px] text-muted">
                          {
                            grouped.byPatient.get(selectedPatient.id)!.items
                              .length
                          }
                        </span>
                      ) : null}
                    </button>
                  </div>
                </div>

                {/* Panel content */}
                <div
                  ref={messagePanelRef}
                  className="h-72 overflow-y-auto px-[18px] py-4 thin-scroll"
                >
                  {tab === "messages" && (
                    <div className="space-y-3">
                      {!selectedPatient.conv?.messages?.length && (
                        <Empty>No email sent for this patient.</Empty>
                      )}
                      {selectedPatient.conv?.messages?.map((m: any) => (
                        <div
                          key={m.id}
                          className={cn(
                            "max-w-[92%] rounded-card border p-3",
                            m.direction === "inbound"
                              ? "border-line bg-white"
                              : "ml-auto border-accent-line bg-accent-soft/60",
                          )}
                        >
                          <div className="flex items-center gap-2 text-[12px] text-muted">
                            <b className="text-ink/80">
                              {m.direction === "inbound" ? "Patient" : "Clinic"}
                            </b>
                            {m.status === "draft_created" && (
                              <Chip tone="warn">Draft — not sent</Chip>
                            )}
                            <span className="tnum ml-auto">
                              {fmtWhenManila(m.createdAt)}
                            </span>
                          </div>
                          {m.subject && (
                            <p className="mt-1 text-[13px] font-bold text-ink">
                              {m.subject}
                            </p>
                          )}
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/85">
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
              </div>
            ) : (
              <Empty>No patients in this case.</Empty>
            )}
          </div>
        </div>
      )}

      {/* Case log — moved to page bottom, matching case-detail-ref.html */}
      {grouped.caseLevel.length > 0 && (
        <div className="case-log rounded-card border border-line bg-white">
          <button
            type="button"
            onClick={() => setCaseOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-[13px] font-bold text-ink"
            aria-expanded={caseOpen}
          >
            Case log
            <span className="ml-auto text-[12px] text-muted">
              {grouped.caseLevel.length}
            </span>
            <span className="text-muted">{caseOpen ? "▾" : "▸"}</span>
          </button>
          {caseOpen && (
            <ol className="relative ml-1.5 h-72 space-y-0 overflow-y-auto border-l border-line px-3 pb-2.5 thin-scroll">
              {grouped.caseLevel.map((it) => (
                <ActivityRow key={it.id} it={it} tech={tech} />
              ))}
            </ol>
          )}
        </div>
      )}

      <Modal
        open={!!constraintOpen}
        onClose={() => setConstraintOpen(null)}
        title={`Review constraints for ${constraintOpen?.patientName ?? "this patient"}`}
        wide
      >
        {constraintOpen && (
          <ConstraintEditor
            caseId={id as string}
            latest={constraintOpen}
            conversations={conversations}
            embedded
            onRefresh={refresh}
            onComplete={(completion) => {
              setDrafting(completion);
              setDraftingSlow(false);
              setConstraintOpen(null);
              refresh();
            }}
          />
        )}
      </Modal>

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
          <p className="mb-3 rounded-ctl border border-bad-line bg-bad-soft px-3 py-2 text-[13px] font-semibold text-bad">
            {followError}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {followUp?.activeHold && (
            <button
              className={cn(
                "rounded-card border p-3 text-left",
                followOutcome === "accept_current"
                  ? "border-accent bg-accent-soft"
                  : "border-line",
              )}
              onClick={() => setFollowOutcome("accept_current")}
            >
              <b className="text-[13px] text-ink">Accepted current time</b>
              <span className="mt-0.5 block text-[12px] text-muted">
                Confirm the temporary hold.
              </span>
            </button>
          )}
          <button
            className={cn(
              "rounded-card border p-3 text-left",
              followOutcome === "decline"
                ? "border-accent bg-accent-soft"
                : "border-line",
            )}
            onClick={() => setFollowOutcome("decline")}
          >
            <b className="text-[13px] text-ink">Declined</b>
            <span className="mt-0.5 block text-[12px] text-muted">
              {followUp?.activeHold
                ? "Release the temporary hold."
                : "Record as handled manually."}
            </span>
          </button>
          {followUp?.currentAppointment && (
            <button
              className={cn(
                "rounded-card border p-3 text-left",
                followOutcome === "choose_another"
                  ? "border-accent bg-accent-soft"
                  : "border-line",
              )}
              onClick={() => setFollowOutcome("choose_another")}
            >
              <b className="text-[13px] text-ink">Choose another time</b>
              <span className="mt-0.5 block text-[12px] text-muted">
                Book a valid confirmed time.
              </span>
            </button>
          )}
          <button
            className={cn(
              "rounded-card border p-3 text-left",
              followOutcome === "no_answer"
                ? "border-accent bg-accent-soft"
                : "border-line",
            )}
            onClick={() => setFollowOutcome("no_answer")}
          >
            <b className="text-[13px] text-ink">No answer</b>
            <span className="mt-0.5 block text-[12px] text-muted">
              Keep this open for later.
            </span>
          </button>
        </div>
        {followOutcome === "choose_another" && (
          <label className="mt-3 block text-[12px] font-bold text-muted">
            Valid date and time
            <select
              value={followSlot}
              onChange={(event) => setFollowSlot(event.target.value)}
              className="mt-1 w-full rounded-ctl border border-line bg-white px-3 py-2 text-[14px] text-ink"
            >
              <option value="">Select a time</option>
              {followSlots.map((slot: any) => (
                <option key={slot.startUtc} value={slot.startUtc}>
                  {fmtWhenManila(slot.startUtc)}
                </option>
              ))}
            </select>
          </label>
        )}
      </Modal>
    </div>
  );
}
