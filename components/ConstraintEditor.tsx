"use client";
/**
 * Constraint editor: the human half of the extraction pipeline. Shows the
 * SchedulingConstraintSet the extractor produced — every field with the
 * patient's verbatim words as evidence — and lets staff demote/promote
 * hard↔soft, remove entries, clear unresolved statements, preview the
 * deterministic constraint search (with soft-preference scoring chips), and
 * approve → offer. Approval only enqueues the normal replan pipeline; the
 * offer still lands as a recommendation behind the existing decision gate.
 */
import { useMemo, useState } from "react";
import { Button, Chip, Spinner, cn } from "@/components/ui";
import { jfetch, fmtWhenManila } from "@/lib/format";

const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Win = { start?: string; end?: string };
type AnySet = {
  intent: string;
  hard: Record<string, any>;
  soft: Record<string, any>;
  unresolvedStatements: string[];
  clinicalContentDetected?: boolean;
  evidence: Array<{ sourceText: string; field: string }>;
  confidence: number;
  summary: string;
};

const FIELD_LABELS: Record<string, string> = {
  allowedDates: "Only these dates",
  excludedDates: "Not these dates",
  allowedDaysOfWeek: "Only these days",
  excludedDaysOfWeek: "Not these days",
  timeWindows: "Time of day",
  earliestDate: "Not before",
  latestDate: "Not after",
  requiredDoctorId: "Doctor (required)",
  requireSameDoctor: "Same doctor (required)",
  preferredDoctorId: "Doctor",
  preferSameDoctor: "Same doctor",
  preferredDates: "Dates",
  preferredDaysOfWeek: "Days",
  preferredTimeWindows: "Time of day",
  earliestPreferredDate: "Not too soon",
};

/** hard key ↔ soft twin, for the demote/promote toggle. */
const SOFT_TWIN: Record<string, string> = {
  timeWindows: "preferredTimeWindows",
  allowedDaysOfWeek: "preferredDaysOfWeek",
  allowedDates: "preferredDates",
  requiredDoctorId: "preferredDoctorId",
  requireSameDoctor: "preferSameDoctor",
  earliestDate: "earliestPreferredDate",
};
const HARD_TWIN = Object.fromEntries(
  Object.entries(SOFT_TWIN).map(([h, s]) => [s, h]),
);

function fmtWindow(w: Win): string {
  if (w.start && w.end) return `${w.start}–${w.end}`;
  if (w.start) return `after ${w.start}`;
  return `before ${w.end}`;
}
function fmtValue(key: string, v: any): string {
  if (key.includes("DaysOfWeek"))
    return (v as number[]).map((d) => DOW[d]).join(", ");
  if (key.includes("Window")) return (v as Win[]).map(fmtWindow).join(" or ");
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return "yes";
  return String(v);
}
function present(v: any): boolean {
  return v != null && (!Array.isArray(v) || v.length > 0) && v !== false;
}

export function ConstraintEditor({
  caseId,
  latest,
  messages,
  conversations,
  onDone,
}: {
  caseId: string;
  latest: any; // meta.latestConstraints
  messages: any[];
  conversations: any[];
  onDone: () => void;
}) {
  const [set, setSet] = useState<AnySet>(() => structuredClone(latest.set));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "search" | "offer">("");
  const [note, setNote] = useState<string>("");
  const [slots, setSlots] = useState<any[] | null>(null);

  // Which appointment/recommendation does this reply belong to?
  const target = useMemo(() => {
    const msg = messages.find((m: any) => m.id === latest.messageId);
    const conv = conversations.find((c: any) => c.patientId === msg?.patientId);
    const rec = conv?.recommendations?.find(
      (r: any) =>
        r.id === (conv?.currentRecommendationId ?? msg?.recommendationId),
    );
    const payload = rec?.payload ?? {};
    return {
      patientName: conv?.patientName ?? "the patient",
      // The assessment (and all slot machinery) is keyed by the ORIGINAL
      // appointment, not the offer's created hold — prefer it explicitly.
      appointmentId:
        payload.appointmentId ??
        msg?.appointmentId ??
        payload.createdAppointmentId ??
        null,
      supersededRecId:
        conv?.currentRecommendationId ?? msg?.recommendationId ?? null,
    };
  }, [latest.messageId, messages, conversations]);

  const evidenceFor = (scope: string, key: string): string | null => {
    const hit = set.evidence?.find((e) =>
      e.field.startsWith(`${scope}.${key}`),
    );
    return hit?.sourceText ?? null;
  };

  const mutate = (fn: (s: AnySet) => void) => {
    setSet((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setSlots(null);
  };

  const removeField = (scope: "hard" | "soft", key: string) =>
    mutate((s) => delete (s as any)[scope][key]);
  const toggleScope = (scope: "hard" | "soft", key: string) =>
    mutate((s) => {
      const twin = scope === "hard" ? SOFT_TWIN[key] : HARD_TWIN[key];
      if (!twin) return;
      const from = (s as any)[scope];
      const to = (s as any)[scope === "hard" ? "soft" : "hard"];
      to[twin] = from[key];
      delete from[key];
    });
  const resolveStatement = (i: number) =>
    mutate((s) => s.unresolvedStatements.splice(i, 1));

  const save = async () => {
    setBusy("save");
    setNote("");
    try {
      const r = await jfetch(`/api/cases/${caseId}/constraints`, {
        method: "PUT",
        body: JSON.stringify({ set }),
      });
      setSet(r.set);
      setDirty(false);
      setNote(
        r.warnings?.length
          ? `Saved with ${r.warnings.length} normalization note(s).`
          : "Saved.",
      );
      onDone();
    } catch (e: any) {
      setNote(`Could not save: ${e.message ?? e}`);
    } finally {
      setBusy("");
    }
  };

  const search = async () => {
    if (!target.appointmentId)
      return setNote(
        "No appointment is linked to this reply — handle manually.",
      );
    setBusy("search");
    setNote("");
    try {
      const r = await jfetch(`/api/cases/${caseId}/constraints/search`, {
        method: "POST",
        body: JSON.stringify({ set, appointmentId: target.appointmentId }),
      });
      setSlots(r.slots);
      if (r.slots.length === 0)
        setNote(
          "No open slots satisfy these constraints — try relaxing one, or handle manually.",
        );
    } catch (e: any) {
      setNote(`Search failed: ${e.message ?? e}`);
    } finally {
      setBusy("");
    }
  };

  const offer = async (chosenSlot?: { doctorId: string; startUtc: string }) => {
    if (!target.appointmentId || !target.supersededRecId)
      return setNote(
        "Missing appointment/recommendation linkage — handle manually.",
      );
    setBusy("offer");
    setNote("");
    try {
      await jfetch(`/api/cases/${caseId}/constraints/replan`, {
        method: "POST",
        body: JSON.stringify({
          set,
          appointmentId: target.appointmentId,
          supersededRecId: target.supersededRecId,
          chosenSlot,
        }),
      });
      setNote(
        "Approved — the new offer will appear below for your review in a moment.",
      );
      setSlots(null);
      onDone();
    } catch (e: any) {
      setNote(`Could not start the replan: ${e.message ?? e}`);
    } finally {
      setBusy("");
    }
  };

  const rows = [
    ...Object.entries(set.hard).map(([k, v]) => ({
      scope: "hard" as const,
      key: k,
      value: v,
    })),
    ...Object.entries(set.soft).map(([k, v]) => ({
      scope: "soft" as const,
      key: k,
      value: v,
    })),
  ].filter((r) => present(r.value));

  const approved = latest.disposition === "approved";

  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="eyebrow">
            Extracted constraints — {target.patientName}
          </h2>
          <Chip tone={latest.mode === "live" ? "ok" : "neutral"}>
            {latest.mode === "live" ? "AI extracted" : "manual"}
          </Chip>
          <Chip tone="neutral" className="tnum">
            {Math.round((set.confidence ?? 0) * 100)}% confident
          </Chip>
          {approved && <Chip tone="ok">approved</Chip>}
        </div>
      </div>
      <p className="mt-1 text-[13px] text-muted">{set.summary}</p>

      {set.clinicalContentDetected && (
        <div className="mt-2 rounded-ctl border border-bad/40 bg-bad/5 px-3 py-2 text-[13px] text-bad">
          Possible clinical content — read the original message before acting.
          Nothing is automated for this reply.
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {rows.map(({ scope, key, value }) => {
          const quote = evidenceFor(scope, key);
          return (
            <li
              key={`${scope}.${key}`}
              className="rounded-ctl border border-line px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Chip
                  tone={scope === "hard" ? "bad" : "neutral"}
                  className="!text-[10px] uppercase"
                >
                  {scope}
                </Chip>
                <span className="text-[13px] font-semibold text-ink">
                  {FIELD_LABELS[key] ?? key}
                </span>
                <span className="text-[13px] text-ink">
                  {fmtValue(key, value)}
                </span>
                <span className="flex-1" />
                {(scope === "hard" ? SOFT_TWIN[key] : HARD_TWIN[key]) && (
                  <button
                    className="text-[12px] font-semibold text-accent hover:underline"
                    onClick={() => toggleScope(scope, key)}
                    title={
                      scope === "hard"
                        ? "Make this a preference"
                        : "Make this a requirement"
                    }
                  >
                    {scope === "hard" ? "→ preference" : "→ required"}
                  </button>
                )}
                <button
                  className="text-[13px] text-muted hover:text-bad"
                  onClick={() => removeField(scope, key)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
              {quote && (
                <p className="mt-1 pl-1 text-[12px] italic text-muted">
                  “{quote}”
                </p>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="text-[13px] text-muted">
            No constraints — every open slot qualifies.
          </li>
        )}
      </ul>

      {set.unresolvedStatements.length > 0 && (
        <div className="mt-3 rounded-ctl border border-warn/50 bg-warn/5 px-3 py-2">
          <p className="text-[12px] font-semibold text-ink">
            Needs your judgement (not auto-processed):
          </p>
          <ul className="mt-1 space-y-1">
            {set.unresolvedStatements.map((u, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-[13px] text-ink"
              >
                <span className="flex-1 italic">“{u}”</span>
                <button
                  className="text-[12px] font-semibold text-accent hover:underline"
                  onClick={() => resolveStatement(i)}
                >
                  mark resolved
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          small
          variant="secondary"
          disabled={!dirty || busy !== ""}
          onClick={save}
        >
          {busy === "save" ? <Spinner /> : "Save edits"}
        </Button>
        <Button
          small
          disabled={
            busy !== "" ||
            dirty ||
            set.unresolvedStatements.length > 0 ||
            !!set.clinicalContentDetected
          }
          onClick={search}
        >
          {busy === "search" ? <Spinner /> : "Search matching slots"}
        </Button>
        {dirty && (
          <span className="text-[12px] text-muted">
            Save your edits before searching.
          </span>
        )}
        {!dirty && set.unresolvedStatements.length > 0 && (
          <span className="text-[12px] text-muted">
            Resolve the highlighted statements first.
          </span>
        )}
      </div>

      {slots && slots.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[12px] font-semibold text-ink">
            Valid slots (hard constraints enforced; ranked by preferences):
          </p>
          {slots.map((s: any) => (
            <div
              key={`${s.doctorId}|${s.startUtc}`}
              className="flex items-center gap-2 rounded-ctl border border-line px-3 py-2"
            >
              <span className="text-[13px] font-semibold text-ink">
                {fmtWhenManila(s.startUtc)}
              </span>
              <span className="text-[13px] text-muted">{s.doctorName}</span>
              {s.chips?.map((ch: any, i: number) => (
                <Chip key={i} tone="ok" className="!text-[10px]">
                  {ch.label} +{ch.pts}
                </Chip>
              ))}
              <span className="flex-1" />
              <Button
                small
                variant="success"
                disabled={busy !== ""}
                onClick={() =>
                  offer({ doctorId: s.doctorId, startUtc: s.startUtc })
                }
              >
                {busy === "offer" ? <Spinner /> : "Offer this slot"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {note && (
        <p
          className={cn(
            "mt-2 text-[13px]",
            note.startsWith("Could") || note.startsWith("Search failed")
              ? "text-bad"
              : "text-muted",
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}
