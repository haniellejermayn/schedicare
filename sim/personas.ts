/**
 * Deterministic patient personas for Presentation Resilience Mode. When the
 * mail provider is simulated (or AUTO_SIM_REPLIES=true), executed offers get
 * a scripted reply a few seconds later, exercising the full interpret →
 * route → replan loop exactly as real Gmail replies would.
 */
export interface PersonaScript {
  /** Reply to the first offer. null = never replies. */
  firstReply: string | null;
  /** Reply to a replanned (second-round) offer. */
  replanReply?: string;
  /** Reply to a confirmation nudge / preventive outreach. */
  nudgeReply?: string | null;
  /** Reply to a waitlist offer. */
  waitlistReply?: string;
  /** Seconds to wait before replying (relative, real time). */
  delaySec?: number;
}

export const PERSONAS: Record<string, PersonaScript> = {
  pat_teresa: { firstReply: "Yes, that works for me. Thank you for letting me know so quickly!", delaySec: 4 },
  pat_jose: { firstReply: "Confirmed, see you then. Salamat po.", delaySec: 6 },
  pat_grace: { firstReply: null }, // staff rejects her offer; she gets a call instead
  pat_camille: { firstReply: "Yes po, confirm. Thank you!", delaySec: 5 },
  pat_miguel: {
    firstReply: "That time doesn't work for me — I'm at work until late. Anything after 4 PM?",
    replanReply: "4:30 PM works great. See you then, thanks for accommodating!",
    delaySec: 7,
  },
  pat_andres: { firstReply: "Ok, I'll take it.", delaySec: 8 },
  pat_paolo: { nudgeReply: "Yes, confirming my appointment. Thanks for the reminder.", firstReply: "Yes, confirmed.", delaySec: 5 },
  pat_dennis: { nudgeReply: null, firstReply: null }, // never replies — staff sees the outreach stay quiet
  pat_rosa: { waitlistReply: "Yes! I'll take the earlier slot, thank you so much!", firstReply: "Yes, confirmed.", delaySec: 4 },
};

export function personaReply(
  patientId: string,
  kind: "first" | "replan" | "nudge" | "waitlist"
): { body: string; delaySec: number } | null {
  const p = PERSONAS[patientId];
  const fallback = "Yes, confirmed. Thank you!";
  const delaySec = p?.delaySec ?? 5;
  if (!p) return { body: fallback, delaySec };
  const body =
    kind === "first" ? p.firstReply : kind === "replan" ? (p.replanReply ?? p.firstReply) : kind === "nudge" ? p.nudgeReply : p.waitlistReply;
  if (body === null || body === undefined) return null;
  return { body, delaySec };
}
