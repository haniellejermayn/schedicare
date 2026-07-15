/** npm run db:push — create/refresh the SQLite schema in place. */
import { ensureSchema } from "@/core/db/migrate";
ensureSchema();
console.log("[db] Schema ensured (SQLite via better-sqlite3).");
