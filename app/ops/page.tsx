"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
import { fmtTimeManila, fmtWhenManila, typeLabel } from "@/lib/format";
import { APPT_STATUS } from "@/components/copy";
import {
  Button,
  Card,
  Chip,
  Empty,
  PageTitle,
  RailRow,
  Tabs,
  cn,
} from "@/components/ui";
import { CASE_STATE } from "@/components/copy";
import { ManualAppointmentModal } from "@/components/ManualAppointmentModal";
import { WeekCalendar } from "@/components/WeekCalendar";

type Filter = "review" | "working" | "done" | "schedule";

const WORKING = ["open", "assessing", "planning", "executing", "resolving"];

function manilaDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function rowMeta(c: any): string {
  if (c.state === "awaiting_approval")
    return `${c.pendingCount} suggestion${c.pendingCount === 1 ? "" : "s"} waiting for you`;
  const s = c.scoreboard;
  if (
    ["executing", "resolving", "resolved"].includes(c.state) &&
    s &&
    s.affected > 0
  ) {
    const bits = [
      s.confirmed > 0 && `${s.confirmed} confirmed`,
      s.rebooked - s.confirmed > 0 && `${s.rebooked - s.confirmed} waiting`,
      s.declinedOrCallback > 0 && `${s.declinedOrCallback} to call`,
    ].filter(Boolean);
    return bits.length ? bits.join(" · ") : "Agents working on it";
  }
  if (c.state === "escalated")
    return c.pendingCount > 0
      ? `Needs a person · ${c.pendingCount} suggestion${c.pendingCount === 1 ? "" : "s"} still waiting for you`
      : "Automation stopped — needs a person";
  return "Agents working on it";
}

function Stat({
  label,
  value,
  sub,
  tone,
  open,
  onToggle,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "warn" | "bad";
  open: boolean;
  onToggle: () => void;
}) {
  // Uniform anatomy — every band is FIXED height (not min-height), so no
  // card can grow past its neighbors no matter how label or sub wrap:
  // 30px label band (2 lines max) · 28px number line · 30px sub band.
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "rounded-card border bg-white px-3.5 py-2.5 text-left transition-colors duration-fast",
        open
          ? "border-accent-line bg-accent-soft/40"
          : "border-line hover:border-strong",
      )}
    >
      <span className="flex h-[30px] items-start justify-between gap-1 overflow-hidden">
        <span className="eyebrow leading-[15px]">{label}</span>
        <span
          aria-hidden
          className={cn(
            "text-[10px] leading-[15px] text-muted transition-transform duration-fast",
            open && "rotate-180",
          )}
        >
          ▾
        </span>
      </span>
      <span
        className={cn(
          "tnum block h-7 text-[22px] font-bold leading-7",
          tone === "bad"
            ? "text-bad"
            : tone === "warn"
              ? "text-warn"
              : "text-ink",
        )}
      >
        {value}
      </span>
      <span className="block h-[30px] overflow-hidden whitespace-pre-line text-[11px] leading-[15px] text-muted">
        {sub ?? ""}
      </span>
    </button>
  );
}

export default function FrontDeskPage() {
  const router = useRouter();
  const { data } = usePoll<any>("/api/cases", 2500);
  const { data: status } = usePoll<any>("/api/status", 5000);
  const { data: summary } = usePoll<any>("/api/ops/summary", 5000);
  const { data: docList } = usePoll<any>("/api/doctors", 60000);
  const [filter, setFilter] = useState<Filter>("review");
  const [scheduleDoctor, setScheduleDoctor] = useState("doc_santos");
  const { data: docData } = usePoll<any>(`/api/doctor/${scheduleDoctor}`, 4000);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [appointmentMessage, setAppointmentMessage] = useState<string | null>(
    null,
  );
  type StatKey = "visits" | "review" | "waiting" | "toCall" | "out";
  const [expanded, setExpanded] = useState<StatKey | null>(null);
  const toggle = (k: StatKey) => setExpanded((e) => (e === k ? null : k));

  const doctors: Array<{ id: string; name: string }> = docList?.doctors ?? [];
  const cases = data?.cases ?? [];
  const buckets = useMemo(() => {
    const review = cases.filter(
      (c: any) => c.state === "awaiting_approval" || c.state === "escalated",
    );
    const working = cases.filter((c: any) => WORKING.includes(c.state));
    const done = cases.filter((c: any) => c.state === "resolved");
    return { review, working, done };
  }, [cases]);

  const scheduleWeek = useMemo(() => {
    const days: Record<string, any[]> = {};
    const demoDay = docData?.demoToday;
    if (!demoDay) return days;
    const appts = (docData?.appointments ?? []).filter((a: any) =>
      ["booked", "confirmed"].includes(a.status),
    );
    for (let i = 0; i < 6; i++) {
      const d = new Date(`${demoDay}T00:00:00+08:00`);
      d.setDate(d.getDate() + i);
      const key = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
      }).format(d);
      days[key] = appts.filter((a: any) => manilaDay(a.startUtc) === key);
    }
    return days;
  }, [docData]);
  const scheduleRisk = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of docData?.atRisk ?? []) m[r.appointmentId] = r;
    return m;
  }, [docData]);

  const list =
    filter === "review"
      ? buckets.review
      : filter === "working"
        ? buckets.working
        : buckets.done;

  return (
    <div className="space-y-5">
      <PageTitle
        right={
          <div className="flex items-center gap-3">
            {status && (
              <span className="tnum text-[13px] text-muted">
                {new Date(status.demoNow).toLocaleDateString("en-PH", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "Asia/Manila",
                })}
              </span>
            )}
            <Button onClick={() => setAppointmentOpen(true)}>
              New appointment
            </Button>
          </div>
        }
      >
        Front desk
      </PageTitle>

      {/* Mini-dashboard — read-only counts; the tabs below stay the workflow. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Visits today"
          value={summary?.visitsToday ?? "—"}
          sub={
            summary
              ? `${summary.confirmedToday} confirmed\n${summary.unconfirmedToday} unconfirmed`
              : undefined
          }
          open={expanded === "visits"}
          onToggle={() => toggle("visits")}
        />
        <Stat
          label="Needs your review"
          value={buckets.review.length}
          tone={buckets.review.length > 0 ? "warn" : undefined}
          open={expanded === "review"}
          onToggle={() => toggle("review")}
        />
        <Stat
          label="Waiting to hear back"
          value={summary ? summary.waiting.length : "—"}
          open={expanded === "waiting"}
          onToggle={() => toggle("waiting")}
        />
        <Stat
          label="To call"
          value={summary ? summary.toCall.length : "—"}
          tone={summary?.toCall.length ? "bad" : undefined}
          open={expanded === "toCall"}
          onToggle={() => toggle("toCall")}
        />
        <Stat
          label="Doctors out today"
          value={
            summary
              ? summary.doctorsOut.length === 0
                ? "None"
                : summary.doctorsOut.length
              : "—"
          }
          sub={
            summary?.doctorsOut.length
              ? summary.doctorsOut.join(", ")
              : undefined
          }
          tone={summary?.doctorsOut.length ? "bad" : undefined}
          open={expanded === "out"}
          onToggle={() => toggle("out")}
        />
      </div>

      {expanded && (
        <Card className="animate-rise divide-y divide-line">
          {expanded === "visits" &&
            ((summary?.visits ?? []).length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted">
                No visits scheduled today.
              </p>
            ) : (
              (summary?.visits ?? []).map((v: any) => {
                const st = APPT_STATUS[v.status] ?? {
                  label: v.status,
                  tone: "neutral" as const,
                };
                return (
                  <div key={v.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="tnum w-[72px] text-[13px] font-bold text-ink">
                      {fmtTimeManila(v.startUtc)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                      {v.patientName}
                    </span>
                    <span className="hidden text-[12px] text-muted sm:block">
                      {typeLabel(v.type)} · {v.doctorName}
                    </span>
                    <Chip tone={st.tone}>{st.label}</Chip>
                  </div>
                );
              })
            ))}
          {expanded === "review" &&
            (buckets.review.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted">
                Nothing needs you right now.
              </p>
            ) : (
              buckets.review.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/ops/cases/${c.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {c.title}
                  </span>
                  <span className="text-[12px] text-muted">{rowMeta(c)}</span>
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </button>
              ))
            ))}
          {expanded === "waiting" &&
            ((summary?.waiting ?? []).length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted">
                No one is waiting to reply right now.
              </p>
            ) : (
              (summary?.waiting ?? []).map((w: any, i: number) => (
                <button
                  key={i}
                  onClick={() => router.push(`/ops/cases/${w.caseId}`)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {w.patientName}
                  </span>
                  <span className="tnum text-[12px] text-muted">
                    offered {fmtWhenManila(w.when)}
                  </span>
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </button>
              ))
            ))}
          {expanded === "toCall" &&
            ((summary?.toCall ?? []).length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted">
                No calls needed right now.
              </p>
            ) : (
              (summary?.toCall ?? []).map((t: any, i: number) => (
                <button
                  key={i}
                  onClick={() => router.push(`/ops/cases/${t.caseId}`)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {t.patientName}
                  </span>
                  <span className="text-[12px] text-muted">{t.reason}</span>
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </button>
              ))
            ))}
          {expanded === "out" &&
            ((summary?.doctorsOut ?? []).length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted">
                Everyone is in today.
              </p>
            ) : (
              (summary?.doctorsOut ?? []).map((n: string) => (
                <p
                  key={n}
                  className="px-4 py-2 text-[13px] font-semibold text-ink"
                >
                  {n}{" "}
                  <span className="font-normal text-muted">
                    — out today; affected visits are being rebooked
                  </span>
                </p>
              ))
            ))}
        </Card>
      )}

      {appointmentMessage && (
        <p className="rounded-ctl border border-ok-line bg-ok-soft px-3 py-2 text-[13px] font-semibold text-ok">
          {appointmentMessage}
        </p>
      )}

      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          {
            id: "review",
            label: "Needs your review",
            count: buckets.review.length,
          },
          {
            id: "working",
            label: "Agents working",
            count: buckets.working.length,
          },
          { id: "done", label: "Resolved", count: buckets.done.length },
          { id: "schedule", label: "Schedule" },
        ]}
      />

      {filter === "schedule" ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-end">
            <select
              value={scheduleDoctor}
              onChange={(e) => setScheduleDoctor(e.target.value)}
              aria-label="Doctor"
              className="rounded-ctl border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink outline-none focus:border-accent"
            >
              {(doctors.length
                ? doctors
                : [
                    { id: "doc_santos", name: "Dr. Elena Santos" },
                    { id: "doc_reyes", name: "Dr. Marco Reyes" },
                  ]
              ).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <WeekCalendar
            week={scheduleWeek}
            riskById={scheduleRisk}
            today={docData?.demoToday}
            rules={docData?.rules}
            externalBusy={docData?.externalBusy ?? []}
            unavailableDates={docData?.doctor?.unavailableDates ?? []}
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.length === 0 && (
            <Empty>
              {filter === "review"
                ? "Nothing needs you right now. New suggestions will appear here."
                : filter === "working"
                  ? "Nothing in progress."
                  : "No finished cases yet."}
            </Empty>
          )}
          {list.map((c: any) => {
            const st = CASE_STATE[c.state] ?? {
              label: c.state,
              tone: "neutral" as const,
            };
            return (
              <RailRow
                key={c.id}
                tone={st.tone}
                interactive
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/ops/cases/${c.id}`)}
                onKeyDown={(e) =>
                  e.key === "Enter" && router.push(`/ops/cases/${c.id}`)
                }
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">
                    {c.title}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">{rowMeta(c)}</p>
                </div>
                <Chip tone={st.tone}>{st.label}</Chip>
                <span aria-hidden className="text-muted">
                  ›
                </span>
              </RailRow>
            );
          })}
        </div>
      )}

      <p className="pt-2 text-center text-[12px] text-muted">
        Nothing is sent or booked without your approval.
      </p>
      <ManualAppointmentModal
        open={appointmentOpen}
        onClose={() => setAppointmentOpen(false)}
        onCreated={setAppointmentMessage}
      />
    </div>
  );
}
