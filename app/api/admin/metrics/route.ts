import { boot, json } from "@/lib/api";
import { adminMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  return json(adminMetrics());
}
