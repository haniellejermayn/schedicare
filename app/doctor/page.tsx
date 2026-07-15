"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePoll } from "@/lib/usePoll";
import { jfetch, fmtTimeManila, typeLabel } from "@/lib/format";
import { Badge, Button, Card, Dialog, EmptyState, SectionTitle, Spinner, StatusBadge, cn } from "@/components/ui";

const DEMO_DAY = "2026-08-10";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function manilaDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export default function DoctorPage() {
  const [doctorId, setDoctorId] = useState("doc_santos");
  const { data, refresh } = usePoll<any>(`/api/doctor/${doctorId}`, 3000);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [reason, setReason] = useState("Family emergency — out for the day");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<any | null>(null);
  const [rulesMsg, setRulesMsg] = useState<string | null>(null);

  const doctor = data?.doctor;
  const rules = data?.rules;
  useEffect(() => {
    setRulesDraft(null);
    setRulesMsg(null);
    setDone(null);
  }, [doctorId]);

  const appts = data?.appointments ?? [];
  const today = appts.filter((a: any) => manilaDay(a.startUtc) === DEMO_DAY);
  const activeToday = today.filter((a: any) => ["booked", "confirmed"].includes(a.status));
  const week = useMemo(() => {
    const days: Record<string, any[]> = {};
    for (let i = 0; i < 6; i++) {
      const d = new Date(`${DEMO_DAY}T00:00:00+08:00`);
      d.setDate(d.getDate() + i);
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
      days[key] = appts.filter((a: any) => manilaDay(a.startUtc) === key && !["superseded"].includes(a.status));
    }
    return days;
  }, [appts]);

  const isUnavailableToday = (doctor?.unavailableDates ?? []).includes(DEMO_DAY);

  async function markUnavailable() {
    setBusy(true);
    try {
      const res = await jfetch<any>(`/api/doctor/${doctorId}/unavailable`, { method: "POST", body: JSON.stringify({ date: DEMO_DAY, reason }) });
      setDone(`Marked out for ${res.date}. Calendar: ${res.calendar}. SchediCare is assessing the impact now.`);
      setEmergencyOpen(false);
      refresh();
    } catch (e) {
      setDone((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    setRulesMsg(null);
    try {
      await jfetch(`/api/doctor/${doctorId}/rules`, { method: "PUT", body: JSON.stringify(rulesDraft) });
      setRulesMsg("Rules saved — the Scheduling agent uses them immediately.");
      setRulesDraft(null);
      refresh();
    } catch (e) {
      setRulesMsg((e as Error).message);
    }
  }

  const r = rulesDraft ?? rules;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-scd-ink">Doctor</h1>
        <div className="flex items-center gap-1 rounded-pill bg-white p-1 shadow-ambient border border-scd-line/70">
          {[
            { id: "doc_santos", label: "Dr. Elena Santos" },
            { id: "doc_reyes", label: "Dr. Marco Reyes" },
          ].map((d) => (
            <button
              key={d.id}
              onClick={() => setDoctorId(d.id)}
              className={cn("rounded-pill px-3.5 py-1.5 text-[13px] font-semibold", doctorId === d.id ? "bg-scd-primary text-white shadow-glow" : "text-scd-muted hover:text-scd-deep")}
            >
              {d.label}
            </button>
          ))}
        </div>
        {doctor && (
          <Badge tone={doctor.status === "available" ? "success" : "danger"}>{doctor.status === "available" ? "Available" : "Unavailable"}</Badge>
        )}
        <div className="ml-auto">
          <Button variant="danger" disabled={isUnavailableToday} onClick={() => setEmergencyOpen(true)}>
            {isUnavailableToday ? "Marked out today" : "⚡ Emergency Unavailability"}
          </Button>
        </div>
      </div>

      {doctorId === "doc_reyes" && (
        <div className="rounded-card border border-scd-info/40 bg-[#EFF4FD] px-4 py-2.5 text-[13px] font-semibold text-scd-info">
          Dr. Reyes is the backup doctor in this demo — SchediCare routes cross-doctor recoveries here when Dr. Santos is out.
        </div>
      )}

      {done && <div className="animate-scd-in rounded-card border border-scd-primary/40 bg-scd-lavender/60 px-4 py-2.5 text-[13px] font-semibold text-scd-deep">
        {done} <Link className="underline" href="/ops">Watch it in the Ops Center →</Link>
      </div>}

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4">
        {/* Left column: today + week */}
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle
              right={
                r ? (
                  <span className="text-[12px] font-semibold text-scd-muted">
                    {activeToday.length} / {r.maxPerDay} booked today
                  </span>
                ) : undefined
              }
            >
              Monday, August 10 — today
            </SectionTitle>
            {r && (
              <div className="mt-2 h-2 overflow-hidden rounded-pill bg-scd-chip">
                <div className="h-full rounded-pill bg-scd-primary transition-all" style={{ width: `${Math.min(100, (activeToday.length / r.maxPerDay) * 100)}%` }} />
              </div>
            )}
            <div className="mt-3 space-y-1.5">
              {today.length === 0 && <EmptyState>No appointments today.</EmptyState>}
              {today
                .sort((a: any, b: any) => a.startUtc.localeCompare(b.startUtc))
                .map((a: any) => (
                  <div key={a.id} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2", a.status === "superseded" ? "border-scd-line/50 bg-scd-bg/50 opacity-60" : "border-scd-line/70 bg-white")}>
                    <span className="w-16 text-[13px] font-bold tabular-nums text-scd-ink">{fmtTimeManila(a.startUtc)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-scd-ink">{a.patientName}</span>
                    <Badge tone={a.type === "urgent" ? "danger" : "neutral"}>{typeLabel(a.type)}</Badge>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
            </div>
            <p className="mt-2 text-[11px] text-scd-muted">Scheduled visits shown; walk-ins are handled at the front desk and don&apos;t appear here.</p>
          </Card>

          <Card className="p-4">
            <SectionTitle>This week</SectionTitle>
            <div className="mt-3 grid grid-cols-6 gap-2">
              {Object.entries(week).map(([dayKey, list], i) => (
                <div key={dayKey} className={cn("rounded-xl border p-2", dayKey === DEMO_DAY ? "border-scd-primary/50 bg-scd-lavender/40" : "border-scd-line/60 bg-scd-bg/40")}>
                  <p className="text-[11px] font-bold text-scd-deep">
                    {WEEKDAYS[i]} <span className="text-scd-muted">{dayKey.slice(8)}</span>
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {(list as any[]).slice(0, 6).map((a) => (
                      <div key={a.id} title={`${a.patientName} — ${typeLabel(a.type)} (${a.status.replace(/_/g, " ")})`} className={cn("truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold", a.status === "cancelled_by_patient" || a.status === "cancelled_by_doctor" ? "bg-[#F9E2DE] text-[#8C2B20] line-through" : a.status === "confirmed" ? "bg-[#E2F6ED] text-[#116B47]" : "bg-white text-scd-deep border border-scd-line/70")}>
                        {fmtTimeManila(a.startUtc)} {a.patientName.split(" ")[0]}
                      </div>
                    ))}
                    {(list as any[]).length > 6 && <p className="text-[10px] text-scd-muted">+{(list as any[]).length - 6} more</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column: rules + risk */}
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle
              right={
                rulesDraft ? (
                  <span className="flex gap-2">
                    <Button variant="primary" className="!px-3 !py-1 text-[12px]" onClick={saveRules}>Save</Button>
                    <Button variant="ghost" className="!px-3 !py-1 text-[12px]" onClick={() => setRulesDraft(null)}>Discard</Button>
                  </span>
                ) : (
                  <Button variant="outline" className="!px-3 !py-1 text-[12px]" onClick={() => setRulesDraft(JSON.parse(JSON.stringify(rules)))}>
                    Edit rules
                  </Button>
                )
              }
            >
              My scheduling rules
            </SectionTitle>
            {rulesMsg && <p className="mt-2 text-[12px] font-semibold text-scd-info">{rulesMsg}</p>}
            {!r ? (
              <EmptyState>Loading…</EmptyState>
            ) : (
              <div className="mt-3 space-y-3">
                {/* Work days */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-scd-muted">Work days</p>
                  <div className="mt-1.5 flex gap-1.5">
                    {WEEKDAYS.map((w, i) => {
                      const dow = i + 1;
                      const on = r.workDays.includes(dow);
                      return (
                        <button
                          key={w}
                          disabled={!rulesDraft}
                          onClick={() =>
                            setRulesDraft((d: any) => ({ ...d, workDays: on ? d.workDays.filter((x: number) => x !== dow) : [...d.workDays, dow].sort() }))
                          }
                          className={cn("rounded-pill px-2.5 py-1 text-[12px] font-bold", on ? "bg-scd-primary text-white" : "bg-scd-chip text-scd-muted", rulesDraft && "cursor-pointer")}
                        >
                          {w}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Windows visualization / editor */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-scd-muted">Time windows (per visit type)</p>
                  <div className="mt-1.5 space-y-1.5">
                    {(["follow_up", "routine", "urgent"] as const).map((t) => (
                      <div key={t} className="flex items-center gap-2">
                        <Badge tone={t === "urgent" ? "danger" : t === "follow_up" ? "info" : "neutral"}>{typeLabel(t)}</Badge>
                        {rulesDraft ? (
                          <input
                            value={(r.windows[t] ?? []).join(", ")}
                            onChange={(e) =>
                              setRulesDraft((d: any) => ({ ...d, windows: { ...d.windows, [t]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } }))
                            }
                            className="flex-1 rounded-xl border border-scd-line bg-white px-2.5 py-1 text-[12px] outline-none focus:border-scd-primary"
                            placeholder="08:00-12:00, 13:00-17:00"
                          />
                        ) : (
                          <div className="relative h-5 flex-1 overflow-hidden rounded-pill bg-scd-chip" title={(r.windows[t] ?? []).join(", ")}>
                            {(r.windows[t] ?? []).map((w: string) => {
                              const [a, b] = w.split("-");
                              const toPct = (hhmm: string) => ((Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) - 480) / (9 * 60)) * 100;
                              return (
                                <span key={w} className="absolute top-0 h-full rounded-pill bg-scd-primary/80" style={{ left: `${toPct(a)}%`, width: `${toPct(b) - toPct(a)}%` }}>
                                  <span className="sr-only">{w}</span>
                                </span>
                              );
                            })}
                            <span className="absolute left-1 top-0.5 text-[9px] font-bold text-scd-muted">8a</span>
                            <span className="absolute right-1 top-0.5 text-[9px] font-bold text-scd-muted">5p</span>
                          </div>
                        )}
                        <span className="w-20 text-right text-[11px] text-scd-muted">{r.durationMin[t]} min</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Numbers */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { k: "bufferAfterMin", label: "Buffer (min)" },
                    { k: "maxPerDay", label: "Max / day" },
                  ].map(({ k, label }) => (
                    <div key={k}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-scd-muted">{label}</p>
                      {rulesDraft ? (
                        <input
                          type="number"
                          value={r[k]}
                          onChange={(e) => setRulesDraft((d: any) => ({ ...d, [k]: Number(e.target.value) }))}
                          className="mt-1 w-full rounded-xl border border-scd-line bg-white px-2 py-1 text-[13px] outline-none focus:border-scd-primary"
                        />
                      ) : (
                        <p className="mt-1 text-[15px] font-extrabold text-scd-ink">{r[k]}</p>
                      )}
                    </div>
                  ))}
                  {(["am", "pm"] as const).map((b) => (
                    <div key={b}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-scd-muted">Max {b.toUpperCase()}</p>
                      {rulesDraft ? (
                        <input
                          type="number"
                          value={r.maxPerBlock[b]}
                          onChange={(e) => setRulesDraft((d: any) => ({ ...d, maxPerBlock: { ...d.maxPerBlock, [b]: Number(e.target.value) } }))}
                          className="mt-1 w-full rounded-xl border border-scd-line bg-white px-2 py-1 text-[13px] outline-none focus:border-scd-primary"
                        />
                      ) : (
                        <p className="mt-1 text-[15px] font-extrabold text-scd-ink">{r.maxPerBlock[b]}</p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-scd-muted">The Scheduling agent can only propose times that satisfy every rule here — the validator re-checks each one before anything is written.</p>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle>Patients at risk of not showing</SectionTitle>
            <div className="mt-3 space-y-1.5">
              {(data?.atRisk ?? []).length === 0 && <EmptyState>No elevated no-show risk right now.</EmptyState>}
              {(data?.atRisk ?? []).map((rk: any) => (
                <div key={rk.appointmentId} className="rounded-xl border border-scd-line/70 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-scd-ink">{rk.patientName}</span>
                    <Badge tone={rk.band === "high" ? "danger" : "warning"}>{rk.score}/100 {rk.band}</Badge>
                    <span className="ml-auto text-[12px] text-scd-muted">{new Date(rk.startUtc).toLocaleString("en-PH", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-scd-muted">{rk.factors?.map((f: any) => f.label).join(" · ")}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Emergency dialog */}
      <Dialog
        open={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        title="Mark today as an emergency out-of-office?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEmergencyOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={markUnavailable}>
              {busy ? <Spinner /> : "Yes — I'm out today"}
            </Button>
          </>
        }
      >
        <p>
          SchediCare will immediately assess your <b>Monday, August 10</b> schedule, find rule-valid alternatives for every affected patient, and stage
          offers for staff approval. <b>Nothing reaches patients until staff approve.</b>
        </p>
        <label className="mt-3 block text-[12px] font-bold text-scd-muted">Reason (shared with staff, not patients)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-scd-line px-3 py-2 text-[13px] outline-none focus:border-scd-primary" />
      </Dialog>
    </div>
  );
}
