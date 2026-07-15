import { NextResponse } from "next/server";
import { ensureSchema } from "@/core/db/migrate";

let booted = false;
/** Every route handler calls this first so the schema always exists in dev. */
export function boot() {
  if (!booted) {
    ensureSchema();
    booted = true;
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
