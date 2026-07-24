"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
import { Chip, Empty, PageTitle, RailRow, Tabs } from "@/components/ui";
import { CASE_STATE } from "@/components/copy";

type Filter = "review" | "working" | "done";

const WORKING = ["open", "assessing", "planning", "executing", "resolving"];

function rowMeta(c: any): string {
  if (c.state === "awaiting_approval")
    return `${c.pendingCount} suggestion${c.pendingCount === 1 ? "" : "s"} waiting for you`;
  const s = c.scoreboard;
  if (["executing", "resolving", "resolved"].includes(c.state) && s && s.affected > 0) {
    const bits = [
      s.confirmed > 0 && `${s.confirmed} confirmed`,
      s.rebooked - s.confirmed > 0 && `${s.rebooked - s.confirmed} waiting`,
      s.declinedOrCallback > 0 && `${s.declinedOrCallback} to call`,
    ].filter(Boolean);
    return bits.length ? bits.join(" · ") : "In progress";
  }
  if (c.state === "escalated") return "Automation stopped — needs a person";
  return "Working on it";
}

export default function FrontDeskPage() {
  const router = useRouter();
  const { data } = usePoll<any>("/api/cases", 2500);
  const { data: status } = usePoll<any>("/api/status", 5000);
  const [filter, setFilter] = useState<Filter>("review");

  const cases = data?.cases ?? [];
  const buckets = useMemo(() => {
    const review = cases.filter((c: any) => c.state === "awaiting_approval" || c.state === "escalated");
    const working = cases.filter((c: any) => WORKING.includes(c.state));
    const done = cases.filter((c: any) => c.state === "resolved");
    return { review, working, done };
  }, [cases]);

  const list = filter === "review" ? buckets.review : filter === "working" ? buckets.working : buckets.done;

  return (
    <div className="space-y-5">
      <PageTitle
        right={
          status && (
            <span className="tnum text-[13px] text-muted">
              {new Date(status.demoNow).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" })}
            </span>
          )
        }
      >
        Front desk
      </PageTitle>

      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "review", label: "Needs your review", count: buckets.review.length },
          { id: "working", label: "In progress", count: buckets.working.length },
          { id: "done", label: "Done", count: buckets.done.length },
        ]}
      />

      <div className="space-y-2.5">
        {list.length === 0 && (
          <Empty>
            {filter === "review"
              ? "Nothing needs you right now. New suggestions will appear here."
              : filter === "working"
                ? "Nothing in progress."
                : "No finished cases yet today."}
          </Empty>
        )}
        {list.map((c: any) => {
          const st = CASE_STATE[c.state] ?? { label: c.state, tone: "neutral" as const };
          return (
            <RailRow
              key={c.id}
              tone={st.tone}
              interactive
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/ops/cases/${c.id}`)}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/ops/cases/${c.id}`)}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{c.title}</p>
                <p className="mt-0.5 text-[13px] text-muted">{rowMeta(c)}</p>
              </div>
              <Chip tone={st.tone}>{st.label}</Chip>
              <span aria-hidden className="text-muted">›</span>
            </RailRow>
          );
        })}
      </div>

      <p className="pt-2 text-center text-[12px] text-muted">Nothing is sent or booked without your approval.</p>
    </div>
  );
}
