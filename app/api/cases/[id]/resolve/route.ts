import { boot, err, json } from "@/lib/api";
import { getCase, transitionCase } from "@/core/cases";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Staff manually closes an escalated case after handling it offline. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  boot();
  const c = getCase(params.id);
  if (c.state !== "escalated") return err(`only escalated cases can be manually resolved (case is ${c.state})`, 409);
  transitionCase(c.id, "resolved", "staff", "Handled by staff outside the automated flow.");
  audit({ actor: "staff", action: "case.resolved_manually", refType: "case", refId: c.id, caseId: c.id });
  return json({ ok: true });
}
