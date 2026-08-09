"use client";
import { useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import { fmtTimeManila, typeLabel } from "@/lib/format";
import { Card, Chip, Modal, RescheduleLine, cn } from "@/components/ui";
import { APPT_STATUS, appointmentStatus } from "@/components/copy";

/**
 * Weekly time-grid calendar for the Doctor page. Replaces the flat per-day
 * pill list with an actual Mon–Sat grid, so a doctor can see gaps, load, and
 * clashes at a glance instead of reading rows.
 *
 * Hour range is a fixed 7am–7pm band. The `rules` prop is accepted so
 * existing call sites don't break, but is currently unused (range is fixed,
 * not per-doctor auto-fit).
 *
 * `externalBusy` renders whatever the doctor's real Google Calendar (or its
 * simulated twin) shows as busy that ISN'T one of our own appointments —
 * e.g. outside commitments, other clinics. Google's freebusy API only ever
 * returns time ranges, never titles, so these render as anonymous, non-
 * clickable "Busy" stripes underneath the real appointment blocks — never
 * fabricated as if they were named events.
 *
 * Pure presentation, read-only: it takes data the page already fetched and
 * never calls a write endpoint itself. It optionally polls /api/status for
 * the demo clock so the "now" line can be drawn.
 */

const HOUR_START = 7; // 7am
const HOUR_END = 19; // 7pm
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START + 1 },
  (_, i) => HOUR_START + i,
);

interface RuleWindows {
  windows?: Record<string, string[]>;
}

interface BusyInterval {
  startUtc: string;
  endUtc: string;
}

function manilaHourFraction(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

function manilaDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function durationMin(a: any): number {
  return Math.max(
    10,
    Math.round(
      (new Date(a.endUtc).getTime() - new Date(a.startUtc).getTime()) / 60000,
    ),
  );
}

function typeInitial(t: string): string {
  return t === "follow_up" ? "F" : t === "urgent" ? "U" : "R";
}

/** Greedy lane packing so overlapping/buffer-adjacent visits sit side by side instead of stacking. */
function packLanes(
  appts: any[],
): Array<{ appt: any; lane: number; laneCount: number }> {
  const items = appts
    .map((a) => ({
      appt: a,
      start: manilaHourFraction(a.startUtc),
      end: manilaHourFraction(a.startUtc) + durationMin(a) / 60,
    }))
    .sort((x, y) => x.start - y.start);
  const laneEnds: number[] = [];
  const placed = items.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.start + 0.001);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    return { ...it, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return placed.map((p) => ({ appt: p.appt, lane: p.lane, laneCount }));
}

/** Group flat busy intervals by Manila-local day key, clipped to the visible hour band. */
function groupBusyByDay(
  intervals: BusyInterval[],
): Record<string, BusyInterval[]> {
  const out: Record<string, BusyInterval[]> = {};
  for (const b of intervals) {
    const day = manilaDayKey(b.startUtc);
    (out[day] ??= []).push(b);
  }
  return out;
}

const TONE_BLOCK: Record<string, string> = {
  ok: "border-ok-line bg-ok-soft text-ok",
  warn: "border-warn-line bg-warn-soft text-warn",
  bad: "border-bad-line bg-bad-soft text-bad",
  accent: "border-accent-line bg-accent-soft text-accent",
  neutral: "border-line bg-canvas text-muted",
};

export function WeekCalendar({
  week,
  riskById = {},
  today,
  rules,
  externalBusy = [],
  unavailableDates = [],
}: {
  /** dayKey (yyyy-MM-dd, Manila) -> active appointments for that day. */
  week: Record<string, any[]>;
  riskById?: Record<string, any>;
  /** yyyy-MM-dd of "today" in the demo clock, for the highlighted column. */
  today: string;
  /** Accepted for future use (per-doctor auto-fit); not used while the range is fixed 7am–7pm. */
  rules?: RuleWindows | null;
  /** Flat list of external-calendar busy intervals (no titles by design — see file header). */
  externalBusy?: BusyInterval[];
  /** Clinic-local dates the doctor has marked unavailable. */
  unavailableDates?: string[];
}) {
  const { data: status } = usePoll<any>("/api/status", 30000);
  const [selected, setSelected] = useState<any | null>(null);

  const days = useMemo(() => Object.keys(week).sort(), [week]);
  // Single-day mode renders roomier, card-like blocks on a taller hour scale.
  const dayMode = days.length === 1;
  const PX_PER_HOUR = dayMode ? 96 : 52;
  const GRID_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;
  const busyByDay = useMemo(() => groupBusyByDay(externalBusy), [externalBusy]);
  const nowFraction = status?.demoNow
    ? manilaHourFraction(status.demoNow)
    : null;
  const nowDay: string | null = status?.demoToday ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        {(["confirmed", "booked"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                { confirmed: "bg-ok", booked: "bg-warn" }[k],
              )}
            />
            {APPT_STATUS[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full border border-accent" />
          May not show
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[3px] border border-dashed border-muted bg-canvas" />
          Busy elsewhere (external calendar)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[3px] bg-bad-soft ring-1 ring-bad-line" />
          Doctor unavailable
        </span>
        {!dayMode && (
          <span className="text-muted/70">
            F/R/U = Follow-up / Routine / Urgent
          </span>
        )}
      </div>

      <Card className="overflow-x-auto scroll-quiet p-0">
        <div
          className={cn(
            "grid",
            days.length > 1 ? "min-w-[720px]" : "min-w-[320px]",
          )}
          style={{ gridTemplateColumns: `44px repeat(${days.length}, 1fr)` }}
        >
          {/* Header row */}
          <div />
          {days.map((day) => {
            const d = new Date(`${day}T00:00:00+08:00`);
            const isToday = day === today;
            return (
              <div
                key={day}
                className={cn(
                  "border-b border-l border-line px-1.5 py-2 text-center",
                  isToday && "bg-accent-soft/40",
                )}
              >
                <p
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wide",
                    isToday ? "text-accent" : "text-muted",
                  )}
                >
                  {d.toLocaleDateString("en-PH", {
                    weekday: "short",
                    timeZone: "Asia/Manila",
                  })}
                </p>
                <p
                  className={cn(
                    "tnum text-sm font-bold",
                    isToday ? "text-accent" : "text-ink",
                  )}
                >
                  {d.toLocaleDateString("en-PH", {
                    month: "short",
                    day: "numeric",
                    timeZone: "Asia/Manila",
                  })}
                </p>
              </div>
            );
          })}

          {/* Time gutter */}
          <div className="relative" style={{ height: GRID_HEIGHT }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="tnum absolute right-1.5 -translate-y-1/2 text-micro text-muted"
                style={{ top: (h - HOUR_START) * PX_PER_HOUR }}
              >
                {h % 12 === 0 ? 12 : h % 12}
                {h < 12 ? "am" : "pm"}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const laned = packLanes(week[day] ?? []);
            const busy = busyByDay[day] ?? [];
            const isToday = day === today;
            const unavailable = unavailableDates.includes(day);
            return (
              <div
                key={day}
                className={cn(
                  "relative border-l border-line",
                  isToday && "bg-accent-soft/10",
                )}
                style={{
                  height: GRID_HEIGHT,
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${PX_PER_HOUR - 1}px, rgba(23,33,43,0.10) ${PX_PER_HOUR - 1}px, rgba(23,33,43,0.10) ${PX_PER_HOUR}px)`,
                }}
              >
                {unavailable && (
                  <div className="pointer-events-none absolute inset-0 z-[4] flex items-start justify-center bg-bad-soft/70 pt-2">
                    <span className="rounded-full border border-bad-line bg-surface/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-bad">
                      Unavailable
                    </span>
                  </div>
                )}
                {/* External calendar busy blocks — behind everything, non-interactive, no fabricated titles */}
                {busy.map((b, i) => {
                  const top = Math.max(
                    0,
                    (manilaHourFraction(b.startUtc) - HOUR_START) * PX_PER_HOUR,
                  );
                  const rawEnd =
                    (manilaHourFraction(b.endUtc) - HOUR_START) * PX_PER_HOUR;
                  const height = Math.max(
                    10,
                    Math.min(GRID_HEIGHT, rawEnd) - top,
                  );
                  if (top >= GRID_HEIGHT || rawEnd <= 0) return null;
                  return (
                    <div
                      key={`busy-${day}-${i}`}
                      className="pointer-events-none absolute inset-x-0 z-0 flex items-start justify-center overflow-hidden rounded-[6px] border border-dashed border-muted/60 bg-[repeating-linear-gradient(45deg,#eef0e9,#eef0e9_4px,#f7f5ef_4px,#f7f5ef_8px)] px-1 py-0.5"
                      style={{ top, height }}
                      title="Busy on the doctor's external calendar"
                    >
                      {height > 22 && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                          Busy
                        </span>
                      )}
                    </div>
                  );
                })}

                {isToday &&
                  nowFraction != null &&
                  nowDay === day &&
                  nowFraction >= HOUR_START &&
                  nowFraction <= HOUR_END && (
                    <div
                      className="absolute left-0 right-0 z-10 border-t-2 border-accent"
                      style={{ top: (nowFraction - HOUR_START) * PX_PER_HOUR }}
                    >
                      <span className="absolute -left-[3px] -top-[4px] h-[7px] w-[7px] rounded-full bg-accent" />
                    </div>
                  )}
                {laned.map(({ appt: a, lane, laneCount }) => {
                  const st = appointmentStatus(a);
                  const top =
                    (manilaHourFraction(a.startUtc) - HOUR_START) * PX_PER_HOUR;
                  const height = Math.max(
                    dayMode ? 30 : 18,
                    (durationMin(a) / 60) * PX_PER_HOUR - 2,
                  );
                  const risky = riskById[a.id] && riskById[a.id].band !== "low";
                  if (dayMode) {
                    // The list card, slotted onto the time axis: white body,
                    // status rail, full name — not the week grid's dense pill.
                    const RAIL: Record<string, string> = {
                      ok: "border-l-ok-rail",
                      warn: "border-l-warn-rail",
                      bad: "border-l-bad-rail",
                      accent: "border-l-accent-rail",
                      neutral: "border-l-line",
                    };
                    const STATUS_TEXT: Record<string, string> = {
                      ok: "text-ok",
                      warn: "text-warn",
                      bad: "text-bad",
                      accent: "text-accent",
                      neutral: "text-muted",
                    };
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelected(a)}
                        className={cn(
                          "animate-rise absolute z-[5] overflow-hidden rounded-[8px] border border-line border-l-[3px] bg-surface px-2.5 py-1.5 text-left shadow-sm transition-transform hover:z-20 hover:scale-[1.01]",
                          RAIL[st.tone],
                        )}
                        style={{
                          top,
                          height,
                          left: `${(lane / laneCount) * 100}%`,
                          width: `calc(${100 / laneCount}% - 6px)`,
                        }}
                        title={`${a.patientName} · ${typeLabel(a.type)} · ${fmtTimeManila(a.startUtc)}–${fmtTimeManila(a.endUtc)}`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-ink">
                            {a.patientName}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-xs font-semibold",
                              STATUS_TEXT[st.tone],
                            )}
                          >
                            {st.label}
                          </span>
                        </span>
                        {height > 42 && (
                          <span className="tnum block truncate text-xs text-muted">
                            {fmtTimeManila(a.startUtc)}–
                            {fmtTimeManila(a.endUtc)} · {typeLabel(a.type)}
                            {risky ? " · may not show" : ""}
                          </span>
                        )}
                      </button>
                    );
                  }
                  return (
                    <button
                      key={a.id}
                      onClick={() => setSelected(a)}
                      className={cn(
                        "animate-rise absolute z-[5] overflow-hidden rounded-[6px] border px-1.5 py-1 text-left text-micro leading-tight shadow-sm transition-transform hover:z-20 hover:scale-[1.02]",
                        TONE_BLOCK[st.tone],
                      )}
                      style={{
                        top,
                        height,
                        left: `${(lane / laneCount) * 100}%`,
                        width: `calc(${100 / laneCount}% - 3px)`,
                      }}
                      title={`${a.patientName} · ${typeLabel(a.type)} · ${fmtTimeManila(a.startUtc)}–${fmtTimeManila(a.endUtc)}`}
                    >
                      <span className="flex items-center gap-1 font-bold">
                        {risky && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-current" />
                        )}
                        <span className="truncate">
                          {a.patientName?.split(" ")[0] ?? "Patient"}
                        </span>
                        <span className="shrink-0 opacity-70">
                          · {typeInitial(a.type)}
                        </span>
                      </span>
                      {height > 30 && (
                        <span className="tnum block truncate opacity-80">
                          {fmtTimeManila(a.startUtc)}–{fmtTimeManila(a.endUtc)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.patientName ?? "Visit"}
        footer={
          <button
            className="text-sm font-semibold text-accent hover:underline"
            onClick={() => setSelected(null)}
          >
            Close
          </button>
        }
      >
        {selected && (
          <div className="space-y-2">
            <RescheduleLine toUtc={selected.startUtc} />
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="neutral">{typeLabel(selected.type)}</Chip>
              <Chip tone={appointmentStatus(selected).tone}>
                {appointmentStatus(selected).label}
              </Chip>
              {riskById[selected.id] &&
                riskById[selected.id].band !== "low" && (
                  <Chip tone="warn">May not show</Chip>
                )}
            </div>
            <p className="tnum text-xs text-muted">
              {durationMin(selected)} min
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
