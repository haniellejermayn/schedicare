"use client";
import { useEffect, useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import { jfetch, fmtTimeManila, typeLabel } from "@/lib/format";
import { Button, Card, Chip, Empty, Modal, PageTitle, RailRow, Spinner, Tabs, cn } from "@/components/ui";
import { appointmentStatus } from "@/components/copy";
import { WeekCalendar } from "@/components/WeekCalendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Tab = "today" | "week" | "rules";

function manilaDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}


function NumField({ label, value, editing, onChange }: { label: string; value: number | undefined; editing: boolean; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      {editing ? (
        <input
          type="number"
          value={value ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tnum mt-1 w-20 rounded-ctl border border-line px-2 py-1 text-[13px] outline-none focus:border-accent"
        />
      ) : (
        <p className="tnum mt-1 text-[14px] font-bold text-ink">{value ?? "—"}</p>
      )}
    </div>
  );
}

export default function DoctorPage() {
  const [doctorId, setDoctorId] = useState("doc_santos");
  const { data, refresh } = usePoll<any>(`/api/doctor/${doctorId}`, 3000);
  const [tab, setTab] = useState<Tab>("today");
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [reason, setReason] = useState("Family emergency — out for the day");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<any | null>(null);
  const [rulesMsg, setRulesMsg] = useState<string | null>(null);

  const doctor = data?.doctor;
  const rules = data?.rules;
  const demoDay = data?.demoToday ?? "";
  useEffect(() => {
    setRulesDraft(null);
    setRulesMsg(null);
    setDone(null);
  }, [doctorId]);

  const appts = data?.appointments ?? [];
  const today = appts.filter((a: any) => manilaDay(a.startUtc) === demoDay);
  const activeToday = today.filter((a: any) => ["booked", "confirmed"].includes(a.status));
  const riskById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of data?.atRisk ?? []) m[r.appointmentId] = r;
    return m;
  }, [data]);
  const week = useMemo(() => {
    const days: Record<string, any[]> = {};
    if (!demoDay) return days;
    for (let i = 0; i < 6; i++) {
      const d = new Date(`${demoDay}T00:00:00+08:00`);
      d.setDate(d.getDate() + i);
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
      days[key] = appts.filter((a: any) => manilaDay(a.startUtc) === key && !["superseded"].includes(a.status));
    }
    return days;
  }, [appts, demoDay]);

  const isUnavailableToday = (doctor?.unavailableDates ?? []).includes(demoDay);

  async function markUnavailable() {
    setBusy(true);
    try {
      const res = await jfetch<any>(`/api/doctor/${doctorId}/unavailable`, { method: "POST", body: JSON.stringify({ date: demoDay, reason }) });
      setEmergencyOpen(false);
      setDone(`Told the front desk. ${res.affected} patient${res.affected === 1 ? "" : "s"} today will get new suggestions to review.`);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    setBusy(true);
    try {
      await jfetch(`/api/doctor/${doctorId}/rules`, { method: "PUT", body: JSON.stringify(rulesDraft) });
      setRulesDraft(null);
      setRulesMsg("Saved. New suggestions follow these rules right away.");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const r = rulesDraft ?? rules;
  const cap = rules?.maxPerDay ?? 0;

  return (
    <div className="space-y-5">
      <PageTitle
        right={
          <div className="flex items-center rounded-full border border-line bg-white p-0.5">
            {["doc_santos", "doc_reyes"].map((id) => (
              <button
                key={id}
                onClick={() => setDoctorId(id)}
                className={cn("rounded-full px-3 py-1 text-[13px] font-semibold", doctorId === id ? "bg-ink text-white" : "text-muted hover:text-ink")}
              >
                {id === "doc_santos" ? "Dr. Santos" : "Dr. Reyes"}
              </button>
            ))}
          </div>
        }
      >
        {doctor?.name ?? "Doctor"}
      </PageTitle>

      {isUnavailableToday ? (
        <RailRow tone="bad" className="px-4 py-3 text-[14px] font-semibold text-ink">
          You&apos;re marked out today. The front desk is rebooking your patients — nothing else for you to do.
        </RailRow>
      ) : (
        <RailRow tone="warn" className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">Can&apos;t come in today?</p>
            <p className="text-[13px] text-muted">One tap tells the front desk and starts rebooking. Nothing reaches patients until staff approve.</p>
          </div>
          <Button variant="danger" onClick={() => setEmergencyOpen(true)}>I can&apos;t come in</Button>
        </RailRow>
      )}
      {done && <p className="text-[13px] font-semibold text-ok">{done}</p>}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "today", label: "Today", count: activeToday.length },
          { id: "week", label: "This week" },
          { id: "rules", label: "My rules" },
        ]}
      />

      {tab === "today" && (
        <div className="space-y-2.5">
          {cap > 0 && (
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (activeToday.length / cap) * 100)}%` }} />
              </div>
              {activeToday.length} of {cap} booked
            </div>
          )}
          {today.length === 0 && <Empty>No visits scheduled today.</Empty>}
          {today.map((a: any) => {
            const st = appointmentStatus(a);
            const risk = riskById[a.id];
            return (
              <RailRow key={a.id} tone={a.status === "confirmed" ? "ok" : a.status === "booked" ? "warn" : "neutral"} className="flex items-center gap-3 px-4 py-2.5">
                <span className="tnum w-[72px] text-[14px] font-bold text-ink">{fmtTimeManila(a.startUtc)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{a.patientName}</p>
                  <p className="text-[12px] text-muted">{typeLabel(a.type)} · {a.durationMin} min</p>
                </div>
                {risk && risk.band !== "low" && <Chip tone="warn">May not show</Chip>}
                <Chip tone={st.tone}>{st.label}</Chip>
              </RailRow>
            );
          })}
          <p className="pt-1 text-[11px] text-muted">Scheduled visits shown; walk-ins are handled at the front desk and don&apos;t appear here.</p>
        </div>
      )}

      {tab === "week" && (
        <WeekCalendar
          week={week}
          riskById={riskById}
          today={demoDay}
          rules={rules}
          externalBusy={data?.externalBusy ?? []}
          unavailableDates={doctor?.unavailableDates ?? []}
        />
      )}

      {tab === "rules" && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">Scheduling rules</h2>
            {rulesDraft ? (
              <div className="flex gap-2">
                <Button variant="secondary" small onClick={() => setRulesDraft(null)}>Cancel</Button>
                <Button small disabled={busy} onClick={saveRules}>{busy ? <Spinner /> : "Save changes"}</Button>
              </div>
            ) : (
              <Button variant="secondary" small onClick={() => setRulesDraft(JSON.parse(JSON.stringify(rules)))}>Edit</Button>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-muted">Every suggestion the system makes must fit these. Changes apply immediately.</p>
          {rulesMsg && <p className="mt-2 text-[12px] font-semibold text-ok">{rulesMsg}</p>}
          {!r ? (
            <div className="mt-3"><Empty>Loading…</Empty></div>
          ) : (
            <div className="mt-4 space-y-4">
              <div>
                <p className="eyebrow">Work days</p>
                <div className="mt-1.5 flex gap-1.5">
                  {WEEKDAYS.map((w, i) => {
                    const dow = i + 1;
                    const on = r.workDays.includes(dow);
                    return (
                      <button
                        key={w}
                        disabled={!rulesDraft}
                        onClick={() => setRulesDraft((d: any) => ({ ...d, workDays: on ? d.workDays.filter((x: number) => x !== dow) : [...d.workDays, dow].sort() }))}
                        className={cn("rounded-full px-2.5 py-1 text-[12px] font-bold", on ? "bg-accent text-white" : "bg-paper text-muted", rulesDraft && "cursor-pointer")}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="eyebrow">Time windows per visit type</p>
                <div className="mt-1.5 space-y-1.5">
                  {(["follow_up", "routine", "urgent"] as const).map((t) => (
                    <div key={t} className="flex items-center gap-2">
                      <Chip tone={t === "urgent" ? "bad" : t === "follow_up" ? "accent" : "neutral"} className="w-24 justify-center">{typeLabel(t)}</Chip>
                      {rulesDraft ? (
                        <input
                          value={(r.windows[t] ?? []).join(", ")}
                          onChange={(e) => setRulesDraft((d: any) => ({ ...d, windows: { ...d.windows, [t]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } }))}
                          className="flex-1 rounded-ctl border border-line bg-white px-2.5 py-1 text-[13px] outline-none focus:border-accent"
                          placeholder="08:00-12:00, 13:00-17:00"
                        />
                      ) : (
                        <span className="tnum text-[13px] text-ink/85">{(r.windows[t] ?? []).join(", ") || "—"}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <NumField label="Most visits per day" value={r.maxPerDay} editing={!!rulesDraft} onChange={(v) => setRulesDraft((d: any) => ({ ...d, maxPerDay: v }))} />
                <NumField label="Most per morning" value={r.maxPerBlock?.am} editing={!!rulesDraft} onChange={(v) => setRulesDraft((d: any) => ({ ...d, maxPerBlock: { ...d.maxPerBlock, am: v } }))} />
                <NumField label="Most per afternoon" value={r.maxPerBlock?.pm} editing={!!rulesDraft} onChange={(v) => setRulesDraft((d: any) => ({ ...d, maxPerBlock: { ...d.maxPerBlock, pm: v } }))} />
                <NumField label="Break after each visit (min)" value={r.bufferAfterMin} editing={!!rulesDraft} onChange={(v) => setRulesDraft((d: any) => ({ ...d, bufferAfterMin: v }))} />
              </div>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        title="Tell the front desk you're out today?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEmergencyOpen(false)}>Back</Button>
            <Button variant="danger" disabled={busy} onClick={markUnavailable}>{busy ? <Spinner /> : "Yes — I'm out today"}</Button>
          </>
        }
      >
        <p>
          Your visits today will be cancelled and the system will suggest new times for each patient.
          <b> Nothing reaches patients until the front desk approves.</b>
        </p>
        <label className="mt-3 block text-[12px] font-bold text-muted">Note for the front desk</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-ctl border border-line px-3 py-2 text-[14px] outline-none focus:border-accent" />
      </Modal>
    </div>
  );
}
