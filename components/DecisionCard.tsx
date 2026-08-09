"use client";
import { useEffect, useMemo, useState } from "react";
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
}: {
  rec: any;
  messages: any[];
  onDone: () => void;
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
  const [optionId, setOptionId] = useState<string>(p.chosenOptionId ?? "");
  // Reject: structured reason + optional note + callback flag (default ON).
  const [rejectPreset, setRejectPreset] = useState<
    (typeof REJECT_REASONS)[number]
  >(REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState("");
  const [flagCall, setFlagCall] = useState(true);
  // Manual slot picker (any rule-valid time, validated server-side again).
  const [doctors, setDoctors] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [manualDoctor, setManualDoctor] = useState<string>("");
  const [manualDay, setManualDay] = useState<string>("");
  const [manualSlots, setManualSlots] = useState<any[] | null>(null);
  const [manualSel, setManualSel] = useState<any | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
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

  useEffect(() => {
    if (!changeOpen) return;
    setManualSel(null);
    setManualSlots(null);
    if (doctors.length === 0)
      jfetch<any>("/api/doctors")
        .then((d) => {
          setDoctors(d.doctors ?? []);
          if (!manualDoctor && chosen?.doctorId)
            setManualDoctor(chosen.doctorId);
        })
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeOpen]);

  async function findManualSlots() {
    if (!manualDoctor || !manualDay || !p.type) return;
    setManualBusy(true);
    setManualSel(null);
    try {
      const r = await jfetch<any>(
        `/api/slots?doctorId=${manualDoctor}&type=${p.type}&fromDay=${manualDay}&toDay=${manualDay}${p.appointmentId ? `&ignoreAppointmentId=${p.appointmentId}` : ""}`,
      );
      setManualSlots(r.slots ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setManualBusy(false);
    }
  }

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
            onClick={() => {
              setEditing(false);
              setDraftOpen(true);
            }}
          >
            See the message
          </button>
        )}
      </div>
      {whyOpen && chosen && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-muted">
          {whyBullets(chosen, p).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
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
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <select
            value={manualDoctor}
            onChange={(e) => setManualDoctor(e.target.value)}
            aria-label="Doctor"
            className="rounded-ctl border border-line bg-white px-2 py-1.5 text-[13px] font-semibold outline-none focus:border-accent"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={manualDay}
            onChange={(e) => setManualDay(e.target.value)}
            aria-label="Day"
            className="tnum rounded-ctl border border-line px-2 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <Button
            variant="secondary"
            small
            disabled={manualBusy || !manualDoctor || !manualDay}
            onClick={findManualSlots}
          >
            {manualBusy ? <Spinner /> : "Find times"}
          </Button>
        </div>
        {manualSlots && (
          <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto thin-scroll pr-1">
            {manualSlots.length === 0 && (
              <p className="text-[13px] text-muted">
                No open slots for that doctor on that day — the rules, calendar,
                or caps are in the way.
              </p>
            )}
            {manualSlots.map((s: any) => (
              <label
                key={s.startUtc}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-ctl border px-3 py-2",
                  manualSel?.startUtc === s.startUtc
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-white hover:border-strong",
                )}
              >
                <input
                  type="radio"
                  name={`manual-${rec.id}`}
                  checked={manualSel?.startUtc === s.startUtc}
                  onChange={() => setManualSel(s)}
                  className="accent-accent"
                />
                <span className="tnum text-[14px] font-semibold text-ink">
                  {fmtWhenManila(s.startUtc)}
                </span>
                <Chip tone="neutral">Staff picked</Chip>
              </label>
            ))}
          </div>
        )}
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
        title="Message to the patient"
        wide
        footer={
          editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy === "edit" || editBody.trim().length < 10}
                onClick={saveDraftEdit}
              >
                {busy === "edit" ? <Spinner /> : "Save edit"}
              </Button>
            </>
          ) : (
            <>
              {!decided && p.draft && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditBody(p.draft.body);
                    setEditing(true);
                  }}
                >
                  Edit message
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDraftOpen(false)}>
                Close
              </Button>
            </>
          )
        }
      >
        {p.draft && !editing && (
          <div className="rounded-ctl border border-line bg-paper p-3">
            <p className="text-[13px] font-bold text-ink">{p.draft.subject}</p>
            {p.draftEditedByStaff && (
              <p className="mt-0.5 text-[11px] font-semibold text-accent">
                Edited by staff
              </p>
            )}
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/85">
              {p.draft.body}
            </p>
          </div>
        )}
        {editing && (
          <>
            <p className="text-[12px] text-muted">
              Your wording replaces the draft. The subject stays standardized,
              and changing the time later rewrites the whole message for the new
              slot.
            </p>
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={10}
              className="mt-2 w-full rounded-ctl border border-line px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
          </>
        )}
      </Modal>
    </RailRow>
  );
}
