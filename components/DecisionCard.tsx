"use client";
import { useMemo, useState } from "react";
import { jfetch, fmtWhenManila } from "@/lib/format";
import {
  Button,
  Chip,
  Modal,
  RailRow,
  RescheduleLine,
  Spinner,
  cn,
} from "@/components/ui";
import { kindLabel, outcomeLabel } from "@/components/copy";

/** Turn ranking chips into one quiet sentence — no scores, no jargon. */
function whyLine(option: any, payload: any): string {
  const labels: string[] = (option?.chips ?? []).map((c: any) =>
    String(c.label),
  );
  const parts = labels.slice(0, 4).join(" · ");
  return (
    parts ||
    payload.rationale ||
    "Best available match under the doctor's rules."
  );
}

export function DecisionCard({
  rec,
  messages,
  onDone,
}: {
  rec: any;
  messages: any[];
  onDone: () => void;
}) {
  const p = rec.payload ?? {};
  const decided = rec.status !== "proposed";
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [optionId, setOptionId] = useState<string>(p.chosenOptionId ?? "");
  const [reason, setReason] = useState("");

  const chosen = useMemo(
    () =>
      (p.options ?? []).find(
        (o: any) => o.id === (p.modifiedOptionId ?? p.chosenOptionId),
      ) ?? (p.options ?? [])[0],
    [p],
  );
  const outboundDraft = messages.find(
    (m) =>
      m.recommendationId === rec.id &&
      m.direction === "outbound" &&
      m.status === "draft_created",
  );

  async function decide(action: "approve" | "modify" | "reject") {
    setBusy(action);
    setErr(null);
    try {
      await jfetch(`/api/recommendations/${rec.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          action,
          optionId: action === "modify" ? optionId : undefined,
          reason: reason || undefined,
        }),
      });
      setChangeOpen(false);
      setRejectOpen(false);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sendDraft() {
    if (!outboundDraft) return;
    setBusy("send");
    try {
      await jfetch(`/api/messages/${outboundDraft.id}/send`, {
        method: "POST",
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const oc = outcomeLabel(rec);

  return (
    <RailRow tone={decided ? oc.tone : "warn"} className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-bold text-ink">
          {p.patientName ?? "Patient"}
        </span>
        <Chip tone="neutral">{kindLabel(rec.kind)}</Chip>
        {p.replanNote && <Chip tone="accent">Asked: {p.replanNote}</Chip>}
        <span className="ml-auto">
          {decided && <Chip tone={oc.tone}>{oc.label}</Chip>}
        </span>
      </div>

      {p.priorityReason && !decided && (
        <p className="mt-1 text-[13px] text-muted">{p.priorityReason}</p>
      )}

      <div className="mt-2.5">
        {rec.kind === "reschedule" && chosen && (
          <RescheduleLine
            fromLabel={p.from?.when}
            toUtc={chosen.startUtc}
            doctorName={chosen.doctorName}
          />
        )}
        {rec.kind === "waitlist_fill" && (
          <p className="text-[14px]">
            Offer <b className="tnum">{p.when}</b>{" "}
            <span className="text-muted">with {p.doctorName}</span>
          </p>
        )}
        {rec.kind === "clarification" && (
          <>
            <p className="text-[14px]">{p.question}</p>
            {(p.choices ?? []).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.choices.map((o: string, i: number) => (
                  <Chip key={i} tone="accent">
                    {o}
                  </Chip>
                ))}
              </div>
            )}
            {p.relaxationYield != null && (
              <p className="mt-1 text-[12px] text-muted">
                If they can flex, {p.relaxationYield} option
                {p.relaxationYield === 1 ? "" : "s"} open up.
              </p>
            )}
          </>
        )}
        {(rec.kind === "confirm_nudge" || rec.kind === "preventive") && (
          <>
            <p className="text-[14px]">
              {rec.kind === "confirm_nudge"
                ? "Ask them to confirm"
                : "Friendly check-in for"}{" "}
              <b className="tnum">{p.from?.when}</b>
              <span className="text-muted"> with {p.from?.doctorName}</span>
            </p>
            {rec.kind === "preventive" && p.rationale && (
              <p className="mt-1 text-[12px] text-muted">{p.rationale}</p>
            )}
          </>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {rec.kind === "reschedule" && chosen && (
          <button
            className="font-semibold text-accent hover:underline"
            onClick={() => setWhyOpen((v) => !v)}
          >
            Why this time?
          </button>
        )}
        {p.draft && (
          <button
            className="font-semibold text-accent hover:underline"
            onClick={() => setDraftOpen(true)}
          >
            See the message
          </button>
        )}
      </div>
      {whyOpen && chosen && (
        <p className="mt-1 text-[13px] text-muted">{whyLine(chosen, p)}</p>
      )}
      {decided && rec.decisionReason && (
        <p className="mt-1.5 text-[13px] text-muted">
          <b className="text-ink/80">Note:</b> {rec.decisionReason}
        </p>
      )}
      {err && <p className="mt-2 text-[13px] font-semibold text-bad">{err}</p>}

      {!decided && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="success"
            small
            disabled={!!busy}
            onClick={() => decide("approve")}
          >
            {busy === "approve" ? <Spinner /> : "Approve"}
          </Button>
          {rec.kind === "reschedule" && (p.options ?? []).length > 1 && (
            <Button
              variant="secondary"
              small
              disabled={!!busy}
              onClick={() => setChangeOpen(true)}
            >
              Change time
            </Button>
          )}
          <Button
            variant="quiet"
            small
            className="text-bad"
            disabled={!!busy}
            onClick={() => setRejectOpen(true)}
          >
            Can&apos;t do this
          </Button>
        </div>
      )}

      {outboundDraft && (
        <div className="mt-3 flex items-center gap-2 rounded-ctl border border-accent-line bg-accent-soft px-3 py-2">
          <span className="text-[13px] font-semibold text-accent">
            Email drafted — nothing goes out until you press Send.
          </span>
          <Button
            small
            className="ml-auto"
            disabled={busy === "send"}
            onClick={sendDraft}
          >
            {busy === "send" ? <Spinner /> : "Send"}
          </Button>
        </div>
      )}

      {/* Change time */}
      <Modal
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        title={`Pick another time for ${p.patientName ?? "this patient"}`}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setChangeOpen(false)}>
              Back
            </Button>
            <Button
              disabled={!!busy || !optionId}
              onClick={() => decide("modify")}
            >
              {busy === "modify" ? <Spinner /> : "Use this time"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          Every option below already fits the doctor&apos;s rules and calendar.
        </p>
        <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto thin-scroll pr-1">
          {(p.options ?? [])
            .filter((o: any) => o && o.startUtc)
            .map((o: any) => (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-ctl border px-3 py-2",
                  optionId === o.id
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-white hover:border-strong",
                )}
              >
                <input
                  type="radio"
                  name={`opt-${rec.id}`}
                  checked={optionId === o.id}
                  onChange={() => setOptionId(o.id)}
                  className="accent-accent"
                />
                <span className="tnum text-[14px] font-semibold text-ink">
                  {fmtWhenManila(o.startUtc)}
                </span>
                <span className="text-[13px] text-muted">{o.doctorName}</span>
              </label>
            ))}
        </div>
      </Modal>

      {/* Reject */}
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Don't send this one?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={!!busy || reason.trim().length < 3}
              onClick={() => decide("reject")}
            >
              {busy === "reject" ? <Spinner /> : "Confirm"}
            </Button>
          </>
        }
      >
        <p>
          {rec.kind === "reschedule"
            ? "The original visit will be cancelled and the patient flagged for a phone call instead. Nothing is emailed."
            : "No message will be sent."}
        </p>
        <label className="mt-3 block text-[12px] font-bold text-muted">
          Reason (kept in the record)
        </label>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Patient prefers a call — I'll ring her"
          className="mt-1 w-full rounded-ctl border border-line px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
      </Modal>

      {/* Draft preview */}
      <Modal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title="Message to the patient"
        wide
        footer={
          <Button variant="secondary" onClick={() => setDraftOpen(false)}>
            Close
          </Button>
        }
      >
        {p.draft && (
          <div className="rounded-ctl border border-line bg-paper p-3 z-100">
            <p className="text-[13px] font-bold text-ink">{p.draft.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/85">
              {p.draft.body}
            </p>
          </div>
        )}
      </Modal>
    </RailRow>
  );
}
