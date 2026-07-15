import { boot, json } from "@/lib/api";
import { seed } from "@/sim/seed";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  boot();
  const s = seed();
  audit({ actor: "staff", action: "demo.reset", detail: s });
  return json({ ok: true, ...s });
}
