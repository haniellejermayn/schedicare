"use client";

import { useEffect, useState } from "react";
import { Button, Spinner, cn } from "@/components/ui";
import { jfetch, fmtWhenManila } from "@/lib/format";

export type ManualSlot = {
  doctorId: string;
  doctorName?: string;
  startUtc: string;
};

export function ManualSlotPicker({
  initialDoctorId,
  name,
  selected,
  onSelect,
  searchSlots,
  emptyMessage = "No open times satisfy the rules and calendar for that doctor and day.",
}: {
  initialDoctorId?: string;
  name: string;
  selected: ManualSlot | null;
  onSelect: (slot: ManualSlot | null) => void;
  searchSlots: (
    doctorId: string,
    day: string,
  ) => Promise<{ slots: ManualSlot[]; totalCount?: number }>;
  emptyMessage?: string;
}) {
  const [doctors, setDoctors] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [doctorId, setDoctorId] = useState(initialDoctorId ?? "");
  const [day, setDay] = useState("");
  const [result, setResult] = useState<{
    slots: ManualSlot[];
    totalCount?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    jfetch<any>("/api/doctors")
      .then((r) => {
        const next = r.doctors ?? [];
        setDoctors(next);
        setDoctorId((current) => current || initialDoctorId || next[0]?.id || "");
      })
      .catch((e) => setError((e as Error).message));
  }, [initialDoctorId]);

  const resetResults = () => {
    setResult(null);
    setError(null);
    onSelect(null);
  };

  const find = async () => {
    if (!doctorId || !day) return;
    setBusy(true);
    setError(null);
    onSelect(null);
    try {
      setResult(await searchSlots(doctorId, day));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={doctorId}
          onChange={(e) => {
            setDoctorId(e.target.value);
            resetResults();
          }}
          aria-label="Doctor"
          className="rounded-ctl border border-line bg-white px-2 py-1.5 text-[13px] font-semibold outline-none focus:border-accent"
        >
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            resetResults();
          }}
          aria-label="Day"
          className="tnum rounded-ctl border border-line px-2 py-1.5 text-[13px] outline-none focus:border-accent"
        />
        <Button
          variant="secondary"
          small
          disabled={busy || !doctorId || !day}
          onClick={find}
        >
          {busy ? <Spinner /> : "Find times"}
        </Button>
      </div>

      {result && (
        <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto thin-scroll pr-1">
          {result.slots.length === 0 && (
            <p className="text-[13px] text-muted">{emptyMessage}</p>
          )}
          {result.totalCount != null && result.totalCount > result.slots.length && (
            <p className="text-[12px] text-muted">
              Showing {result.slots.length} of {result.totalCount} valid times.
            </p>
          )}
          {result.slots.map((slot) => (
            <label
              key={`${slot.doctorId}|${slot.startUtc}`}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-ctl border px-3 py-2",
                selected?.doctorId === slot.doctorId &&
                  selected?.startUtc === slot.startUtc
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-white hover:border-strong",
              )}
            >
              <input
                type="radio"
                name={name}
                checked={
                  selected?.doctorId === slot.doctorId &&
                  selected?.startUtc === slot.startUtc
                }
                onChange={() => onSelect(slot)}
                className="accent-accent"
              />
              <span className="tnum text-[14px] font-semibold text-ink">
                {fmtWhenManila(slot.startUtc)}
              </span>
              {slot.doctorName && (
                <span className="text-[13px] text-muted">{slot.doctorName}</span>
              )}
            </label>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
    </div>
  );
}
