"use client";
import { useEffect, useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import { jfetch, fmtTimeManila, typeLabel } from "@/lib/format";
import {
  Button,
  Card,
  Chip,
  Empty,
  Modal,
  PageTitle,
  RailRow,
  Spinner,
  Tabs,
  cn,
} from "@/components/ui";
import { appointmentStatus } from "@/components/copy";
import { WeekCalendar } from "@/components/WeekCalendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Tab = "today" | "week" | "rules";
type VisitType = "follow_up" | "routine" | "urgent";
type TypeFilter = "all" | VisitType;

const OUT_REASONS = [
  "Family emergency",
  "Sick — can't see patients",
  "Personal emergency",
  "Transport problem",
  "Other",
] as const;

/** 08:00–17:00 in 30-minute steps — the calendar's visible band. */
const TIME_OPTIONS = Array.from({ length: 19 }, (_, i) => {
  const h = 8 + Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

/** Day range for the visual time windows: 08:00 – 17:00 (540 min). */
const DAY_START = 8 * 60;
const DAY_END = 17 * 60;
const DAY_LEN = DAY_END - DAY_START;

const TYPE_COLORS = {
  follow_up: "#5B8C6E",
  routine: "#5C7D90",
  urgent: "#B87050",
} as const;

const TYPE_BG = {
  follow_up: "#E9F1EC",
  routine: "#E7EEF1",
  urgent: "#F7EEE8",
} as const;

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function manilaDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function apptMinutes(a: { startUtc: string; endUtc: string }): number {
  return Math.max(
    1,
    Math.round(
      (new Date(a.endUtc).getTime() - new Date(a.startUtc).getTime()) / 60000,
    ),
  );
}

function fmtDayLabel(day: string): string {
  return new Date(`${day}T00:00:00+08:00`).toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

/** Circular progress ring used in the daily caps / rest buffer section. */
function Ring({
  percent,
  color = "#3F6F52",
  size = 80,
  strokeWidth = 7,
  children,
}: {
  percent: number;
  color?: string;
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#dadada"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: number | undefined;
  editing: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      {editing ? (
        <input
          type="number"
          min={0}
          value={value ?? 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
          className="tnum mt-1 w-20 rounded-ctl border border-line px-2 py-1 text-[13px] outline-none focus:border-accent"
        />
      ) : (
        <p className="tnum mt-1 text-[14px] font-bold text-ink">
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

/** One "HH:MM-HH:MM" window as a pair of selects. */
function WindowRow({
  value,
  onChange,
  onRemove,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [start = "08:00", end = "17:00"] = value.split("-");
  const sel =
    "rounded-ctl border border-line bg-white px-2 py-1 tnum text-[13px] outline-none focus:border-accent";
  return (
    <div className="flex items-center gap-1.5">
      <select
        className={sel}
        value={start}
        onChange={(e) => onChange(`${e.target.value}-${end}`)}
        aria-label="Window start"
      >
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t} disabled={t >= end}>
            {t}
          </option>
        ))}
      </select>
      <span className="text-[12px] text-muted">to</span>
      <select
        className={sel}
        value={end}
        onChange={(e) => onChange(`${start}-${e.target.value}`)}
        aria-label="Window end"
      >
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t} disabled={t <= start}>
            {t}
          </option>
        ))}
      </select>
      <button
        onClick={onRemove}
        aria-label="Remove window"
        className="rounded-ctl px-1.5 py-0.5 text-[13px] font-bold text-muted hover:text-bad"
      >
        ×
      </button>
    </div>
  );
}

export default function DoctorPage() {
  const { data: docList } = usePoll<any>("/api/doctors", 60000);
  const doctors: Array<{ id: string; name: string }> = docList?.doctors ?? [
    { id: "doc_santos", name: "Dr. Elena Santos" },
    { id: "doc_reyes", name: "Dr. Marco Reyes" },
  ];
  const [doctorId, setDoctorId] = useState("doc_santos");
  const { data, refresh } = usePoll<any>(`/api/doctor/${doctorId}`, 3000);
  const [tab, setTab] = useState<Tab>("today");
  const [todayView, setTodayView] = useState<"grid" | "list">("list");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [outDate, setOutDate] = useState<string>("");
  const [outReason, setOutReason] =
    useState<(typeof OUT_REASONS)[number]>("Family emergency");
  const [outNote, setOutNote] = useState("");
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
  useEffect(() => {
    if (demoDay && !outDate) setOutDate(demoDay);
  }, [demoDay, outDate]);

  const appts = data?.appointments ?? [];
  const operationalAppts = useMemo(
    () =>
      appts.filter(
        (a: any) =>
          ["booked", "confirmed"].includes(a.status) &&
          (typeFilter === "all" || a.type === typeFilter),
      ),
    [appts, typeFilter],
  );
  const today = operationalAppts.filter(
    (a: any) => manilaDay(a.startUtc) === demoDay,
  );
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
      const key = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
      }).format(d);
      days[key] = operationalAppts.filter(
        (a: any) => manilaDay(a.startUtc) === key,
      );
    }
    return days;
  }, [operationalAppts, demoDay]);
  const todayMap = useMemo(
    () => (demoDay ? { [demoDay]: today } : {}),
    [demoDay, today],
  );

  const isUnavailableToday = (doctor?.unavailableDates ?? []).includes(demoDay);
  const upcomingOut: string[] = (doctor?.unavailableDates ?? [])
    .filter((d: string) => d > demoDay)
    .sort();

  async function markUnavailable() {
    setBusy(true);
    try {
      const reason =
        outReason === "Other"
          ? outNote.trim() || "Unavailable"
          : outReason + (outNote.trim() ? ` — ${outNote.trim()}` : "");
      const res = await jfetch<any>(`/api/doctor/${doctorId}/unavailable`, {
        method: "POST",
        body: JSON.stringify({ date: outDate || demoDay, reason }),
      });
      setEmergencyOpen(false);
      const dayWord =
        res.date === demoDay ? "today" : `on ${fmtDayLabel(res.date)}`;
      setDone(
        res.affected > 0
          ? `Told the front desk. ${res.affected} patient${res.affected === 1 ? "" : "s"} ${dayWord} will get new suggestions to review.`
          : `Told the front desk. No visits were booked ${dayWord}, so nothing needs rebooking.`,
      );
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    setBusy(true);
    try {
      await jfetch(`/api/doctor/${doctorId}/rules`, {
        method: "PUT",
        body: JSON.stringify(rulesDraft),
      });
      setRulesDraft(null);
      setRulesMsg("Saved. New suggestions follow these rules right away.");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const r = rulesDraft ?? rules;
  const cap = rules?.maxPerDay ?? 0;

  const filterSelect = (
    <select
      value={typeFilter}
      onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
      aria-label="Filter by visit type"
      className="rounded-ctl border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink outline-none focus:border-accent"
    >
      <option value="all">All visit types</option>
      <option value="follow_up">Follow-up</option>
      <option value="routine">Routine</option>
      <option value="urgent">Urgent</option>
    </select>
  );

  return (
    <div className="space-y-5">
      <PageTitle
        right={
          <div className="flex items-center rounded-full border border-line bg-white p-0.5">
            {doctors.map((d) => (
              <button
                key={d.id}
                onClick={() => setDoctorId(d.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-[13px] font-semibold",
                  doctorId === d.id
                    ? "bg-ink text-white shadow-cut"
                    : "text-muted hover:text-ink",
                )}
              >
                {d.name.replace(/^Dr\.\s*(\S+)\s+/, "Dr. ").trim()}
              </button>
            ))}
          </div>
        }
      >
        {doctor?.name ?? "Doctor"}
      </PageTitle>

      {/* Availability strip — deliberately NOT a RailRow, so it reads as a
          console control, not another event in the list. */}
      {isUnavailableToday ? (
        <div className="rounded-card border border-bad-line bg-bad-soft px-4 py-3">
          <p className="eyebrow !text-bad">Marked out today</p>
          <p className="mt-1 text-[14px] font-semibold text-ink">
            The front desk is rebooking your patients — nothing else for you to
            do.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-strong px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Availability</p>
            <p className="mt-0.5 text-[14px] font-semibold text-ink">
              Can&apos;t come in?
            </p>
            <p className="text-[13px] text-muted">
              Pick the day, and the front desk starts rebooking. Nothing reaches
              patients until staff approve.
            </p>
          </div>
          <Button variant="danger" onClick={() => setEmergencyOpen(true)}>
            I can&apos;t come in…
          </Button>
        </div>
      )}
      {upcomingOut.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          Also marked out:
          {upcomingOut.map((d) => (
            <Chip key={d} tone="bad">
              {fmtDayLabel(d)}
            </Chip>
          ))}
        </div>
      )}
      {done && <p className="text-[13px] font-semibold text-ok">{done}</p>}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "today", label: "Today", count: today.length },
          { id: "week", label: "This week" },
          { id: "rules", label: "My rules" },
        ]}
      />

      {tab === "today" && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {cap > 0 ? (
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{
                      width: `${Math.min(100, (today.length / cap) * 100)}%`,
                    }}
                  />
                </div>
                {today.length} of {cap} booked
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {filterSelect}
              <div
                className="flex items-center rounded-full border border-line bg-white p-0.5"
                role="group"
                aria-label="Today view"
              >
                {(["list", "grid"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTodayView(v)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
                      todayView === v
                        ? "bg-ink text-white"
                        : "text-muted hover:text-ink",
                    )}
                  >
                    {v === "grid" ? "Day view" : "List"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {todayView === "grid" ? (
            <WeekCalendar
              week={todayMap}
              riskById={riskById}
              today={demoDay}
              rules={rules}
              externalBusy={(data?.externalBusy ?? []).filter(
                (b: any) => manilaDay(b.startUtc) === demoDay,
              )}
              unavailableDates={doctor?.unavailableDates ?? []}
            />
          ) : (
            <>
              {today.length === 0 && (
                <Empty>
                  No visits scheduled today
                  {typeFilter !== "all" ? " for this visit type" : ""}.
                </Empty>
              )}
              {today.map((a: any) => {
                const st = appointmentStatus(a);
                const risk = riskById[a.id];
                return (
                  <RailRow
                    key={a.id}
                    tone={
                      a.status === "confirmed"
                        ? "ok"
                        : a.status === "booked"
                          ? "warn"
                          : "neutral"
                    }
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="tnum w-[72px] text-[14px] font-bold text-ink">
                      {fmtTimeManila(a.startUtc)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-ink">
                        {a.patientName}
                      </p>
                      <p className="text-[12px] text-muted">
                        {typeLabel(a.type)} · {apptMinutes(a)} min
                      </p>
                    </div>
                    {risk && risk.band !== "low" && (
                      <Chip tone="warn">May not show</Chip>
                    )}
                    <Chip tone={st.tone}>{st.label}</Chip>
                  </RailRow>
                );
              })}
            </>
          )}
          <p className="pt-1 text-[11px] text-muted">
            Scheduled visits shown; walk-ins are handled at the front desk and
            don&apos;t appear here.
          </p>
        </div>
      )}

      {tab === "week" && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-end">{filterSelect}</div>
          <WeekCalendar
            week={week}
            riskById={riskById}
            today={demoDay}
            rules={rules}
            externalBusy={data?.externalBusy ?? []}
            unavailableDates={doctor?.unavailableDates ?? []}
          />
        </div>
      )}

      {tab === "rules" && (
        <Card className="p-4 bg-surface-strong">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[15px] font-bold text-ink">
              Scheduling rules
            </h2>
            {rulesDraft ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  small
                  onClick={() => setRulesDraft(null)}
                >
                  Cancel
                </Button>
                <Button small disabled={busy} onClick={saveRules}>
                  {busy ? <Spinner /> : "Save changes"}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                small
                onClick={() => setRulesDraft(JSON.parse(JSON.stringify(rules)))}
              >
                Edit
              </Button>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-muted">
            Every suggestion the system makes must fit these. Changes apply
            immediately.
          </p>
          {rulesMsg && (
            <p className="mt-2 text-[12px] font-semibold text-ok">{rulesMsg}</p>
          )}
          {!r ? (
            <div className="mt-3">
              <Empty>Loading…</Empty>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {/* 01 · Active Work Days */}
              <div>
                <p className="eyebrow">01 · Active Work Days</p>
                <div className="mt-1.5 flex gap-1.5">
                  {WEEKDAYS.map((w, i) => {
                    const dow = i + 1;
                    const on = r.workDays.includes(dow);
                    return (
                      <button
                        key={w}
                        disabled={!rulesDraft}
                        onClick={() =>
                          setRulesDraft((d: any) => ({
                            ...d,
                            workDays: on
                              ? d.workDays.filter((x: number) => x !== dow)
                              : [...d.workDays, dow].sort(),
                          }))
                        }
                        className={cn(
                          "flex-1 rounded-lg border py-2 text-center text-sm font-semibold transition",
                          on
                            ? "border-line bg-surface-strong text-ink/60" 
                            : "border-line bg-surface-alt text-muted",
                          rulesDraft && "cursor-pointer",
                        )}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 02 · Visit Types & Allowed Hours */}
              <div>
                <p className="eyebrow">02 · Visit Types &amp; Allowed Hours</p>
                {rulesDraft ? (
                  <div className="mt-2 space-y-2.5">
                    {(["follow_up", "routine", "urgent"] as const).map((t) => {
                      const windows: string[] = r.windows[t] ?? [];
                      return (
                        <div key={t} className="flex flex-wrap items-start gap-2">
                          <Chip
                            tone={
                              t === "urgent"
                                ? "bad"
                                : t === "follow_up"
                                  ? "accent"
                                  : "neutral"
                            }
                            className="mt-0.5 w-24 justify-center"
                          >
                            {typeLabel(t)}
                          </Chip>
                          <div className="flex flex-1 flex-col gap-1.5">
                            {windows.map((w, i) => (
                              <WindowRow
                                key={`${t}-${i}`}
                                value={w}
                                onChange={(v) =>
                                  setRulesDraft((d: any) => {
                                    const next = [...(d.windows[t] ?? [])];
                                    next[i] = v;
                                    return {
                                      ...d,
                                      windows: { ...d.windows, [t]: next },
                                    };
                                  })
                                }
                                onRemove={() =>
                                  setRulesDraft((d: any) => ({
                                    ...d,
                                    windows: {
                                      ...d.windows,
                                      [t]: (d.windows[t] ?? []).filter(
                                        (_: string, j: number) => j !== i,
                                      ),
                                    },
                                  }))
                                }
                              />
                            ))}
                            <button
                              onClick={() =>
                                setRulesDraft((d: any) => ({
                                  ...d,
                                  windows: {
                                    ...d.windows,
                                    [t]: [
                                      ...(d.windows[t] ?? []),
                                      "08:00-12:00",
                                    ],
                                  },
                                }))
                              }
                              className="self-start text-[12px] font-semibold text-accent hover:underline"
                            >
                              + Add window
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {(["follow_up", "routine", "urgent"] as const).map((t) => {
                      const windows = r.windows[t] ?? [];
                      const duration = r.durationMin?.[t] ?? 30;
                      return (
                        <div
                          key={t}
                          className="rounded-card border border-line bg-surface-alt p-4" // Removed inline borderColor style, added border-line
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-full"
                              style={{
                                backgroundColor: TYPE_BG[t],
                                color: TYPE_COLORS[t],
                                border: `1px solid ${TYPE_COLORS[t]}55`,
                              }}
                            >
                              {typeLabel(t)}
                            </span>
                            <span className="font-display text-2xl font-bold text-ink">
                              {duration}
                              <span className="ml-1 text-xs font-normal text-muted">
                                min
                              </span>
                            </span>
                          </div>

                          <div className="relative mt-4 h-5 rounded-lg bg-black/5 border border-line overflow-hidden">
                            {windows.map((w, i) => {
                              const [s0 = "08:00", s1 = "17:00"] = w.split("-");
                              const startMin = timeToMin(s0);
                              const endMin = timeToMin(s1);
                              const left =
                                ((Math.max(startMin, DAY_START) - DAY_START) /
                                  DAY_LEN) *
                                100;
                              const width =
                                ((Math.min(endMin, DAY_END) -
                                  Math.max(startMin, DAY_START)) /
                                  DAY_LEN) *
                                100;
                              return (
                                <div
                                  key={i}
                                  className="absolute top-0 bottom-0 rounded"
                                  style={{
                                    left: `${left}%`,
                                    width: `${Math.max(0, width)}%`,
                                    backgroundColor: TYPE_COLORS[t],
                                  }}
                                />
                              );
                            })}
                          </div>
                          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
                            <span>8am</span>
                            <span>12pm</span>
                            <span>5pm</span>
                          </div>

                          <p className="mt-2 text-[11px] text-muted">
                            Allowed Window
                          </p>
                          <p className="text-sm font-bold text-ink">
                            {windows.length > 0
                              ? windows.join("  &  ")
                              : "Not bookable"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 03 · Daily Caps & Rest Buffer */}
              <div>
                <p className="eyebrow">03 · Daily Caps &amp; Rest Buffer</p>
                {rulesDraft ? (
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                    <NumField
                      label="Most visits per day"
                      value={r.maxPerDay}
                      editing={!!rulesDraft}
                      onChange={(v) =>
                        setRulesDraft((d: any) => ({ ...d, maxPerDay: v }))
                      }
                    />
                    <NumField
                      label="Most per morning"
                      value={r.maxPerBlock?.am}
                      editing={!!rulesDraft}
                      onChange={(v) =>
                        setRulesDraft((d: any) => ({
                          ...d,
                          maxPerBlock: { ...d.maxPerBlock, am: v },
                        }))
                      }
                    />
                    <NumField
                      label="Most per afternoon"
                      value={r.maxPerBlock?.pm}
                      editing={!!rulesDraft}
                      onChange={(v) =>
                        setRulesDraft((d: any) => ({
                          ...d,
                          maxPerBlock: { ...d.maxPerBlock, pm: v },
                        }))
                      }
                    />
                    <NumField
                      label="Break after each visit (min)"
                      value={r.bufferAfterMin}
                      editing={!!rulesDraft}
                      onChange={(v) =>
                        setRulesDraft((d: any) => ({ ...d, bufferAfterMin: v }))
                      }
                    />
                  </div>
                ) : (
                  (() => {
                    const dailyMax = r.maxPerDay ?? 0;
                    const morningMax = r.maxPerBlock?.am ?? 0;
                    const afternoonMax = r.maxPerBlock?.pm ?? 0;
                    const bufferMin = r.bufferAfterMin ?? 0;

                    const dailyPct = dailyMax > 0 ? 100 : 0;
                    const morningPct =
                      dailyMax > 0 ? Math.min(100, (morningMax / dailyMax) * 100) : 0;
                    const afternoonPct =
                      dailyMax > 0 ? Math.min(100, (afternoonMax / dailyMax) * 100) : 0;
                    const bufferPct = Math.min(100, (bufferMin / 60) * 100);

                    return (
                      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-card border border-line bg-surface-alt p-4 text-center">
                          <Ring percent={dailyPct} color="#5B8C6E">
                            <span className="font-display text-2xl font-bold text-ink">
                              {dailyMax || "—"}
                            </span>
                          </Ring>
                          <p className="mt-1 text-[12px] font-semibold text-ink-soft">
                            Max Visits / Day
                          </p>
                        </div>
                        <div className="rounded-card border border-line bg-surface-alt p-4 text-center">
                          <Ring percent={morningPct} color="#5C7D90">
                            <span className="font-display text-2xl font-bold text-ink">
                              {morningMax || "—"}
                            </span>
                          </Ring>
                          <p className="mt-1 text-[12px] font-semibold text-ink-soft">
                            Max Morning
                          </p>
                          <p className="font-mono text-[10px] text-muted">
                            08:00 – 12:00
                          </p>
                        </div>
                        <div className="rounded-card border border-line bg-surface-alt p-4 text-center">
                          <Ring percent={afternoonPct} color="#5C7D90">
                            <span className="font-display text-2xl font-bold text-ink">
                              {afternoonMax || "—"}
                            </span>
                          </Ring>
                          <p className="mt-1 text-[12px] font-semibold text-ink-soft">
                            Max Afternoon
                          </p>
                          <p className="font-mono text-[10px] text-muted">
                            13:00 – 17:00
                          </p>
                        </div>
                        <div className="rounded-card border border-line bg-surface-alt p-4 text-center">
                          <Ring percent={bufferPct} color="#A0791F">
                            <span className="font-display text-2xl font-bold text-ink">
                              {bufferMin || "—"}
                              <span className="ml-1 text-xs font-normal text-muted">
                                min
                              </span>
                            </span>
                          </Ring>
                          <p className="mt-1 text-[12px] font-semibold text-ink-soft">
                            Break Buffer
                          </p>
                          <p className="font-mono text-[10px] text-muted">
                            After each visit
                          </p>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        title="Tell the front desk you're out?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEmergencyOpen(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={busy || !outDate}
              onClick={markUnavailable}
            >
              {busy ? <Spinner /> : "Yes — mark me out"}
            </Button>
          </>
        }
      >
        <p>
          Your visits that day will be cancelled and the system will suggest new
          times for each patient.
          <b> Nothing reaches patients until the front desk approves.</b>
        </p>
        <label
          className="mt-3 block text-[12px] font-bold text-muted"
          htmlFor="out-date"
        >
          Which day?
        </label>
        <input
          id="out-date"
          type="date"
          value={outDate}
          min={demoDay || undefined}
          onChange={(e) => setOutDate(e.target.value)}
          className="tnum mt-1 rounded-ctl border border-line px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
        <label
          className="mt-3 block text-[12px] font-bold text-muted"
          htmlFor="out-reason"
        >
          Reason
        </label>
        <select
          id="out-reason"
          value={outReason}
          onChange={(e) =>
            setOutReason(e.target.value as (typeof OUT_REASONS)[number])
          }
          className="mt-1 w-full rounded-ctl border border-line bg-white px-3 py-2 text-[14px] outline-none focus:border-accent"
        >
          {OUT_REASONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <label
          className="mt-3 block text-[12px] font-bold text-muted"
          htmlFor="out-note"
        >
          {outReason === "Other"
            ? "Tell the front desk what happened"
            : "Anything else the front desk should know? (optional)"}
        </label>
        <input
          id="out-note"
          value={outNote}
          onChange={(e) => setOutNote(e.target.value)}
          placeholder={
            outReason === "Other" ? "e.g. clinic conference until Thursday" : ""
          }
          className="mt-1 w-full rounded-ctl border border-line px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
      </Modal>
    </div>
  );
}
