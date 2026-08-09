/**
 * npm run demo — one-command demo: reset data, then run web + worker together.
 * Ctrl-C stops both.
 */
import "@/eval/loadEnv"; // .env.local / .env — must be the FIRST import
import { spawn } from "node:child_process";
import { seed } from "@/sim/seed";

const profile = process.argv[2] === "full" ? "full" : "lite";
const s = seed(profile, { preserveIntegrations: true });
console.log(
  `\n[demo] Seeded ${profile} profile: ${s.patients} patients / ${s.appointments} appointments. ${s.demoDayAffected}-patient cascade: ${s.demoDay} (Asia/Manila).`,
);
console.log("[demo] Starting web (http://localhost:3000) and worker …");
console.log(
  "[demo] Flow: Doctor → I can't come in → watch /ops → approve three offers → reply through Gmail.\n",
);

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const procs = [
  spawn(npx, ["next", "dev"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  }),
  spawn(npx, ["tsx", "worker/index.ts"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  }),
];
const stop = () => {
  for (const p of procs) p.kill("SIGINT");
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs)
  p.on("exit", (code) => {
    if (code && code !== 0) stop();
  });
