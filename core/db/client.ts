import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

function dbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./schedicare.db";
  const p = url.replace(/^file:/, "");
  const dir = path.dirname(p);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return p;
}

type G = typeof globalThis & { __schedicare?: { sqlite: Database.Database; db: DB; path: string } };
const g = globalThis as G;

function open() {
  const p = dbPath();
  const sqlite = new Database(p);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 4000");
  const db = drizzle(sqlite, { schema });
  return { sqlite, db, path: p };
}

if (!g.__schedicare || g.__schedicare.path !== dbPath()) {
  g.__schedicare = open();
}

export const sqlite = g.__schedicare.sqlite;
export const db: DB = g.__schedicare.db;
export { schema };
