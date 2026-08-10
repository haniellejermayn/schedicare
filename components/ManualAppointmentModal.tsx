"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { usePoll } from "@/lib/usePoll";
import { fmtWhenManila, jfetch, typeLabel } from "@/lib/format";
import { Button, Empty, Modal, Spinner } from "@/components/ui";

const TYPES = ["routine", "follow_up", "urgent"] as const;

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

  useEffect(() => {
    if (!patientId && patients[0]) setPatientId(patients[0].id);
  }, [patientId, patients]);
  useEffect(() => {
    if (!doctorId && doctors[0]) setDoctorId(doctors[0].id);
  }, [doctorId, doctors]);
  useEffect(() => setSlot(""), [doctorId, type]);

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
          <select value={slot} onChange={(e) => setSlot(e.target.value)} className="mt-1 w-full rounded-ctl border border-line bg-white px-3 py-2 text-[14px] text-ink">
            <option value="">Select a time</option>
            {slots.map((item: any) => <option key={item.startUtc} value={item.startUtc}>{fmtWhenManila(item.startUtc)}</option>)}
          </select>
        )}
      </label>
      <p className="mt-1 text-[11px] text-muted">The selected time is checked again before the appointment is saved.</p>
    </Modal>
  );
}
