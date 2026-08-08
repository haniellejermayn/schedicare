import { beforeEach, describe, expect, it } from "vitest";
import { freshSeed } from "./helpers";
import {
  openCase,
  transitionCase,
  TransitionError,
  getCase,
  maybeResolveCase,
  escalateCase,
} from "@/core/cases";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";

function newCase() {
  return openCase({
    clinicId: "clinic_riverside",
    type: "doctor_emergency",
    severity: "high",
    title: "test case",
    meta: {},
  });
}

describe("case state machine", () => {
  beforeEach(() => freshSeed());

  it("walks the happy path open → … → resolved", () => {
    const c = newCase();
    transitionCase(c.id, "assessing", "orchestrator", "t");
    transitionCase(c.id, "planning", "orchestrator", "t");
    transitionCase(c.id, "awaiting_approval", "orchestrator", "t");
    transitionCase(c.id, "executing", "staff", "t");
    transitionCase(c.id, "resolving", "executor", "t");
    transitionCase(c.id, "resolved", "system", "t");
    expect(getCase(c.id).state).toBe("resolved");
    expect(getCase(c.id).resolvedAt).toBeTruthy();
  });

  it("rejects illegal jumps", () => {
    const c = newCase();
    expect(() =>
      transitionCase(c.id, "executing", "staff", "skip ahead"),
    ).toThrow(TransitionError);
    expect(() =>
      transitionCase(c.id, "resolved", "system", "skip ahead"),
    ).toThrow(TransitionError);
  });

  it("only staff can move awaiting_approval → executing", () => {
    const c = newCase();
    transitionCase(c.id, "assessing", "orchestrator", "t");
    transitionCase(c.id, "planning", "orchestrator", "t");
    transitionCase(c.id, "awaiting_approval", "orchestrator", "t");
    expect(() =>
      transitionCase(c.id, "executing", "orchestrator", "agent tries"),
    ).toThrow(TransitionError);
    expect(() =>
      transitionCase(c.id, "executing", "executor", "executor tries"),
    ).toThrow(TransitionError);
    transitionCase(c.id, "executing", "staff", "human approves");
    expect(getCase(c.id).state).toBe("executing");
  });

  it("escalation is reachable from working states and manually resolvable", () => {
    const c = newCase();
    transitionCase(c.id, "assessing", "orchestrator", "t");
    escalateCase(c.id, "orchestrator", "something odd");
    expect(getCase(c.id).state).toBe("escalated");
    transitionCase(c.id, "resolved", "staff", "handled by phone");
    expect(getCase(c.id).state).toBe("resolved");
  });

  it("an escalation while awaiting approval keeps the staff gate actionable", () => {
    // Regression: parallel patients share one case state. Grace's needs_human
    // reply escalating the case must not revoke the Approve button on
    // Camille's pending clarification.
    const c = newCase();
    transitionCase(c.id, "assessing", "orchestrator", "t");
    transitionCase(c.id, "planning", "orchestrator", "t");
    transitionCase(c.id, "awaiting_approval", "orchestrator", "t");
    escalateCase(c.id, "comms", "another patient's reply needs a person");
    expect(getCase(c.id).state).toBe("awaiting_approval"); // gate survives
    transitionCase(c.id, "executing", "staff", "approve still works");
    expect(getCase(c.id).state).toBe("executing");
  });

  it("staff (and only staff) can execute decided proposals from an escalated case", () => {
    const c = newCase();
    transitionCase(c.id, "assessing", "orchestrator", "t");
    escalateCase(c.id, "orchestrator", "needs a person");
    expect(getCase(c.id).state).toBe("escalated");
    expect(() =>
      transitionCase(c.id, "executing", "orchestrator", "agent tries"),
    ).toThrow(TransitionError);
    transitionCase(
      c.id,
      "executing",
      "staff",
      "staff approved the pending card",
    );
    expect(getCase(c.id).state).toBe("executing");
  });

  it("maybeResolveCase waits for every substantive outcome", () => {
    const c = newCase();
    transitionCase(c.id, "assessing", "orchestrator", "t");
    transitionCase(c.id, "planning", "orchestrator", "t");
    db.insert(schema.recommendations)
      .values({
        caseId: c.id,
        kind: "reschedule",
        status: "executed",
        outcome: "pending",
        payload: {},
        createdAt: new Date().toISOString(),
      })
      .run();
    transitionCase(c.id, "awaiting_approval", "orchestrator", "t");
    transitionCase(c.id, "executing", "staff", "t");
    transitionCase(c.id, "resolving", "executor", "t");
    maybeResolveCase(c.id);
    expect(getCase(c.id).state).toBe("resolving"); // outcome still pending
    const rec = db
      .select()
      .from(schema.recommendations)
      .where(eq(schema.recommendations.caseId, c.id))
      .get()!;
    db.update(schema.recommendations)
      .set({ outcome: "accepted" })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    maybeResolveCase(c.id);
    expect(getCase(c.id).state).toBe("resolved");
  });
});
