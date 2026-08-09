"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
import { CASE_STATE, type Tone } from "@/components/copy";
import { ManualAppointmentModal } from "@/components/ManualAppointmentModal";
import { WeekCalendar } from "@/components/WeekCalendar";
import { CaseIcon } from "@/components/CaseIcon";
import {
  Card,
  Chip,
  Button,
  Empty,
  Eyebrow,
  PageTitle,
  Pulse,
  RailRow,
  SearchInput,
  SegmentedFilter,
  Select,
  SegmentBar,
} from "@/components/ui";

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

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
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
  const [query, setQuery] = useState("");

  const doctors: Array<{ id: string; name: string }> = docList?.doctors ?? [];
  useEffect(() => {
    if (doctors.length && !doctors.find((d) => d.id === scheduleDoctor)) {
      setScheduleDoctor(doctors[0].id);
    }
  }, [doctors, scheduleDoctor]);

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

  const filteredList = query.trim()
    ? list.filter((c: any) => {
        const q = query.toLowerCase();
        return (
          (c.title ?? "").toLowerCase().includes(q) ||
          rowMeta(c).toLowerCase().includes(q)
        );
      })
    : list;

  const dateStr = status?.demoNow
    ? new Date(status.demoNow).toLocaleDateString("en-PH", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "Asia/Manila",
      })
    : "";

  const doctorsOut: string[] = summary?.doctorsOut ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        subtitle={dateStr ? `${dateStr} · Riverside Family Clinic` : undefined}
        right={
          <Button onClick={() => setAppointmentOpen(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New appointment
          </Button>
        }
      >
        Front desk
      </PageTitle>

      {appointmentMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-card border border-ok-line bg-ok-soft px-4 py-3 text-base font-semibold text-ok"
        >
          {appointmentMessage}
        </div>
      )}

      {/* One bar for the clinic day rather than five metric tiles: the question
          a receptionist actually asks in the morning is "how much of today is
          settled", which is a proportion, not five unrelated figures. */}
      <SegmentBar
        caption="Today"
        total={summary?.visitsToday ?? 0}
        totalLabel={
          (summary?.visitsToday ?? 0) === 1 ? "visit booked" : "visits booked"
        }
        segments={[
          {
            label: "confirmed",
            value: summary?.confirmedToday ?? 0,
            tone: "ok",
          },
          {
            label: "unconfirmed",
            value: summary?.unconfirmedToday ?? 0,
            tone: "warn",
          },
          {
            label: "waiting to hear back",
            value: summary?.waiting?.length ?? 0,
            tone: "accent",
          },
          { label: "to call", value: summary?.toCall?.length ?? 0, tone: "bad" },
        ]}
      />

      {/* Only rendered when it is true — a doctor going out is the event that
          starts the whole recovery flow, so it gets banner weight, not a rail. */}
      {doctorsOut.length > 0 && (
        <div className="animate-rise flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-bad-line bg-bad-soft px-4 py-3">
          <Pulse tone="bad" />
          <span className="text-base font-bold text-bad">
            {doctorsOut.length === 1
              ? `${doctorsOut[0]} is out today`
              : `${doctorsOut.length} doctors are out today`}
          </span>
          {doctorsOut.length > 1 && (
            <span className="text-sm text-bad">{doctorsOut.join(" · ")}</span>
          )}
          <span className="text-sm text-ink-soft">
            Affected visits are being rebooked.
          </span>
        </div>
      )}

      {/* Filters lead, search follows and stays narrow. A full-width search
          field stacked above the tabs made the page open like a form; the queue
          is the subject here, and filtering it is the common act. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedFilter<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            {
              id: "review",
              label: "Needs review",
              count: buckets.review.length,
              tone: "warn",
            },
            {
              id: "working",
              label: "Agents working",
              count: buckets.working.length,
              tone: "accent",
            },
            {
              id: "done",
              label: "Resolved",
              count: buckets.done.length,
              tone: "ok",
            },
            { id: "schedule", label: "Schedule view" },
          ]}
        />
        {filter !== "schedule" && (
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search patient or case…"
            className="lg:w-[290px] lg:shrink-0"
          />
        )}
      </div>

      {filter === "schedule" ? (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Eyebrow>This week</Eyebrow>
            <Select
              value={scheduleDoctor}
              onChange={(e) => setScheduleDoctor(e.target.value)}
              aria-label="Doctor"
              className="w-auto py-1.5 text-sm font-semibold"
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
            </Select>
          </div>
          <WeekCalendar
            key={scheduleDoctor}
            week={scheduleWeek}
            riskById={scheduleRisk}
            today={docData?.demoToday}
            rules={docData?.rules}
            externalBusy={docData?.externalBusy ?? []}
            unavailableDates={docData?.doctor?.unavailableDates ?? []}
          />
        </Card>
      ) : (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between px-0.5">
            <Eyebrow>
              {filter === "review"
                ? "For your review — sorted by urgency"
                : filter === "working"
                  ? "Agents working — no action needed yet"
                  : "Resolved — closed out"}
            </Eyebrow>
            <span className="tnum font-mono text-xs text-muted">
              {filteredList.length}{" "}
              {filteredList.length === 1 ? "case" : "cases"}
            </span>
          </div>

          {filteredList.length === 0 ? (
            <Empty>
              {query.trim()
                ? `Nothing here matches “${query.trim()}”.`
                : filter === "review"
                  ? "Nothing needs you right now. New suggestions will appear here."
                  : filter === "working"
                    ? "Nothing in progress."
                    : "No finished cases yet."}
            </Empty>
          ) : (
            filteredList.map((c: any) => {
              const st = CASE_STATE[c.state] ?? {
                label: c.state,
                tone: "neutral" as Tone,
              };
              const urgent =
                c.state === "awaiting_approval" || c.state === "escalated";
              const open = () => router.push(`/ops/cases/${c.id}`);
              return (
                <RailRow
                  key={c.id}
                  tone={st.tone}
                  interactive
                  role="button"
                  tabIndex={0}
                  aria-label={`${c.title} — ${st.label}`}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  }}
                  className="flex items-start gap-3 px-4 py-3.5"
                >
                  <CaseIcon type={c.type} tone={st.tone} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {urgent && <Pulse tone={st.tone} />}
                      <span className="text-md font-bold text-ink">
                        {c.title}
                      </span>
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </div>
                    <span className="text-sm text-muted">{rowMeta(c)}</span>
                  </div>
                  {c.updatedAt && (
                    <span className="tnum shrink-0 font-mono text-xs text-muted">
                      {hhmm(c.updatedAt)}
                    </span>
                  )}
                </RailRow>
              );
            })
          )}
        </section>
      )}

      <ManualAppointmentModal
        open={appointmentOpen}
        onClose={() => setAppointmentOpen(false)}
        onCreated={setAppointmentMessage}
      />
    </div>
  );
}
