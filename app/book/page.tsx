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
import {
  Avatar,
  Button,
  Card,
  Chip,
  ChoiceCard,
  Empty,
  Eyebrow,
  Modal,
  Select,
  cn,
} from "@/components/ui";
import { PatientShell, type PatientTab } from "@/components/shell/PatientShell";
import type { Tone } from "@/components/copy";

const TYPES = [
  { id: "routine", label: "Routine", blurb: "30 min consult" },
  { id: "follow_up", label: "Follow-up", blurb: "20 min check-in" },
  { id: "urgent", label: "Urgent", blurb: "same-week concern" },
] as const;

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

function toDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
}

/**
 * Patient-facing status. Deliberately separate from `components/copy.ts`, which
 * speaks to staff: a patient should never be told their appointment is a
 * "Temporary hold" — from their side it is a proposed time awaiting their reply.
 */
function patientStatus(a: {
  status: string;
  source?: string | null;
}): { label: string; tone: Tone; action: "confirm" | "none" } {
  if (a.status === "confirmed")
    return { label: "Confirmed", tone: "ok", action: "none" };
  if (a.status === "booked" && a.source === "schedicare")
    return { label: "New time — please confirm", tone: "warn", action: "confirm" };
  if (a.status === "booked")
    return { label: "Please confirm", tone: "warn", action: "confirm" };
  if (a.status === "superseded")
    return { label: "We're finding you a new time", tone: "accent", action: "none" };
  if (a.status === "completed")
    return { label: "Completed", tone: "neutral", action: "none" };
  if (a.status === "no_show")
    return { label: "Missed", tone: "bad", action: "none" };
  if (a.status?.startsWith("cancelled"))
    return { label: "Cancelled", tone: "neutral", action: "none" };
  return { label: a.status, tone: "neutral", action: "none" };
}

export default function PatientPage() {
  const [tab, setTab] = useState<PatientTab>("visits");

  const { data: patientsData } = usePoll<any>("/api/patients", 30000);
  const patients = patientsData?.patients ?? [];
  const [patientId, setPatientId] = useState("pat_maria");

  const { data: docList } = usePoll<any>("/api/doctors", 60000);
  const doctors: Array<{ id: string; name: string }> = docList?.doctors ?? [
    { id: "doc_santos", name: "Dr. Elena Santos" },
    { id: "doc_reyes", name: "Dr. Marco Reyes" },
  ];

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
  const past = myAppts.filter((a: any) =>
    ["completed", "no_show"].includes(a.status) ||
    a.status?.startsWith("cancelled"),
  );

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
  const [monthDate, setMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);

  useEffect(() => {
    if (doctors.length && !doctors.find((d) => d.id === doctorId)) {
      setDoctorId(doctors[0].id);
    }
  }, [doctors, doctorId]);

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
    setSelectedDay((prev) =>
      prev && available.includes(prev) ? prev : available[0],
    );
  }, [slotMap]);

  useEffect(() => {
    if (!selectedDay) return;
    const d = new Date(`${selectedDay}T00:00:00+08:00`);
    setMonthDate((prev) =>
      prev.getFullYear() === d.getFullYear() && prev.getMonth() === d.getMonth()
        ? prev
        : new Date(d.getFullYear(), d.getMonth(), 1),
    );
  }, [selectedDay]);

  const monthCells = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const startOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { date: Date; inMonth: boolean; day: string }[] = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, inMonth: false, day: toDayKey(d) });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      cells.push({ date, inMonth: true, day: toDayKey(date) });
    }
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date;
      const next = new Date(
        last.getFullYear(),
        last.getMonth(),
        last.getDate() + 1,
      );
      cells.push({ date: next, inMonth: false, day: toDayKey(next) });
    }
    return cells;
  }, [monthDate]);

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
      setToast(`Booked ${res.when}. We'll email you a reminder.`);
      setPicked(null);
      setTab("visits");
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
          ? "You're confirmed. See you then."
          : res.backfill
            ? "Cancelled. Your slot goes back to the clinic."
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

  const me = patients.find((p: any) => p.id === patientId);
  const firstName = (me?.name ?? "").split(" ")[0];
  const selectedSlots = selectedDay ? (slotMap[selectedDay] ?? []) : [];
  const today = toDayKey(new Date());

  return (
    <PatientShell tab={tab} onTabChange={setTab}>
      <div className="flex flex-col gap-4">
        {toast && (
          <div
            role="status"
            className="animate-pop flex items-start gap-2 rounded-card border border-accent-line bg-accent-soft px-4 py-3 text-base font-semibold text-ink"
          >
            <span className="flex-1">{toast}</span>
            <button
              className="shrink-0 font-bold text-accent underline"
              onClick={() => setToast(null)}
            >
              OK
            </button>
          </div>
        )}

        {tab === "visits" ? (
          <>
            <div className="flex items-center gap-3">
              <Avatar name={me?.name ?? "Patient"} size={44} />
              <div className="min-w-0">
                <p className="text-sm text-muted">Hello</p>
                <h1 className="truncate text-xl font-bold text-ink">
                  {firstName || "there"}
                </h1>
              </div>
            </div>

            {/* Anything the clinic moved. This is the patient's side of the
                cascade, so it leads. */}
            {disrupted.length > 0 && (
              <Card className="border-warn-line bg-warn-soft p-4">
                <Eyebrow>Schedule change</Eyebrow>
                {disrupted.slice(-2).map((a: any) => (
                  <p
                    key={a.id}
                    className="mt-2 text-base leading-relaxed text-ink-soft"
                  >
                    Your {typeLabel(a.type).toLowerCase()} on{" "}
                    <b className="tnum text-ink">{fmtWhenManila(a.startUtc)}</b>{" "}
                    with {a.doctorName} had to be moved. We&apos;ve emailed you
                    new times — once you reply, your new visit appears here.
                  </p>
                ))}
              </Card>
            )}

            <section className="flex flex-col gap-2.5">
              <Eyebrow>Upcoming</Eyebrow>
              {upcoming.length === 0 ? (
                <Empty
                  action={
                    <Button onClick={() => setTab("book")}>
                      Book a visit
                    </Button>
                  }
                >
                  You have no upcoming visits.
                </Empty>
              ) : (
                upcoming.map((a: any) => {
                  const st = patientStatus(a);
                  return (
                    <Card
                      key={a.id}
                      className={cn(
                        "animate-rise border-l-[3px] p-4",
                        st.tone === "ok"
                          ? "border-l-ok-rail"
                          : "border-l-warn-rail",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tnum text-lg font-bold text-ink">
                          {fmtWhenManila(a.startUtc)}
                        </span>
                        <Chip tone={st.tone}>{st.label}</Chip>
                      </div>
                      <p className="mt-1 text-base text-muted">
                        {typeLabel(a.type)} · {a.doctorName}
                      </p>
                      <div className="mt-3.5 flex gap-2">
                        {st.action === "confirm" && (
                          <Button
                            variant="success"
                            className="flex-1"
                            disabled={busy}
                            onClick={() => act(a, "confirm")}
                          >
                            Confirm
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          className={st.action === "confirm" ? "" : "flex-1"}
                          disabled={busy}
                          onClick={() => setCancelTarget(a)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
            </section>

            {past.length > 0 && (
              <section className="flex flex-col gap-2">
                <Eyebrow>Past visits</Eyebrow>
                {past.slice(0, 6).map((a: any) => {
                  const st = patientStatus(a);
                  return (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="tnum truncate text-base font-semibold text-ink">
                          {fmtWhenManila(a.startUtc)}
                        </p>
                        <p className="truncate text-sm text-muted">
                          {typeLabel(a.type)} · {a.doctorName}
                        </p>
                      </div>
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </div>
                  );
                })}
              </section>
            )}

            {/* Demo affordance, labelled as one. */}
            <label className="mt-2 flex flex-col gap-1.5 rounded-card border border-dashed border-line bg-surface-alt px-4 py-3">
              <span className="eyebrow">Demo — view as patient</span>
              <Select
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                aria-label="View as patient"
                className="bg-surface"
              >
                {patients.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-ink">Book a visit</h1>

            <section className="flex flex-col gap-2">
              <Eyebrow>Doctor</Eyebrow>
              {doctors.map((d) => (
                <ChoiceCard
                  key={d.id}
                  selected={doctorId === d.id}
                  onClick={() => setDoctorId(d.id)}
                  title={d.name}
                  right={<Avatar name={d.name} size={32} />}
                />
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <Eyebrow>Visit type</Eyebrow>
              <div className="grid grid-cols-3 gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setType(t.id)}
                    aria-pressed={type === t.id}
                    className={cn(
                      "flex min-h-[62px] flex-col items-center justify-center gap-0.5 rounded-card border px-2 py-3 text-center",
                      "transition-colors duration-fast ease-snappy",
                      type === t.id
                        ? "border-accent bg-accent-soft"
                        : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <span
                      className={cn(
                        "text-base font-semibold",
                        type === t.id ? "text-accent" : "text-ink",
                      )}
                    >
                      {t.label}
                    </span>
                    <span className="text-xs leading-tight text-muted">
                      {t.blurb}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <Eyebrow>Pick a day</Eyebrow>
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() =>
                      setMonthDate(
                        new Date(
                          monthDate.getFullYear(),
                          monthDate.getMonth() - 1,
                          1,
                        ),
                      )
                    }
                    aria-label="Previous month"
                    className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-surface-alt hover:text-ink"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <span className="text-base font-bold text-ink">
                    {monthLabel(monthDate)}
                  </span>
                  <button
                    onClick={() =>
                      setMonthDate(
                        new Date(
                          monthDate.getFullYear(),
                          monthDate.getMonth() + 1,
                          1,
                        ),
                      )
                    }
                    aria-label="Next month"
                    className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted transition-colors hover:bg-surface-alt hover:text-ink"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-1 text-center">
                  {WEEKDAY_INITIALS.map((d, i) => (
                    <div key={i} className="text-xs font-semibold text-muted">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="mt-1 grid grid-cols-7 gap-1">
                  {monthCells.map((cell, idx) => {
                    const hasSlots = Boolean(slotMap[cell.day]);
                    const isSelected = cell.day === selectedDay;
                    const isPast = cell.day < today;
                    const disabled = !cell.inMonth || isPast || !hasSlots;
                    return (
                      <button
                        key={`${cell.day}-${idx}`}
                        onClick={
                          disabled ? undefined : () => setSelectedDay(cell.day)
                        }
                        disabled={disabled}
                        aria-label={`${cell.date.getDate()} ${
                          hasSlots && !disabled ? "— times available" : "— unavailable"
                        }`}
                        aria-pressed={isSelected}
                        className={cn(
                          // 40px minimum so a thumb can hit a date reliably.
                          "tnum relative flex h-10 items-center justify-center rounded-ctl border text-base transition-colors duration-fast",
                          isSelected
                            ? "border-accent bg-accent font-bold text-white"
                            : disabled
                              ? "cursor-not-allowed border-transparent text-muted/35"
                              : "border-transparent font-semibold text-ink hover:bg-accent-soft",
                        )}
                      >
                        {cell.date.getDate()}
                        {/* Availability dot: never colour alone — the enabled
                            state and label carry it too. */}
                        {hasSlots && !disabled && !isSelected && (
                          <span
                            className="absolute bottom-1 h-1 w-1 rounded-full bg-accent-rail"
                            aria-hidden
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Card>
            </section>

            <section className="flex flex-col gap-2 pb-2">
              <Eyebrow>
                {selectedDay
                  ? fmtDayManila(`${selectedDay}T00:00:00+08:00`)
                  : "Available times"}
              </Eyebrow>
              {selectedDay && selectedSlots.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {selectedSlots.slice(0, 10).map((s: any) => (
                    <button
                      key={s.startUtc}
                      onClick={() => setPicked(s)}
                      className={cn(
                        "tnum flex min-h-[46px] items-center justify-center rounded-ctl border border-line bg-surface",
                        "text-base font-semibold text-ink transition-colors duration-fast",
                        "hover:border-accent hover:bg-accent-soft hover:text-accent",
                      )}
                    >
                      {fmtTimeManila(s.startUtc)}
                    </button>
                  ))}
                </div>
              ) : (
                <Empty>
                  {selectedDay
                    ? "No open times that day. Try another day."
                    : "No open times — try another doctor or visit type."}
                </Empty>
              )}
            </section>
          </>
        )}

        <p className="pt-2 text-center text-sm leading-relaxed text-muted">
          For medical concerns call (02) 8641 0117.
        </p>
      </div>

      {/* Confirm booking */}
      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title="Confirm this booking?"
        sheetOnMobile
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicked(null)}>
              Back
            </Button>
            <Button disabled={busy} loading={busy} onClick={book}>
              Book it
            </Button>
          </>
        }
      >
        {picked && (
          <div className="flex flex-col gap-1">
            <span className="tnum text-lg font-bold text-ink">
              {fmtWhenManila(picked.startUtc)}
            </span>
            <span className="text-base text-muted">
              {typeLabel(type)} with{" "}
              {doctors.find((d) => d.id === doctorId)?.name}
            </span>
            <span className="text-base text-muted">
              Riverside Family Clinic
            </span>
          </div>
        )}
      </Modal>

      {/* Cancel */}
      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Cancel this visit?"
        sheetOnMobile
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              loading={busy}
              onClick={() => act(cancelTarget, "cancel")}
            >
              Yes, cancel
            </Button>
          </>
        }
      >
        {cancelTarget && (
          <p>
            <span className="tnum font-semibold text-ink">
              {fmtWhenManila(cancelTarget.startUtc)}
            </span>{" "}
            with {cancelTarget.doctorName}. Your slot goes back to the clinic and
            may be offered to someone on the waitlist.
          </p>
        )}
      </Modal>
    </PatientShell>
  );
}
