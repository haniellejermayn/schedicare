import { db, schema } from "./db/client";
import { demoNowIso } from "./clock";

export type TimelineKind =
  | "status" | "thought" | "tool_call" | "tool_result" | "transition"
  | "recommendation" | "decision" | "effect" | "message" | "escalation" | "error";

/**
 * The case timeline is simultaneously: the live agent feed (streamed over SSE),
 * the audit replay source, and the evaluation data. One write, three uses.
 */
export function timeline(
  caseId: string,
  actor: string,
  kind: TimelineKind,
  title: string,
  detail?: string | null,
  refs?: unknown
): void {
  db.insert(schema.caseTimeline)
    .values({ caseId, actor, kind, title, detail: detail ?? null, refs: refs ?? null, at: demoNowIso() })
    .run();
}
