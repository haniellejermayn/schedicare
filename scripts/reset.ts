/** npm run demo:reset [lite] — wipe and reseed to the exact pre-demo state. */
import "@/eval/loadEnv"; // .env.local / .env — must be the FIRST import
import { seed } from "@/sim/seed";

const profile =
  process.argv[2] === "full" ? ("full" as const) : ("lite" as const);
const s = seed(profile, { preserveIntegrations: true });
console.log(
  `[reset] Demo state restored (${profile}): ${s.patients} patients, ${s.appointments} appointments (${s.demoDayAffected} in the ${s.demoDay} cascade), ${s.waitlist} waitlist entries. Cases and messages cleared; Google OAuth and calendar mappings preserved.`,
);
