"use client";
import { useEffect, useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import {
  jfetch,
  fmtTimeManila,
  fmtWhenManila,
  fmtDayManila,
  typeLabel,
} from "@/lib/format";
import { Button, Card, Chip, Empty, Modal, Spinner, cn } from "@/components/ui";
import { appointmentStatus } from "@/components/copy";

const TYPES = [
  { id: "routine", label: "Routine", blurb: "30 min consult" },
  { id: "follow_up", label: "Follow-up", blurb: "20 min check-in" },
  { id: "urgent", label: "Urgent", blurb: "same-week concern" },
] as const;

const DOCTORS = [
  { id: "doc_santos", name: "Dr. Elena Santos", initials: "ES" },
  { id: "doc_reyes", name: "Dr. Marco Reyes", initials: "MR" },
];

function toDayKey(date: Date): string {
  // Format as YYYY-MM-DD in Manila timezone
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

export default function BookPage() {
  const { data: patientsData } = usePoll<any>("/api/patients", 30000);
  const patients = patientsData?.patients ?? [];
  const [patientId, setPatientId] = useState("pat_maria");

  const { data: apptData, refresh: refreshAppts } = usePoll<any>(
    `/api/appointments?patientId=${patientId}`,
    4000,
  );
  const myAppts = (apptData?.appointments ?? []).filter(
    (a: any) => a.patientId === patientId,
  );
  const upcoming = myAppts.filter((a: any) =>
    ["booked", "confirmed"].includes(a.status),
  );
  const disrupted = myAppts.filter((a: any) => a.status === "superseded");

  const [doctorId, setDoctorId] = useState("doc_santos");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("routine");
  const { data: slotData } = usePoll<any>(
    `/api/slots?doctorId=${doctorId}&type=${type}`,
    8000,
  );
  const slots = slotData?.slots ?? [];

  const slotMap = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const s of slots) (m[s.day] ??= []).push(s);
    return m;
  }, [slots]);

  const [picked, setPicked] = useState<any | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAllDates, setShowAllDates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);

  useEffect(() => {
    const keys = Object.keys(slotMap);
    if (keys.length === 0) {
      setSelectedDay(null);
      return;
    }
    const today = toDayKey(new Date());
    const available = keys.filter((k) => k >= today);
    if (available.length === 0) {
      setSelectedDay(null);
      return;
    }
    setSelectedDay((prev) => {
      if (prev && available.includes(prev)) return prev;
      return available[0];
    });
  }, [slotMap]);

  async function book() {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await jfetch<any>("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          patientId,
          doctorId: picked.doctorId,
          type,
          startUtc: picked.startUtc,
        }),
      });
      setToast(
        `Booked ${res.when}. A reminder email will follow. (${res.calendar})`,
      );
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
      const res = await jfetch<any>(`/api/appointments/${appt.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      setToast(
        action === "confirm"
          ? "Thanks — you're confirmed. See you then!"
          : res.backfill
            ? "Cancelled. We've released your slot — someone on the waitlist may get it."
            : "Cancelled.",
      );
      setCancelTarget(null);
      refreshAppts();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const firstName = (
    patients.find((p: any) => p.id === patientId)?.name ?? ""
  ).split(" ")[0];

  const today = toDayKey(new Date());
  const selectedSlots = selectedDay ? slotMap[selectedDay] ?? [] : [];
  const availableDates = Object.keys(slotMap).filter((d) => d >= today).sort();
  const visibleDates = showAllDates ? availableDates : availableDates.slice(0, 5);

  return (
    <div className="mx-auto max-w-[430px] space-y-3">
      {/* Header */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Riverside Family Clinic</span>
          <Chip tone="neutral">Patient view</Chip>
        </div>
        <p className="mt-3 text-[13px] text-muted">Hi{firstName ? "," : ""}</p>
        <select
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          className="mt-0.5 w-full rounded-ctl border border-line bg-white px-2 py-1.5 text-[17px] font-bold text-ink outline-none focus:border-accent"
          aria-label="Demo as patient"
        >
          {patients.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-muted">
          Demo patient switcher — each patient sees only their own visits.
        </p>
      </Card>

      {toast && (
        <div
          className="animate-pop rounded-card border border-accent-line bg-accent-soft px-4 py-2.5 text-[13px] font-semibold text-ink"
          role="status"
        >
          {toast}
          <button
            className="ml-2 font-bold text-accent underline"
            onClick={() => setToast(null)}
          >
            ok
          </button>
        </div>
      )}

      {/* Disruption notice */}
      {disrupted.length > 0 && (
        <Card className="border-warn-line bg-warn-soft p-4">
          <p className="eyebrow">Schedule change</p>
          {disrupted.slice(-2).map((a: any) => (
            <p
              key={a.id}
              className="mt-2 text-[13px] leading-relaxed text-ink/90"
            >
              Your {typeLabel(a.type).toLowerCase()} on{" "}
              <b className="tnum">{fmtWhenManila(a.startUtc)}</b> with{" "}
              {a.doctorName} had to be moved (doctor emergency). Check your
              email — we sent you a new time, and it also appears below once
              confirmed.
            </p>
          ))}
        </Card>
      )}

      {/* Upcoming */}
      <Card className="p-4">
        <p className="eyebrow">Your visits</p>
        <div className="mt-2 space-y-2">
          {upcoming.length === 0 && (
            <Empty>No upcoming visits — book one below.</Empty>
          )}
          {upcoming.map((a: any) => {
            const st = appointmentStatus(a);
            return (
              <div
                key={a.id}
                className="animate-rise rounded-card border border-line bg-white p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="tnum text-[14px] font-bold text-ink">
                    {fmtWhenManila(a.startUtc)}
                  </span>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </div>
                <p className="mt-0.5 text-[12px] text-muted">
                  {typeLabel(a.type)} · {a.doctorName}
                </p>
                <div className="mt-2 flex gap-2">
                  {a.status === "booked" && (
                    <Button
                      variant="success"
                      small
                      disabled={busy}
                      onClick={() => act(a, "confirm")}
                    >
                      Confirm ✓
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    small
                    className="text-bad"
                    disabled={busy}
                    onClick={() => setCancelTarget(a)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Booking */}
      <Card className="p-4">
        <p className="eyebrow">Book a visit</p>

        <p className="mt-3 text-[12px] font-bold text-muted">Doctor</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {DOCTORS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDoctorId(d.id)}
              className={cn(
                "flex items-center gap-2 rounded-card border p-2.5 text-left",
                doctorId === d.id
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-white hover:border-strong",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold",
                  doctorId === d.id
                    ? "bg-accent text-white"
                    : "bg-paper text-muted",
                )}
              >
                {d.initials}
              </span>
              <span className="text-[12px] font-bold leading-tight text-ink">
                {d.name}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-3 text-[12px] font-bold text-muted">Visit type</p>
        <div className="mt-1.5 flex gap-2">
          {TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={cn(
                "flex-1 rounded-card border p-2 text-center",
                type === t.id
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-white hover:border-strong",
              )}
            >
              <span className="block text-[12px] font-bold text-ink">
                {t.label}
              </span>
              <span className="block text-[10px] text-muted">{t.blurb}</span>
            </button>
          ))}
        </div>

        <p className="mt-3 text-[12px] font-bold text-muted">Available times</p>

        {availableDates.length === 0 ? (
          <Empty className="mt-1.5">No open slots for this doctor and type.</Empty>
        ) : (
          <div className="mt-1.5 rounded-card border border-line bg-white p-2">
            <div className="grid grid-cols-5 gap-1">
              {visibleDates.map((day) => {
                const dateObj = new Date(`${day}T00:00:00+08:00`);
                const weekday = dateObj.toLocaleDateString("en-US", {
                  weekday: "short",
                  timeZone: "Asia/Manila",
                });
                const dayNum = dateObj.toLocaleDateString("en-US", {
                  day: "numeric",
                  timeZone: "Asia/Manila",
                });
                const isSelected = selectedDay === day;
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      "flex flex-col items-center rounded-card border py-1.5 text-[11px] font-bold transition",
                      isSelected
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line bg-white text-ink hover:border-accent hover:bg-accent-soft",
                      !isSelected ? "text-muted" : "",
                    )}
                  >
                    <span>{weekday}</span>
                    <span className="tnum text-[13px] leading-none">{dayNum}</span>
                  </button>
                );
              })}
            </div>
            {availableDates.length > 5 && (
              <button
                onClick={() => setShowAllDates((v) => !v)}
                className="mt-1 text-[12px] font-semibold text-accent hover:underline"
              >
                {showAllDates ? "Show fewer dates" : `Show ${availableDates.length - 5} more dates`}
              </button>
            )}
            {selectedDay && (
              <div className="mt-2">
                {selectedSlots.length > 0 ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    {selectedSlots.slice(0, 8).map((s: any) => (
                      <button
                        key={s.startUtc}
                        onClick={() => setPicked(s)}
                        className="tnum rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink hover:border-accent hover:bg-accent-soft"
                      >
                        {fmtTimeManila(s.startUtc)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty>No open slots for this day.</Empty>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      <p className="pb-6 text-center text-[11px] leading-relaxed text-muted">
        SchediCare proposes. Clinic staff approve.
        <br />
        Scheduling assistant only — for medical concerns call (02) 8641 0117.
      </p>

      {/* Confirm booking */}
      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title="Confirm this booking?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicked(null)}>
              Back
            </Button>
            <Button disabled={busy} onClick={book}>
              {busy ? <Spinner /> : "Book it"}
            </Button>
          </>
        }
      >
        {picked && (
          <p>
            <b>{typeLabel(type)}</b> with{" "}
            <b>{DOCTORS.find((d) => d.id === doctorId)?.name}</b>
            <br />
            <span className="tnum">{fmtWhenManila(picked.startUtc)}</span> ·
            Riverside Family Clinic
          </p>
        )}
      </Modal>

      {/* Cancel */}
      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Cancel this visit?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => act(cancelTarget, "cancel")}
            >
              {busy ? <Spinner /> : "Yes, cancel"}
            </Button>
          </>
        }
      >
        {cancelTarget && (
          <p>
            <span className="tnum">{fmtWhenManila(cancelTarget.startUtc)}</span>{" "}
            with {cancelTarget.doctorName}. If you cancel, the slot goes back to
            the clinic — patients on the waitlist may be offered it.
          </p>
        )}
      </Modal>
    </div>
  );
}
