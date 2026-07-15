import { boot } from "@/lib/api";
import { NextResponse } from "next/server";
import { exchangeCode } from "@/integrations/oauth";
import { setServiceHealth } from "@/core/status";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  boot();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const back = new URL("/integrations", url.origin);
  if (!code) {
    back.searchParams.set("oauth", "denied");
    return NextResponse.redirect(back);
  }
  try {
    await exchangeCode(code);
    setServiceHealth("calendar", { status: "ok", detail: "OAuth connected" });
    setServiceHealth("mail", { status: "ok", detail: "OAuth connected" });
    audit({ actor: "staff", action: "oauth.connected", detail: { provider: "google" } });
    back.searchParams.set("oauth", "ok");
  } catch (e) {
    audit({ actor: "staff", action: "oauth.failed", detail: { error: String((e as Error).message).slice(0, 200) } });
    back.searchParams.set("oauth", "error");
  }
  return NextResponse.redirect(back);
}
