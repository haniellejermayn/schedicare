"use client";
import { useEffect, useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import { jfetch, fmtTimeManila, fmtWhenManila, typeLabel } from "@/lib/format";
import { Badge, Button, Card, Dialog, EmptyState, Logo, SectionTitle, Spinner, StatusBadge, cn } from "@/components/ui";

const TYPES = [
  { id: "routine", label: "Routine", blurb: "30 min consult" },
  { id: "follow_up", label: "Follow-up", blurb: "20 min check-in" },
  { id: "urgent", label: "Urgent", blurb: "same-week concern" },
] as const;

export default function BookPage() {
  const { data: patientsData } = usePoll<any>("/api/patients", 30000);
  const patients = patientsData?.patients ?? [];
  const [patientId, setPatientId] = useState("pat_maria");
  const patient = patients.find((p: any) => p.id === patientId);

  const { data: apptData, refresh: refreshAppts } = usePoll<any>(`/api/appointments?patientId=${patientId}`, 4000);
  const myAppts = (apptData?.appointments ?? []).filter((a: any) => a.patientId === patientId);
  const upcoming = myAppts.filter((a: any) => ["booked", "confirmed"].includes(a.status));
  const disrupted = myAppts.filter((a: any) => a.status === "superseded");

  const [doctorId, setDoctorId] = useState("doc_santos");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("routine");
  const { data: slotData } = usePoll<any>(`/api/slots?doctorId=${doctorId}&type=${type}`, 8000);
  const slots = slotData?.slots ?? [];
  const slotsByDay = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const s of slots) (g[s.day] ??= []).push(s);
    return Object.entries(g).slice(0, 5);
  }, [slots]);

  const [picked, setPicked] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);

  async function book() {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await jfetch<any>("/api/appointments", {
        method: "POST",
        body: JSON.stringify({ patientId, doctorId: picked.doctorId, type, startUtc: picked.startUtc }),
      });
      setToast(`Booked ${res.when}. A reminder email will follow. (${res.calendar})`);
      setPicked(null);
      refreshAppts();
    } catch (e) {
      setToast((e as Error).message);
      setPicked(null);
    } finally {
      setBusy(false);
    }
  }

  async function act(appt: any, action: "confirm" | "cancel") {
    setBusy(true);
    try {
      const res = await jfetch<any>(`/api/appointments/${appt.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      setToast(
        action === "confirm"
          ? "Thanks — you're confirmed. See you then!"
          : res.backfill
            ? "Cancelled. We've released your slot — someone on the waitlist may get it."
            : "Cancelled."
      );
      setCancelTarget(null);
      refreshAppts();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[430px]">
      {/* Phone-ish header */}
      <div className="rounded-hero bg-gradient-to-br from-scd-primary to-scd-deep p-5 text-white shadow-floating">
        <div className="flex items-center gap-2.5">
          <Logo size={24} />
          <span className="text-[16px] font-extrabold">SchediCare</span>
          <span className="ml-auto rounded-pill bg-white/15 px-2.5 py-0.5 text-[11px] font-bold">Riverside Family Clinic</span>
        </div>
        <p className="mt-4 text-[13px] text-white/75">Kumusta,</p>
        <div className="flex items-center gap-2">
          <select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="rounded-xl border border-white/25 bg-white/10 px-2 py-1 text-[18px] font-extrabold text-white outline-none [&>option]:text-scd-ink"
            aria-label="Demo as patient"
          >
            {patients.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-[11px] text-white/60">Demo patient switcher — each patient sees only their own visits.</p>
      </div>

      {toast && (
        <div className="animate-scd-pop mt-3 rounded-card border border-scd-primary/40 bg-scd-lavender/70 px-4 py-2.5 text-[13px] font-semibold text-scd-deep" role="status">
          {toast}
          <button className="ml-2 text-scd-primary underline" onClick={() => setToast(null)}>ok</button>
        </div>
      )}

      {/* Disruption notice */}
      {disrupted.length > 0 && (
        <Card className="mt-3 border-scd-warning/50 bg-[#FFFDF6] p-4">
          <SectionTitle>Schedule change</SectionTitle>
          {disrupted.slice(-2).map((a: any) => (
            <p key={a.id} className="mt-2 text-[13px] text-scd-ink/90">
              Your {typeLabel(a.type).toLowerCase()} on <b>{fmtWhenManila(a.startUtc)}</b> with {a.doctorName} had to be moved (doctor emergency). Check
              your email — we sent you a new time, and it also appears below once confirmed.
            </p>
          ))}
        </Card>
      )}

      {/* Upcoming */}
      <Card className="mt-3 p-4">
        <SectionTitle>Your visits</SectionTitle>
        <div className="mt-2 space-y-2">
          {upcoming.length === 0 && <EmptyState>No upcoming visits. Book one below 👇</EmptyState>}
          {upcoming.map((a: any) => (
            <div key={a.id} className="animate-scd-in rounded-card border border-scd-line/70 bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-extrabold text-scd-ink">{fmtWhenManila(a.startUtc)}</span>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-0.5 text-[12px] text-scd-muted">
                {typeLabel(a.type)} · {a.doctorName}
              </p>
              <div className="mt-2 flex gap-2">
                {a.status === "booked" && (
                  <Button variant="success" className="!px-3 !py-1.5 text-[12px]" disabled={busy} onClick={() => act(a, "confirm")}>
                    Confirm ✓
                  </Button>
                )}
                <Button variant="ghost" className="!px-3 !py-1.5 text-[12px] text-scd-danger" disabled={busy} onClick={() => setCancelTarget(a)}>
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Booking */}
      <Card className="mt-3 p-4">
        <SectionTitle>Book a visit</SectionTitle>

        <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-scd-muted">Doctor</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {[
            { id: "doc_santos", name: "Dr. Elena Santos", initials: "ES", color: "#5B2FCE" },
            { id: "doc_reyes", name: "Dr. Marco Reyes", initials: "MR", color: "#3D2A8C" },
          ].map((d) => (
            <button
              key={d.id}
              onClick={() => setDoctorId(d.id)}
              className={cn(
                "flex items-center gap-2 rounded-card border p-2.5 text-left",
                doctorId === d.id ? "border-scd-primary bg-scd-lavender/50 shadow-glow" : "border-scd-line/70 bg-white"
              )}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-pill text-[12px] font-extrabold text-white" style={{ background: d.color }}>
                {d.initials}
              </span>
              <span className="text-[12px] font-bold leading-tight text-scd-ink">{d.name}</span>
            </button>
          ))}
        </div>

        <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-scd-muted">Visit type</p>
        <div className="mt-1.5 flex gap-2">
          {TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={cn(
                "flex-1 rounded-card border p-2 text-center",
                type === t.id ? "border-scd-primary bg-scd-lavender/50" : "border-scd-line/70 bg-white"
              )}
            >
              <span className="block text-[12px] font-extrabold text-scd-ink">{t.label}</span>
              <span className="block text-[10px] text-scd-muted">{t.blurb}</span>
            </button>
          ))}
        </div>

        <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-scd-muted">Available times (rule-checked live)</p>
        <div className="mt-1.5 space-y-2">
          {slotsByDay.length === 0 && <EmptyState>No open slots match — try another doctor or type.</EmptyState>}
          {slotsByDay.map(([day, list]) => (
            <div key={day}>
              <p className="text-[12px] font-bold text-scd-deep">
                {new Date(`${day}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric", timeZone: "Asia/Manila" })}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(list as any[]).slice(0, 8).map((s) => (
                  <button
                    key={s.startUtc}
                    onClick={() => setPicked(s)}
                    className="rounded-pill border border-scd-line bg-white px-3 py-1.5 text-[12px] font-bold text-scd-deep hover:border-scd-primary hover:bg-scd-lavender/50"
                  >
                    {fmtTimeManila(s.startUtc)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="mt-3 pb-6 text-center text-[11px] text-scd-muted">
        SchediCare proposes. Clinic staff approve. · Scheduling assistant only — for medical concerns call (02) 8641 0117.
      </p>

      {/* Confirm booking dialog */}
      <Dialog
        open={!!picked}
        onClose={() => setPicked(null)}
        title="Confirm this booking?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPicked(null)}>Back</Button>
            <Button variant="primary" disabled={busy} onClick={book}>
              {busy ? <Spinner /> : "Book it"}
            </Button>
          </>
        }
      >
        {picked && (
          <p>
            <b>{typeLabel(type)}</b> with <b>{doctorId === "doc_santos" ? "Dr. Elena Santos" : "Dr. Marco Reyes"}</b>
            <br />
            {fmtWhenManila(picked.startUtc)} · Riverside Family Clinic
          </p>
        )}
      </Dialog>

      {/* Cancel dialog */}
      <Dialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Cancel this visit?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>Keep it</Button>
            <Button variant="danger" disabled={busy} onClick={() => act(cancelTarget, "cancel")}>
              {busy ? <Spinner /> : "Yes, cancel"}
            </Button>
          </>
        }
      >
        {cancelTarget && (
          <p>
            {fmtWhenManila(cancelTarget.startUtc)} with {cancelTarget.doctorName}. If you cancel, the slot goes back to the clinic — patients on the
            waitlist may be offered it.
          </p>
        )}
      </Dialog>
    </div>
  );
}
