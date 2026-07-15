import { boot } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, asc, eq, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events feed of case_timeline rows, cursored on the integer id.
 * ?caseId=… scopes to one case; otherwise streams everything (Ops feed).
 */
export async function GET(req: Request) {
  boot();
  const url = new URL(req.url);
  const caseId = url.searchParams.get("caseId");
  let cursor = Number(url.searchParams.get("after") ?? 0);

  const encoder = new TextEncoder();
  let alive = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const tick = () => {
        if (!alive) return;
        try {
          const where = caseId
            ? and(eq(schema.caseTimeline.caseId, caseId), gt(schema.caseTimeline.id, cursor))
            : gt(schema.caseTimeline.id, cursor);
          const rows = db.select().from(schema.caseTimeline).where(where).orderBy(asc(schema.caseTimeline.id)).limit(80).all();
          if (rows.length > 0) {
            cursor = rows[rows.length - 1].id;
            push("timeline", rows);
          } else {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          }
        } catch {
          /* db briefly busy — next tick */
        }
      };
      // On connect, send the recent backlog so the panel isn't empty.
      try {
        const backlogWhere = caseId ? eq(schema.caseTimeline.caseId, caseId) : undefined;
        const backlog = (backlogWhere
          ? db.select().from(schema.caseTimeline).where(backlogWhere)
          : db.select().from(schema.caseTimeline)
        )
          .orderBy(asc(schema.caseTimeline.id))
          .all()
          .slice(-120);
        if (backlog.length > 0) {
          cursor = Math.max(cursor, backlog[backlog.length - 1].id);
          push("timeline", backlog);
        }
      } catch {
        /* empty */
      }
      timer = setInterval(tick, 600);
    },
    cancel() {
      alive = false;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
