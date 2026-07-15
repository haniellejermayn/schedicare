import { boot, err } from "@/lib/api";
import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/integrations/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  if (!googleConfigured()) return err("Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI first (see docs/GOOGLE_WORKSPACE_SETUP.md)", 400);
  return NextResponse.redirect(authUrl());
}
