"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
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

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function toneClass(tone?: string): string {
  switch (tone) {
    case "warn":
      return "tone-warn";
    case "bad":
      return "tone-bad";
    case "accent":
      return "tone-accent";
    case "ok":
      return "tone-ok";
    default:
      return "";
  }
}

function chipToneClass(tone?: string): string {
  switch (tone) {
    case "warn":
      return "chip-warn";
    case "bad":
      return "chip-bad";
    case "ok":
      return "chip-ok";
    case "accent":
      return "chip-accent";
    default:
      return "chip-neutral";
  }
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

  const dateStr = status?.demoNow
    ? new Date(status.demoNow).toLocaleDateString("en-PH", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "Asia/Manila",
      })
    : "";

  const shortDate = status?.demoNow
    ? new Date(status.demoNow).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "Asia/Manila",
      })
    : "";

  const visitsToday = summary?.visitsToday ?? "—";
  const confirmedToday = summary?.confirmedToday ?? 0;
  const unconfirmedToday = summary?.unconfirmedToday ?? 0;
  const waitingCount = summary?.waiting?.length ?? 0;
  const toCallCount = summary?.toCall?.length ?? 0;
  const doctorsOut: string[] = summary?.doctorsOut ?? [];

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1>Front desk</h1>
          <p className="date tnum">{dateStr}</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setAppointmentOpen(true)}
        >
          + New appointment
        </button>
      </div>

      <div className="command-bar">
        <div className="search">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input type="text" placeholder="Search patient, doctor, or case…" />
        </div>
      </div>

      <div className="filter-chips" role="tablist">
        <button
          className={`fchip ${filter === "review" ? "active" : ""}`}
          onClick={() => setFilter("review")}
        >
          Needs review <span className="n">{buckets.review.length}</span>
        </button>
        <button
          className={`fchip ${filter === "working" ? "active" : ""}`}
          onClick={() => setFilter("working")}
        >
          Agents working <span className="n">{buckets.working.length}</span>
        </button>
        <button
          className={`fchip ${filter === "done" ? "active" : ""}`}
          onClick={() => setFilter("done")}
        >
          Resolved <span className="n">{buckets.done.length}</span>
        </button>
        <button
          className={`fchip ${filter === "schedule" ? "active" : ""}`}
          onClick={() => setFilter("schedule")}
        >
          Schedule view
        </button>
      </div>

      <div className="layout">
        <div className="queue">
          {filter === "schedule" ? (
            <div className="filter-panel active" data-panel="schedule">
              <div className="sched-card">
                <div className="sched-top">
                  <span className="eyebrow">This week</span>
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
                  key={scheduleDoctor}
                  week={scheduleWeek}
                  riskById={scheduleRisk}
                  today={docData?.demoToday}
                  rules={docData?.rules}
                  externalBusy={docData?.externalBusy ?? []}
                  unavailableDates={docData?.doctor?.unavailableDates ?? []}
                />
                <div className="sched-legend">
                  <span>
                    <i style={{ background: "var(--teal)" }}></i>Routine
                  </span>
                  <span>
                    <i style={{ background: "var(--moss)" }}></i>Follow-up
                  </span>
                  <span>
                    <i style={{ background: "var(--clay)" }}></i>Urgent
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="filter-panel active"
              data-panel={filter === "done" ? "resolved" : filter}
            >
              <div className="queue-label">
                <span className="eyebrow">
                  {filter === "review"
                    ? "For your review — sorted by urgency"
                    : filter === "working"
                      ? "Agents working — no action needed yet"
                      : "Resolved — closed out"}
                </span>
                <span className="count">{list.length} cases</span>
              </div>

              {list.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-muted">
                  {filter === "review"
                    ? "Nothing needs you right now. New suggestions will appear here."
                    : filter === "working"
                      ? "Nothing in progress."
                      : "No finished cases yet."}
                </p>
              ) : (
                list.map((c: any) => {
                  const st = CASE_STATE[c.state] ?? {
                    label: c.state,
                    tone: "neutral" as const,
                  };
                  return (
                    <div
                      key={c.id}
                      className={`case ${toneClass(st.tone)}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/ops/cases/${c.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          router.push(`/ops/cases/${c.id}`);
                      }}
                    >
                      <div className="avatars">
                        <div className="av av-1">{initials(c.title)}</div>
                      </div>
                      <div className="case-body">
                        <div className="case-top">
                          {c.state === "awaiting_approval" ||
                          c.state === "escalated" ? (
                            <span className="pulse"></span>
                          ) : null}
                          <span className="case-title">{c.title}</span>
                          <span className={`chip ${chipToneClass(st.tone)}`}>
                            {st.label}
                          </span>
                        </div>
                        <div className="case-meta">
                          <span>{rowMeta(c)}</span>
                          {c.updatedAt && (
                            <>
                              <span className="dot-sep">·</span>
                              <span>
                                updated{" "}
                                {new Date(c.updatedAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="case-actions">
                        <span className="updated">
                          {c.updatedAt
                            ? new Date(c.updatedAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "just now"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="rail">
          <div className="rail-card">
            <h3>Today at a glance</h3>
            <p className="rail-sub">{shortDate} · Riverside Family Clinic</p>
            <div className="glance-row">
              <span className="label">Visits today</span>
              <span className="val">{visitsToday}</span>
            </div>
            <div className="glance-row">
              <span className="label">Confirmed</span>
              <span className="val" style={{ color: "var(--moss)" }}>
                {confirmedToday}
              </span>
            </div>
            <div className="glance-row">
              <span className="label">Unconfirmed</span>
              <span className="val" style={{ color: "var(--amber)" }}>
                {unconfirmedToday}
              </span>
            </div>
            <div className="glance-row">
              <span className="label">Waiting to hear back</span>
              <span className="val">{waitingCount}</span>
            </div>
            <div className="glance-row">
              <span className="label">To call</span>
              <span className="val" style={{ color: "var(--clay)" }}>
                {toCallCount}
              </span>
            </div>
          </div>

          <div className="rail-card">
            <h3>Doctors out today</h3>
            <p className="rail-sub">Affected visits are being rebooked</p>
            {doctorsOut.length === 0 ? (
              <div className="empty-out">Everyone is in today.</div>
            ) : (
              doctorsOut.map((name: string) => (
                <div className="out-doc" key={name}>
                  <div className="av">
                    {name
                      .split(" ")
                      .map((p: string) => p[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="info">
                    <b>{name}</b>
                    <span>out today; affected visits are being rebooked</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <footer className="note">
        Nothing is sent or booked without your approval.
      </footer>

      {appointmentMessage && (
        <p className="rounded-ctl border border-ok-line bg-ok-soft px-3 py-2 text-[13px] font-semibold text-ok">
          {appointmentMessage}
        </p>
      )}

      <ManualAppointmentModal
        open={appointmentOpen}
        onClose={() => setAppointmentOpen(false)}
        onCreated={setAppointmentMessage}
      />
    </div>
  );
}
