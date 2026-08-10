"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { usePoll } from "@/lib/usePoll";
import { fmtTimeManila, jfetch, typeLabel } from "@/lib/format";
import { Button, Empty, Modal, Spinner } from "@/components/ui";

const TYPES = ["routine", "follow_up", "urgent"] as const;

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

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dateOffset, setDateOffset] = useState(0);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [monthDate, setMonthDate] = useState(() => new Date());

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
  const availableDates = Object.keys(slotMap).filter((d) => d >= today).sort();
  const pageSize = 5;
  const visibleDates = availableDates.slice(dateOffset, dateOffset + pageSize);
  const canPrev = dateOffset > 0;
  const canNext = dateOffset + pageSize < availableDates.length;

  const availableDateSet = useMemo(() => new Set(availableDates), [availableDates]);

  const monthCells = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { day: string; date: Date; inMonth: boolean }[] = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ day: toDayKey(d), date: d, inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      cells.push({ day: toDayKey(date), date, inMonth: true });
    }
    const total = 42;
    while (cells.length < total) {
      const last = cells[cells.length - 1].date;
      const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      cells.push({ day: toDayKey(next), date: next, inMonth: false });
    }
    return cells;
  }, [monthDate]);

  useEffect(() => {
    setDateOffset((prev) => Math.min(prev, Math.max(0, availableDates.length - pageSize)));
  }, [availableDates.length]);

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
        {availableDates.length === 0 ? (
          <div className="mt-1"><Empty>No open slots for this doctor and type.</Empty></div>
        ) : (
          <div className="mt-1 rounded-card border border-line bg-white p-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDateOffset((prev) => Math.max(0, prev - pageSize))}
                disabled={!canPrev}
                className="rounded border border-line px-1.5 py-1 text-[13px] text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Previous dates"
              >
                ‹
              </button>
              <div className="grid flex-1 grid-cols-5 gap-1">
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
                      type="button"
                      onClick={() => {
                        setSelectedDay(day);
                        setSlot("");
                      }}
                      className={[
                        "rounded border px-1 py-1 text-center text-[10px] font-bold transition",
                        isSelected
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line bg-white text-ink hover:border-accent hover:bg-accent-soft",
                        !isSelected ? "text-muted" : "",
                      ].join(" ")}
                    >
                      <span className="block">{weekday}</span>
                      <span className="tnum block text-[12px] leading-none">{dayNum}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() =>
                  setDateOffset((prev) =>
                    Math.min(prev + pageSize, Math.max(0, availableDates.length - pageSize)),
                  )
                }
                disabled={!canNext}
                className="rounded border border-line px-1.5 py-1 text-[13px] text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Next dates"
              >
                ›
              </button>
            </div>
            <div className="mt-1 text-center">
              <button
                type="button"
                onClick={() => {
                  setMonthDate(new Date());
                  setExpandedOpen(true);
                }}
                className="text-[12px] font-semibold text-accent hover:underline"
              >
                Pick a date
              </button>
            </div>
            {selectedDay && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {selectedDay && slotMap[selectedDay]?.length ? (
                  slotMap[selectedDay].slice(0, 6).map((s: any) => (
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
                  ))
                ) : (
                  <p className="text-[11px] text-muted">No slots on this day</p>
                )}
              </div>
            )}
          </div>
        )}
      </label>
      <p className="mt-1 text-[11px] text-muted">The selected time is checked again before the appointment is saved.</p>

      {/* Expanded calendar picker */}
      <Modal
        open={expandedOpen}
        onClose={() => setExpandedOpen(false)}
        title="Pick a date"
      >
        <div className="p-1">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))
              }
              className="rounded border border-line px-2 py-1 text-[13px] text-muted hover:text-ink"
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="text-[13px] font-bold text-ink">
              {monthDate.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              type="button"
              onClick={() =>
                setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))
              }
              className="rounded border border-line px-2 py-1 text-[13px] text-muted hover:text-ink"
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className="mt-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-muted">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>
          <div className="mt-0.5 grid grid-cols-7 gap-0.5">
            {monthCells.map((cell, idx) => {
              const isAvailable = availableDateSet.has(cell.day) && cell.day >= today;
              const isSelected = selectedDay === cell.day;
              const isDisabled = !cell.inMonth || !isAvailable;
              return (
                <button
                  key={`${cell.day}-${idx}`}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    setSelectedDay(cell.day);
                    setSlot("");
                    setExpandedOpen(false);
                  }}
                  className={[
                    "flex h-8 items-center justify-center rounded text-[12px] font-medium transition",
                    !cell.inMonth ? "text-muted/30" : "text-ink",
                    isSelected ? "bg-accent-soft font-bold text-accent" : "",
                    isAvailable && !isSelected ? "hover:bg-accent-soft" : "",
                    isDisabled ? "cursor-not-allowed opacity-40" : "",
                  ].join(" ")}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
