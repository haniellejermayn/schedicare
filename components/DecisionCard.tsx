"use client";
import { useId, useMemo, useState } from "react";
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
import {
  kindLabel,
  outcomeLabel,
  plainPriorityReason,
} from "@/components/copy";
import { ManualSlotPicker } from "@/components/ManualSlotPicker";

/** Ranking chips as readable bullets — no scores, no jargon. */
function whyBullets(option: any, payload: any): string[] {
  const labels: string[] = (option?.chips ?? [])
    .map((c: any) => String(c.label))
    .slice(0, 5);
  if (labels.length === 0 && payload.rationale) return [payload.rationale];
  if (labels.length === 0)
    return ["Best available match under the doctor's rules."];
  return labels;
}

/** Floor for a hand-written draft — below this it is a slip, not a message. */
const MIN_DRAFT_CHARS = 10;

const REJECT_REASONS = [
  "Patient prefers a phone call",
  "The time won't work for this patient",
  "Wrong doctor for this visit",
  "Already handled another way",
  "Other",
] as const;

export function DecisionCard({
  rec,
  messages,
  onDone,
  constraintReview,
  onReviewConstraints,
}: {
  rec: any;
  messages: any[];
  onDone: () => void;
  constraintReview?: any;
  onReviewConstraints?: () => void;
}) {
  const p = rec.payload ?? {};
  const decided = rec.status !== "proposed";
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const whyId = useId();
  const [optionId, setOptionId] = useState<string>(p.chosenOptionId ?? "");
  // Reject: structured reason + optional note + callback flag (default ON).
  const [rejectPreset, setRejectPreset] = useState<
    (typeof REJECT_REASONS)[number]
  >(REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState("");
  const [flagCall, setFlagCall] = useState(true);
  // Manual slot picker (any rule-valid time, validated server-side again).
  const [manualSel, setManualSel] = useState<any | null>(null);
  // Draft editing.
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");

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
    setInfo(null);
    try {
      const rejectReason =
        rejectPreset === "Other"
          ? rejectNote.trim()
          : rejectNote.trim()
            ? `${rejectPreset} — ${rejectNote.trim()}`
            : rejectPreset;
      await jfetch(`/api/recommendations/${rec.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          action,
          optionId: action === "modify" && !manualSel ? optionId : undefined,
          slot:
            action === "modify" && manualSel
              ? { doctorId: manualSel.doctorId, startUtc: manualSel.startUtc }
              : undefined,
          reason: action === "reject" ? rejectReason : undefined,
          flagCall: action === "reject" ? flagCall : undefined,
        }),
      });
      setChangeOpen(false);
      setRejectOpen(false);
      if (action === "modify")
        setInfo(
          "Time updated and the message rewritten — review it, then Approve.",
        );
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraftEdit() {
    setBusy("edit");
    setErr(null);
    try {
      await jfetch(`/api/recommendations/${rec.id}/draft`, {
        method: "POST",
        body: JSON.stringify({ body: editBody }),
      });
      setEditing(false);
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
  const rejectComposed =
    rejectPreset === "Other" ? rejectNote.trim() : rejectPreset;

  if (constraintReview) {
    return (
      <div className="rounded-card border border-warn-line bg-warn-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="warn">Required review</Chip>
          <span className="text-[15px] font-bold text-ink">
            {p.patientName ?? "Patient"}
          </span>
        </div>
        <p className="mt-2 text-[13px] text-ink">
          {constraintReview.set?.summary ??
            constraintReview.reason ??
            "Review the patient’s scheduling constraints before choosing the next action."}
        </p>
        <p className="mt-1 text-[12px] text-muted">
          Actions for this patient stay unavailable until a validated replan
          or negotiation starts.
        </p>
        <Button small className="mt-3" onClick={onReviewConstraints}>
          Review constraints
        </Button>
      </div>
    );
  }

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
        <p className="mt-1 text-[13px] text-muted">
          <span className="font-semibold text-ink">Context:</span>{" "}
          {plainPriorityReason(p.priorityReason)}
        </p>
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

      {/* These two were text links whose only affordance was hover:underline,
          so at a glance they read as prose. They are now bordered controls, and
          the icons distinguish what each one does: a chevron that rotates means
          "opens here", an envelope means "opens a dialog". */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {rec.kind === "reschedule" && chosen && (
          <button
            type="button"
            aria-expanded={whyOpen}
            aria-controls={whyId}
            onClick={() => setWhyOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-ctl border px-2.5 py-1.5",
              "text-[13px] font-semibold transition-colors duration-fast ease-snappy",
              whyOpen
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-line bg-surface-alt text-ink hover:border-strong hover:bg-white",
            )}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              className={cn(
                "transition-transform duration-fast ease-snappy",
                whyOpen && "rotate-90",
              )}
            >
              <path
                d="M4 2.5 8 6l-4 3.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Why this time?
          </button>
        )}
        {p.draft && (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraftOpen(true);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-ctl border border-line bg-surface-alt px-2.5 py-1.5",
              "text-[13px] font-semibold text-ink transition-colors duration-fast ease-snappy",
              "hover:border-strong hover:bg-white",
            )}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
              <rect
                x="1.4"
                y="2.9"
                width="11.2"
                height="8.2"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="m1.9 3.7 5.1 3.5 5.1-3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            See the message
          </button>
        )}
      </div>
      {whyOpen && chosen && (
        // The rail ties the panel back to the control that opened it, so the
        // reasoning reads as belonging to this recommendation rather than
        // floating loose under the card.
        <div
          id={whyId}
          className="mt-2 animate-rise rounded-ctl border border-accent-line border-l-[3px] border-l-accent-rail bg-accent-soft/60 px-3 py-2.5"
        >
          <p className="eyebrow mb-1.5">Why the agent picked this</p>
          <ul className="space-y-1">
            {whyBullets(chosen, p).map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-ink-soft">
                <span
                  aria-hidden
                  className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-rail"
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rec.status === "failed" && p.failedReason && (
        <p className="mt-1.5 text-[13px] font-semibold text-bad">
          Couldn&apos;t complete:{" "}
          <span className="font-normal">{p.failedReason}</span>
        </p>
      )}
      {decided && rec.decisionReason && (
        <p className="mt-1.5 text-[13px] text-muted">
          <b className="text-ink/80">Note:</b> {rec.decisionReason}
        </p>
      )}
      {info && <p className="mt-2 text-[13px] font-semibold text-ok">{info}</p>}
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
          {rec.kind === "reschedule" && (p.options ?? []).length > 0 && (
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
              disabled={!!busy || (!manualSel && !optionId)}
              onClick={() => decide("modify")}
            >
              {busy === "modify" ? <Spinner /> : "Use this time"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          Every option here fits the doctor&apos;s rules and calendar. Changing
          the time rewrites the message for the new slot.
        </p>
        <p className="eyebrow mt-3">Suggested times</p>
        <div className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto thin-scroll pr-1">
          {(p.options ?? [])
            .filter((o: any) => o && o.startUtc)
            .map((o: any) => (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-ctl border px-3 py-2",
                  !manualSel && optionId === o.id
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-white hover:border-strong",
                )}
              >
                <input
                  type="radio"
                  name={`opt-${rec.id}`}
                  checked={!manualSel && optionId === o.id}
                  onChange={() => {
                    setManualSel(null);
                    setOptionId(o.id);
                  }}
                  className="accent-accent"
                />
                <span className="tnum text-[14px] font-semibold text-ink">
                  {fmtWhenManila(o.startUtc)}
                </span>
                <span className="text-[13px] text-muted">{o.doctorName}</span>
              </label>
            ))}
        </div>

        <p className="eyebrow mt-4">Or pick any other valid time</p>
        <div className="mt-1.5">
          <ManualSlotPicker
            initialDoctorId={chosen?.doctorId}
            name={`manual-${rec.id}`}
            selected={manualSel}
            onSelect={setManualSel}
            searchSlots={async (doctorId, day) => {
              const r = await jfetch<any>(
                `/api/slots?doctorId=${doctorId}&type=${p.type}&fromDay=${day}&toDay=${day}${p.appointmentId ? `&ignoreAppointmentId=${p.appointmentId}` : ""}`,
              );
              return { slots: r.slots ?? [] };
            }}
            emptyMessage="No open slots for that doctor on that day — the rules, calendar, or caps are in the way."
          />
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
              disabled={!!busy || rejectComposed.length < 3}
              onClick={() => decide("reject")}
            >
              {busy === "reject" ? <Spinner /> : "Confirm"}
            </Button>
          </>
        }
      >
        <p>
          {rec.kind === "reschedule"
            ? "The original visit will be cancelled and nothing is emailed."
            : "No message will be sent."}
        </p>
        <label className="mt-3 block text-[12px] font-bold text-muted">
          Reason (kept in the record)
        </label>
        <select
          value={rejectPreset}
          onChange={(e) =>
            setRejectPreset(e.target.value as (typeof REJECT_REASONS)[number])
          }
          className="mt-1 w-full rounded-ctl border border-line bg-white px-3 py-2 text-[14px] outline-none focus:border-accent"
        >
          {REJECT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={
            rejectPreset === "Other"
              ? "Tell the record what happened (required)"
              : "Anything else for the record? (optional)"
          }
          className="mt-2 w-full rounded-ctl border border-line px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={flagCall}
            onChange={(e) => setFlagCall(e.target.checked)}
            className="accent-accent"
          />
          Flag this patient for a phone call
        </label>
      </Modal>

      {/* Draft preview + edit */}
      <Modal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title={`Message to ${p.patientName ?? "the patient"}`}
        wide
        footer={
          editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                loading={busy === "edit"}
                disabled={editBody.trim().length < MIN_DRAFT_CHARS}
                onClick={saveDraftEdit}
              >
                Save edit
              </Button>
            </>
          ) : (
            <>
              <Button variant="quiet" onClick={() => setDraftOpen(false)}>
                Close
              </Button>
              {!decided && p.draft && (
                <Button
                  onClick={() => {
                    setEditBody(p.draft.body);
                    setEditing(true);
                  }}
                >
                  Edit message
                </Button>
              )}
            </>
          )
        }
      >
        {p.draft && !editing && (
          <>
            {/* Header strip + body, so it reads as the email it will become
                rather than a paragraph in a box. */}
            <div className="overflow-hidden rounded-ctl border border-line">
              <div className="border-b border-line bg-surface-alt px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="eyebrow shrink-0">To</span>
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {p.patientName ?? "Patient"}
                  </span>
                  {p.draftEditedByStaff && (
                    <Chip tone="accent" className="ml-auto shrink-0">
                      Edited by staff
                    </Chip>
                  )}
                </div>
                <p className="mt-1.5 text-[14px] font-bold text-ink">
                  {p.draft.subject}
                </p>
              </div>
              <div className="bg-white px-3.5 py-3.5">
                <p className="whitespace-pre-wrap text-[14px] leading-[1.65] text-ink-soft">
                  {p.draft.body}
                </p>
              </div>
            </div>
            {/* The gate, restated at the point where staff are looking at the
                words that would go out. */}
            <p className="mt-3 flex items-start gap-2 text-[12px] text-muted">
              <svg
                width="13"
                height="13"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
                className="mt-[1px] shrink-0"
              >
                <rect
                  x="2.6"
                  y="6.2"
                  width="8.8"
                  height="6.2"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M4.7 6.2V4.6a2.3 2.3 0 0 1 4.6 0v1.6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              Nothing is sent until you approve. You can change the wording
              first.
            </p>
          </>
        )}
        {editing && (
          <>
            {/* The subject stays on screen while editing — you are writing the
                body underneath it, and losing it costs you the context. */}
            <div className="rounded-t-ctl border border-b-0 border-line bg-surface-alt px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="eyebrow shrink-0">To</span>
                <span className="truncate text-[13px] font-semibold text-ink">
                  {p.patientName ?? "Patient"}
                </span>
              </div>
              <p className="mt-1.5 text-[14px] font-bold text-ink">
                {p.draft?.subject}
              </p>
            </div>
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={11}
              autoFocus
              aria-label="Message body"
              className={cn(
                "block w-full rounded-b-ctl border border-line bg-white px-3.5 py-3",
                "text-[14px] leading-[1.65] text-ink outline-none",
                "transition-colors duration-fast focus:border-accent-rail",
              )}
            />
            <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="text-[12px] text-muted">
                Changing the time later rewrites the whole message for the new
                slot.
              </p>
              {/* Save is disabled under the minimum; without this the button
                  just sits dead with no stated reason. */}
              <span
                className={cn(
                  "tnum shrink-0 text-[12px] font-semibold",
                  editBody.trim().length < MIN_DRAFT_CHARS
                    ? "text-bad"
                    : "text-muted",
                )}
              >
                {editBody.trim().length < MIN_DRAFT_CHARS
                  ? `${MIN_DRAFT_CHARS - editBody.trim().length} more characters needed`
                  : `${editBody.trim().length} characters`}
              </span>
            </div>
          </>
        )}
      </Modal>
    </RailRow>
  );
}
