"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { usePoll } from "@/lib/usePoll";
import { fmtTimeManila, jfetch, typeLabel } from "@/lib/format";
import { Button, Empty, Modal, Spinner } from "@/components/ui";

const TYPES = ["routine", "follow_up", "urgent"] as const;

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function toDayKey(date: Date): string {
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

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
}

function SearchSelect({
  items,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  items: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = items.find((i) => i.id === value);

  const filtered = query.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setOpen(true);
  }

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && open && filtered.length > 0) {
      select(filtered[0].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative mt-1">
      <input
        type="text"
        value={open ? query : selected?.label ?? ""}
        onChange={handleInputChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleInputKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="w-full rounded-ctl border border-line bg-white px-3 py-2 text-[14px] text-ink placeholder:text-muted outline-none focus:border-accent"
      />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-auto rounded-ctl border border-line bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted">No matches</li>
          ) : (
            filtered.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(i.id);
                  }}
                  className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-accent-soft focus:bg-accent-soft focus:outline-none"
                >
                  {i.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export function ManualAppointmentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const { data: patientData, refresh: refreshPatients } = usePoll<any>(open ? "/api/patients" : null, 30000);
  const { data: doctorData } = usePoll<any>(open ? "/api/doctors" : null, 30000);
  const patients = patientData?.patients ?? [];
  const doctors = doctorData?.doctors ?? [];
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("routine");
  const [slot, setSlot] = useState("");
  const [addingPatient, setAddingPatient] = useState(false);
  const [patientForm, setPatientForm] = useState({ name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slotUrl = open && doctorId ? `/api/slots?doctorId=${doctorId}&type=${type}` : null;
  const { data: slotData, refresh: refreshSlots } = usePoll<any>(slotUrl, 8000);
  const slots = slotData?.slots ?? [];

  const slotMap = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const s of slots) (m[s.day] ??= []).push(s);
    return m;
  }, [slots]);

  const [monthDate, setMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId && patients[0]) setPatientId(patients[0].id);
  }, [patientId, patients]);
  useEffect(() => {
    if (!doctorId && doctors[0]) setDoctorId(doctors[0].id);
  }, [doctorId, doctors]);
  useEffect(() => {
    setSlot("");
    setSelectedDay(null);
  }, [doctorId, type]);

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

  useEffect(() => {
    if (selectedDay && slot) {
      const daySlots = slotMap[selectedDay] ?? [];
      if (!daySlots.some((s: any) => s.startUtc === slot)) {
        setSlot("");
      }
    }
  }, [selectedDay, slotMap]);

  const today = toDayKey(new Date());

  const monthCells = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { date: Date; inMonth: boolean; day: string }[] = [];

    // Previous month days
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, inMonth: false, day: toDayKey(d) });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      cells.push({ date, inMonth: true, day: toDayKey(date) });
    }

    // Fill remaining cells to complete a 42-cell grid
    const total = 42;
    while (cells.length < total) {
      const last = cells[cells.length - 1].date;
      const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      cells.push({ date: next, inMonth: false, day: toDayKey(next) });
    }
    return cells;
  }, [monthDate]);

  async function addPatient() {
    setBusy(true);
    setError(null);
    try {
      const result = await jfetch<any>("/api/patients", {
        method: "POST",
        body: JSON.stringify(patientForm),
      });
      setPatientId(result.patient.id);
      setPatientForm({ name: "", email: "", phone: "" });
      setAddingPatient(false);
      refreshPatients();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createAppointment() {
    if (!patientId || !doctorId || !slot) return;
    setBusy(true);
    setError(null);
    try {
      const result = await jfetch<any>("/api/appointments", {
        method: "POST",
        body: JSON.stringify({ patientId, doctorId, type, startUtc: slot, bookedBy: "staff" }),
      });
      onCreated(`Appointment created for ${result.when}. (${result.calendar})`);
      setSlot("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSlot("");
      refreshSlots();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New appointment"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !patientId || !doctorId || !slot} onClick={createAppointment}>
            {busy ? <Spinner /> : "Create appointment"}
          </Button>
        </>
      }
    >
      {error && <p className="mb-3 rounded-ctl border border-bad-line bg-bad-soft px-3 py-2 text-[13px] font-semibold text-bad">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] font-bold text-muted">
          Patient
          <SearchSelect
            items={patients.map((patient: any) => ({ id: patient.id, label: patient.name }))}
            value={patientId}
            onChange={setPatientId}
            placeholder="Select patient"
            ariaLabel="Patient"
          />
        </label>
        <label className="text-[12px] font-bold text-muted">
          Doctor
          <SearchSelect
            items={doctors.map((doctor: any) => ({ id: doctor.id, label: doctor.name }))}
            value={doctorId}
            onChange={setDoctorId}
            placeholder="Select doctor"
            ariaLabel="Doctor"
          />
        </label>
      </div>

      <button className="mt-2 text-[12px] font-semibold text-accent hover:underline" onClick={() => setAddingPatient((value) => !value)}>
        {addingPatient ? "Use an existing patient" : "Add a new patient"}
      </button>
      {addingPatient && (
        <div className="mt-2 rounded-card border border-line bg-paper p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={patientForm.name} onChange={(e) => setPatientForm({ ...patientForm, name: e.target.value })} placeholder="Name" className="rounded-ctl border border-line px-3 py-2 text-[13px]" />
            <input value={patientForm.email} onChange={(e) => setPatientForm({ ...patientForm, email: e.target.value })} placeholder="Email" type="email" className="rounded-ctl border border-line px-3 py-2 text-[13px]" />
            <input value={patientForm.phone} onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })} placeholder="Phone (optional)" className="rounded-ctl border border-line px-3 py-2 text-[13px]" />
            <Button small variant="secondary" disabled={busy || !patientForm.name.trim() || !patientForm.email.trim()} onClick={addPatient}>
              {busy ? <Spinner /> : "Save patient"}
            </Button>
          </div>
        </div>
      )}

      <p className="mt-3 text-[12px] font-bold text-muted">Appointment type</p>
      <div className="mt-1 flex gap-2">
        {TYPES.map((item) => (
          <Button key={item} small variant={type === item ? "primary" : "secondary"} onClick={() => setType(item)}>
            {typeLabel(item)}
          </Button>
        ))}
      </div>

      <label className="mt-3 block text-[12px] font-bold text-muted">
        Valid date and time
        {slots.length === 0 ? (
          <div className="mt-1"><Empty>No open slots for this doctor and type.</Empty></div>
        ) : (
          <div className="mt-1 rounded-card border border-line bg-white p-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-ink">{monthLabel(monthDate)}</span>
              <div className="flex gap-1 text-[13px] text-muted">
                <button
                  type="button"
                  onClick={() =>
                    setMonthDate(
                      new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1),
                    )
                  }
                  className="cursor-pointer hover:text-ink"
                  aria-label="Previous month"
                >
                  &lt;
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMonthDate(
                      new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1),
                    )
                  }
                  className="cursor-pointer hover:text-ink"
                  aria-label="Next month"
                >
                  &gt;
                </button>
              </div>
            </div>
            <div className="mt-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-muted">
              {DAY_LABELS.map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
            <div className="mt-0.5 grid grid-cols-7 gap-0.5">
              {monthCells.map((cell, idx) => {
                const hasSlots = Boolean(slotMap[cell.day]?.length);
                const isSelected = cell.day === selectedDay;
                const isOutside = !cell.inMonth;
                const isPast = cell.day < today;
                const isDisabled = isPast || (!hasSlots && !isOutside);
                return (
                  <button
                    key={`${cell.day}-${idx}`}
                    type="button"
                    disabled={isDisabled}
                    onClick={
                      !isDisabled
                        ? () => {
                            setSelectedDay(cell.day);
                            setSlot("");
                          }
                        : undefined
                    }
                    className={[
                      "flex h-7 items-center justify-center rounded border text-[11px] font-medium transition",
                      isOutside ? "border-transparent text-muted/40" : "border-transparent text-ink",
                      isDisabled ? "cursor-not-allowed text-muted/30" : "",
                      hasSlots && !isOutside && !isSelected && !isDisabled
                        ? "font-bold text-accent hover:bg-accent-soft"
                        : "",
                      isSelected && !isDisabled ? "border-accent bg-accent-soft text-accent" : "",
                    ].join(" ")}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
            {selectedDay && slotMap[selectedDay]?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {slotMap[selectedDay]
                  .slice(0, 6)
                  .map((s: any) => (
                    <button
                      key={s.startUtc}
                      type="button"
                      onClick={() => setSlot(s.startUtc)}
                      className={[
                        "tnum rounded-full border px-2.5 py-1 text-[11px] font-bold transition",
                        slot === s.startUtc
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line bg-white text-ink hover:border-accent hover:bg-accent-soft",
                      ].join(" ")}
                    >
                      {fmtTimeManila(s.startUtc)}
                    </button>
                  ))}
              </div>
            ) : (
              selectedDay && <p className="mt-1 text-[11px] text-muted">No slots</p>
            )}
          </div>
        )}
      </label>
      <p className="mt-1 text-[11px] text-muted">The selected time is checked again before the appointment is saved.</p>
    </Modal>
  );
}
