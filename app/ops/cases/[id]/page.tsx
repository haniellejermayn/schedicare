"use client";
import { useEffect, useMemo, useState } from "react";
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
        <p className="mt-0.5 text-[12px] leading-snug text-muted">
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
  return <p className="text-[13px] text-muted">{bits.join(" · ")}</p>;
}

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { data, refresh } = usePoll<any>(id ? `/api/cases/${id}` : null, 1800);
  const feed = useFeed(id);
  const [tab, setTab] = useState<Tab>("activity");
  const [tech, setTech] = useState(false);
  const [section, setSection] = useState<"review" | "patients">("review");
  const [expandedPatients, setExpandedPatients] = useState<Set<string>>(
    new Set(),
  );
  const [caseOpen, setCaseOpen] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [busyPatient, setBusyPatient] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
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
      r.status !== "proposed" &&
      r.outcome !== "superseded" &&
      !r.supersededBy,
  );
  const showTabs = proposed.length > 0 && decidedSubstantive.length > 0;
  const showReview = proposed.length > 0 && (!showTabs || section === "review");
  const showPatients =
    decidedSubstantive.length > 0 && (!showTabs || section === "patients");
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
  /*
  useEffect(() => {
  if (!data) return;
  setExpandedPatients((prev) => {
    if (prev.size > 0) return prev; // don't override manual toggles on refetch
    const needsAttention = conversations
      .filter((c: any) => {
        const rec = recs.find((r: any) => r.id === c.currentRecommendationId);
        return rec?.status === "proposed" || rec?.outcome === "needs_human";
      })
      .map((c: any) => c.patientId);
    return new Set(needsAttention);
  });
}, [data]); // eslint-disable-line react-hooks/exhaustive-deps
*/
  if (!c) return <Empty>Loading…</Empty>;
  const st = CASE_STATE[c.state] ?? {
    label: c.state,
    tone: "neutral" as const,
  };

  function togglePatient(id: string) {
    setExpandedPatients((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function approveAll() {
    setBusyAll(true);
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
        </div>
        <div className="mt-1">
          <SummaryLine s={data?.scoreboard} state={c.state} />
        </div>
      </div>

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

      {/* Decisions + Patients — tabbed when both have content, plain when only one does */}
      {(proposed.length > 0 || decidedSubstantive.length > 0) && (
        <section className="space-y-2.5">
          {proposed.length > 0 && decidedSubstantive.length > 0 ? (
            <Tabs<"review" | "patients">
              value={section}
              onChange={setSection}
              tabs={[
                {
                  id: "review",
                  label: "For your review",
                  count: proposed.length,
                },
                {
                  id: "patients",
                  label: "Patients",
                  count: decidedSubstantive.length,
                },
              ]}
              right={
                proposed.length > 1 ? (
                  <Button small disabled={busyAll} onClick={approveAll}>
                    {busyAll ? <Spinner /> : `Approve all ${proposed.length}`}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex items-center justify-between">
              <h2 className="eyebrow">
                {proposed.length > 0 ? "For your review" : "Patients"}
              </h2>
              {proposed.length > 1 && (
                <Button small disabled={busyAll} onClick={approveAll}>
                  {busyAll ? <Spinner /> : `Approve all ${proposed.length}`}
                </Button>
              )}
            </div>
          )}

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

          {(proposed.length === 0 ||
            (proposed.length > 0 && decidedSubstantive.length > 0
              ? section === "review"
              : true)) &&
            proposed.length > 0 &&
            proposed.map((r: any) => (
              <DecisionCard
                key={r.id}
                rec={r}
                messages={messages}
                onDone={refresh}
              />
            ))}

          {decidedSubstantive.length > 0 &&
            (proposed.length === 0 || section === "patients") &&
            decidedSubstantive.map((r: any) => {
              const p = r.payload ?? {};
              const oc = outcomeLabel(r);
              const to = (p.options ?? []).find(
                (o: any) =>
                  o.id ===
                  (p.executedOptionId ??
                    p.modifiedOptionId ??
                    p.chosenOptionId),
              );
              const conversation = conversations.find(
                (x: any) => x.patientId === r.patientId,
              );
              const actions =
                conversation?.currentRecommendationId === r.id
                  ? conversation.actions
                  : null;
              return (
                <RailRow key={r.id} tone={oc.tone} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-ink">
                        {p.patientName}
                      </p>
                      {r.kind === "reschedule" && to ? (
                        <RescheduleLine
                          fromLabel={p.from?.when}
                          toUtc={to.startUtc}
                          doctorName={to.doctorName}
                        />
                      ) : (
                        <p className="tnum text-[13px] text-muted">
                          {p.when ?? p.from?.when ?? ""}
                        </p>
                      )}
                    </div>
                    <Chip tone={oc.tone}>{oc.label}</Chip>
                  </div>
                  {actions?.followUp && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        small
                        disabled={!!busyPatient}
                        onClick={() => {
                          setFollowUp(conversation);
                          setFollowOutcome(null);
                          setFollowError(null);
                        }}
                      >
                        {busyPatient === r.patientId ? (
                          <Spinner />
                        ) : (
                          "Follow up"
                        )}
                      </Button>
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
                <input
                  type="checkbox"
                  checked={tech}
                  onChange={(e) => setTech(e.target.checked)}
                  className="accent-[#1D4ED8]"
                />
                Technical detail
              </label>
            ) : undefined
          }
        />

        {tab === "activity" && (
          <div className="mt-3 space-y-4">
            {grouped.caseLevel.length === 0 && grouped.byPatient.size === 0 && (
              <Empty>Activity will appear here as the case moves.</Empty>
            )}

            {grouped.caseLevel.length > 0 && (
              <div className="rounded-card border border-line bg-paper">
                <button
                  onClick={() => setCaseOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                >
                  <span className="text-[13px] font-bold text-ink">Case</span>
                  <span className="text-[12px] text-muted">
                    {grouped.caseLevel.length} update
                    {grouped.caseLevel.length === 1 ? "" : "s"}
                  </span>
                  {!caseOpen && grouped.caseLevel.at(-1) && (
                    <span className="ml-auto truncate text-[11px] text-muted">
                      {plainTitle(grouped.caseLevel.at(-1))}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-muted">
                    {caseOpen ? "▾" : "▸"}
                  </span>
                </button>
                {caseOpen && (
                  <ol className="relative ml-1.5 space-y-0 border-l border-line px-3 pb-2.5">
                    {grouped.caseLevel.map((it) => (
                      <ActivityRow key={it.id} it={it} tech={tech} />
                    ))}
                  </ol>
                )}
              </div>
            )}

            {[...grouped.byPatient.entries()].map(([patientId, group]) => {
              const isOpen = expandedPatients.has(patientId);
              const last = group.items.at(-1);
              return (
                <div
                  key={patientId}
                  className="rounded-card border border-line bg-paper"
                >
                  <button
                    onClick={() => togglePatient(patientId)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  >
                    <span className="text-[13px] font-bold text-ink">
                      {group.patientName}
                    </span>
                    <span className="text-[12px] text-muted">
                      {group.items.length} update
                      {group.items.length === 1 ? "" : "s"}
                    </span>
                    {last && (
                      <span className="ml-auto truncate text-[11px] text-muted">
                        {plainTitle(last)}
                      </span>
                    )}
                    <span className="shrink-0 text-muted">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                  {isOpen && (
                    <ol className="relative ml-1.5 space-y-0 border-l border-line px-3 pb-2.5">
                      {group.items.map((it) => (
                        <ActivityRow key={it.id} it={it} tech={tech} />
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "messages" && (
          <div className="mt-3 space-y-4">
            {conversations.length === 0 && (
              <Empty>No patient conversations yet.</Empty>
            )}
            {conversations.map((conversation: any) => {
              const latestRec = conversation.recommendations.at(-1);
              const oc = latestRec ? outcomeLabel(latestRec) : null;
              const isOpen = expandedPatients.has(conversation.patientId);
              return (
                <section
                  key={conversation.patientId}
                  className="rounded-card border border-line bg-paper"
                >
                  <button
                    onClick={() => togglePatient(conversation.patientId)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  >
                    <h3 className="text-[14px] font-bold text-ink">
                      {conversation.patientName}
                    </h3>
                    {oc && <Chip tone={oc.tone}>{oc.label}</Chip>}
                    <span className="ml-auto text-[12px] text-muted">
                      {conversation.messages.length} message
                      {conversation.messages.length === 1 ? "" : "s"}
                    </span>
                    <span className="shrink-0 text-muted">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 px-3 pb-3">
                      {conversation.messages.length === 0 && (
                        <p className="text-[13px] text-muted">
                          No email sent for this patient.
                        </p>
                      )}
                      {conversation.messages.map((m: any) => (
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
                            {m.body || "No new text above the quoted history."}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>

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
    </div>
  );
}
