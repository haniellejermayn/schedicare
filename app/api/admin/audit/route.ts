import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  boot();
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").toLowerCase().trim();
  const limit = Math.min(Number(u.searchParams.get("limit") ?? 100), 400);
  let rows = db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(400).all();
  if (q) {
    rows = rows.filter((r) =>
      [r.actor, r.action, r.refType ?? "", r.refId ?? "", r.caseId ?? "", JSON.stringify(r.detail ?? {})].join(" ").toLowerCase().includes(q)
    );
  }
  return json({ entries: rows.slice(0, limit) });
}
