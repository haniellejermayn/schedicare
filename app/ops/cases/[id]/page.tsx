"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { usePoll } from "@/lib/usePoll";
import { Badge, Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import { RecommendationCard, Scoreboard, LiveFeed } from "@/components/ops";
import { useFeed } from "@/lib/usePoll";
import { agentLabel, fmtWhenManila } from "@/lib/format";

export default function CaseRecordPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, refresh } = usePoll<any>(id ? `/api/cases/${id}` : null, 2000);
  const feed = useFeed(id);
  const c = data?.case;

  if (!c) {
    return <EmptyState>Loading case…</EmptyState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/ops" className="text-[13px] font-bold text-scd-primary hover:underline">
          ← Ops Center
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight text-scd-ink">{c.title}</h1>
        <StatusBadge status={c.state} />
        <Badge tone="neutral">case {c.id.slice(0, 10)}…</Badge>
        <span className="ml-auto text-[12px] text-scd-muted">Opened {fmtWhenManila(c.createdAt)}</span>
      </div>

      <Scoreboard s={data?.scoreboard} />

      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-4">
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle>Recommendations & decisions</SectionTitle>
            <div className="mt-3 space-y-3">
              {(data?.recommendations ?? []).length === 0 && <EmptyState>No recommendations were filed on this case.</EmptyState>}
              {(data?.recommendations ?? []).map((r: any) => (
                <RecommendationCard key={r.id} rec={r} messages={data?.messages ?? []} onDecided={refresh} />
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle>Patient messages</SectionTitle>
            <div className="mt-3 space-y-2">
              {(data?.messages ?? []).length === 0 && <EmptyState>No messages yet.</EmptyState>}
              {(data?.messages ?? []).map((m: any) => (
                <div key={m.id} className="rounded-card border border-scd-line/70 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <Badge tone={m.direction === "inbound" ? "info" : "primary"}>{m.direction === "inbound" ? "From patient" : "To patient"}</Badge>
                    <StatusBadge status={m.status} />
                    <Badge tone="neutral">{m.provider ?? "—"}</Badge>
                    {m.intent && <Badge tone="warning">intent: {m.intent.replace(/_/g, " ")}</Badge>}
                    <span className="ml-auto text-scd-muted">{fmtWhenManila(m.createdAt)}</span>
                  </div>
                  {m.subject && <p className="mt-1.5 text-[13px] font-bold text-scd-ink">{m.subject}</p>}
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-scd-ink/80">{m.body}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="h-[calc(100vh-180px)] min-h-[480px] sticky top-[72px]">
          <LiveFeed items={feed.items} connected={feed.connected} title="Case timeline (replay + live)" />
        </div>
      </div>
    </div>
  );
}
