/**
 * The case lifecycle as a LangGraph state machine.
 *
 * One graph, one thread per case (thread_id = caseId), checkpointed to SQLite.
 * The graph is the orchestrator: it sequences the planning steps, pauses at
 * interrupt() while staff decide (the approval gate) and while patients reply,
 * and loops back through planning when a counter-proposal spawns a replan.
 *
 * Design rule: the DATABASE stays the single source of truth for the UI and
 * the audit trail. Nodes call the same tested step functions as before; every
 * conditional edge routes purely on the case's DB state. That makes the graph
 * resilient to state changes made outside it (staff decisions via API routes,
 * reply handling) — on resume it simply re-reads reality and goes where the
 * case actually is. LangGraph owns sequencing, pausing and durability; the
 * core state machine (core/cases.ts) remains the hard gate — only an actor
 * named staff* can move awaiting_approval → executing, graph or no graph.
 */
import fs from "node:fs";
import path from "node:path";
import {
  StateGraph,
  Annotation,
  interrupt,
  Command,
  START,
  END,
} from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { env } from "@/core/env";
import {
  getCase,
  escalateCase,
  maybeResolveCase,
  transitionCase,
} from "@/core/cases";
import { timeline } from "@/core/timeline";
import {
  assessStep,
  scheduleStep,
  recoverStep,
  commsStep,
  nudgeStep,
  waitlistStep,
} from "@/worker/steps";
import { executeCase } from "@/worker/executor";

const CaseState = Annotation.Root({
  caseId: Annotation<string>(),
});
type S = typeof CaseState.State;

/* ------------------------------------------------------------------ nodes */

async function planNode(state: S): Promise<Partial<S>> {
  const c = getCase(state.caseId);
  try {
    if (c.type === "doctor_emergency") {
      await assessStep(state.caseId);
      // Empty blast radius (e.g. the demo clock has passed every visit that
      // day): nothing to search, rank, or send — close with a friendly note
      // instead of letting scheduleStep fail into an escalation.
      const affected = (
        (getCase(state.caseId).meta as any)?.assessment?.items ?? []
      ).length;
      if (affected === 0) {
        timeline(
          state.caseId,
          "orchestrator",
          "status",
          "No upcoming visits were affected — nothing to rebook",
          "Every appointment that day had already passed or none existed. The unavailability is recorded; no patient outreach is needed.",
        );
        transitionCase(
          state.caseId,
          "resolved",
          "orchestrator",
          "Nothing to recover — case closed.",
        );
        return {};
      }
      await scheduleStep(state.caseId);
      await recoverStep(state.caseId);
      await commsStep(state.caseId);
    } else if (
      c.type === "patient_cancellation" ||
      c.type === "slot_recovery"
    ) {
      await waitlistStep(state.caseId);
    } else if (c.type === "confirmation") {
      await nudgeStep(state.caseId, "confirm_nudge");
    } else if (c.type === "no_show_risk") {
      await nudgeStep(state.caseId, "preventive");
    } else {
      throw new Error(`No plan for case type ${c.type}`);
    }
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    try {
      escalateCase(state.caseId, "worker", `Planning failed: ${msg}`);
    } catch {
      /* already terminal */
    }
  }
  return {};
}

/** The approval gate: pause here until staff have decided every proposal. */
function gateNode(state: S): Partial<S> {
  const c = getCase(state.caseId);
  if (c.state === "awaiting_approval") {
    interrupt({ waiting: "staff_decisions", caseId: state.caseId });
  }
  return {};
}

async function executeNode(state: S): Promise<Partial<S>> {
  try {
    await executeCase(state.caseId);
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    try {
      escalateCase(state.caseId, "worker", `Execution failed: ${msg}`);
    } catch {
      /* already terminal */
    }
  }
  return {};
}

/** Watch loop: pause while patient outcomes are pending; wake on every reply. */
function watchNode(state: S): Partial<S> {
  maybeResolveCase(state.caseId);
  const c = getCase(state.caseId);
  if (c.state === "resolving") {
    interrupt({ waiting: "patient_replies", caseId: state.caseId });
  }
  return {};
}

/* ---------------------------------------------------------------- routing */

function route(state: S): "plan" | "gate" | "execute" | "watch" | typeof END {
  const c = getCase(state.caseId);
  switch (c.state) {
    case "open":
    case "assessing":
    case "planning":
      return "plan";
    case "awaiting_approval":
      return "gate";
    case "executing":
      return "execute";
    case "resolving":
      return "watch";
    case "resolved":
    case "escalated":
    default:
      return END;
  }
}

const ROUTES = ["plan", "gate", "execute", "watch", END] as const;

/* ------------------------------------------------------------ compilation */

let compiled: ReturnType<typeof build> | null = null;

function graphDbPath(): string {
  const url = env().DATABASE_URL.replace(/^file:/, "");
  const p = url.replace(/\.db$/, ".graph.db");
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  return p;
}

function build() {
  const g = new StateGraph(CaseState)
    .addNode("plan", planNode)
    .addNode("gate", gateNode)
    .addNode("execute", executeNode)
    .addNode("watch", watchNode)
    .addConditionalEdges(START, route, [...ROUTES])
    .addConditionalEdges("plan", route, [...ROUTES])
    .addConditionalEdges("gate", route, [...ROUTES])
    .addConditionalEdges("execute", route, [...ROUTES])
    .addConditionalEdges("watch", route, [...ROUTES]);
  return g.compile({ checkpointer: SqliteSaver.fromConnString(graphDbPath()) });
}

export function caseGraph() {
  if (!compiled) compiled = build();
  return compiled;
}

/** Test-only: rebuild against a fresh checkpoint DB (after env/db changes). */
export function resetCaseGraph(): void {
  compiled = null;
}

const cfg = (caseId: string) => ({
  configurable: { thread_id: caseId },
  recursionLimit: 400,
});

/** Start (or continue) a case's lifecycle graph; runs until the next pause. */
export async function startCase(caseId: string): Promise<void> {
  await caseGraph().invoke({ caseId }, cfg(caseId));
}

/**
 * Wake a paused case graph: after the final staff decision, after a patient
 * reply was handled, or after any external state change.
 *
 * Two revival modes:
 *  - a pending interrupt (gate/watch) → resume it in place;
 *  - NO pending interrupt but the case is in an actionable state → the prior
 *    run ended (typically via escalation) and a human has since revived the
 *    case (constraint replan, negotiation delegate, an approval). Start a
 *    FRESH run on the same thread: every edge routes conditionally on the
 *    case's DB state, so the graph re-enters exactly where the state machine
 *    says it should. END is not death while humans can revive a case.
 */
export async function resumeCase(caseId: string): Promise<void> {
  const g = caseGraph();
  const st = await g.getState(cfg(caseId));
  if (st?.next && st.next.length > 0) {
    await g.invoke(new Command({ resume: "wake" }), cfg(caseId));
    return;
  }
  const c = getCase(caseId);
  if (c.state === "resolved" || c.state === "escalated") return; // truly nothing to run
  await g.invoke({ caseId }, cfg(caseId));
}

/** For /settings demo tooling: where the graph thread is paused right now. */
export async function caseGraphStatus(
  caseId: string,
): Promise<{ paused: boolean; at: string[] }> {
  try {
    const st = await caseGraph().getState(cfg(caseId));
    return { paused: (st?.next ?? []).length > 0, at: [...(st?.next ?? [])] };
  } catch {
    return { paused: false, at: [] };
  }
}
