import { boot, body, json } from "@/lib/api";
import { setForcedFallback, isForcedFallback } from "@/core/status";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Toggle Presentation Resilience Mode regardless of live availability. */
export async function POST(req: Request) {
  boot();
  const b = await body<{ on?: boolean }>(req);
  const next = b.on ?? !isForcedFallback();
  setForcedFallback(next);
  audit({ actor: "staff", action: "demo.force_fallback", detail: { on: next } });
  return json({ ok: true, forced: next });
}
