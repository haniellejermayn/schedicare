/** npm run demo:reset [lite] — wipe and reseed to the exact pre-demo state. */
import "@/eval/loadEnv"; // .env.local / .env — must be the FIRST import
import { seed } from "@/sim/seed";

import fs from "node:fs";
import path from "node:path";
try {
  fs.rmSync(path.join(process.cwd(), ".tmp", "clock-anchor"));
} catch {
  /* no anchor yet */
}

const profile =
  process.argv[2] === "lite" ? ("lite" as const) : ("full" as const);
const s = seed(profile);
console.log(
  `[reset] Demo state restored (${profile}): ${s.patients} patients, ${s.appointments} appointments (${s.demoDayAffected} in the cascade), ${s.waitlist} waitlist entries. All cases, events, messages and audit entries cleared.`,
);
