import { boot, json } from "@/lib/api";
import { runtimeMode } from "@/core/status";
import { demoNowIso, demoToday } from "@/core/clock";
import { db, schema } from "@/core/db/client";
import { inArray, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  const mode = runtimeMode();
  const openCases = db
    .select({ id: schema.cases.id })
    .from(schema.cases)
    .where(inArray(schema.cases.state, ["open", "assessing", "planning", "awaiting_approval", "executing", "resolving"]))
    .all().length;
  const pendingRecommendations = db
    .select({ id: schema.recommendations.id })
    .from(schema.recommendations)
    .where(eq(schema.recommendations.status, "proposed"))
    .all().length;
  return json({
    ...mode,
    demoNow: demoNowIso(),
    demoToday: demoToday(),
    counts: { openCases, pendingRecommendations },
  });
}
