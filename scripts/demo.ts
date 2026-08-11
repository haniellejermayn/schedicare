/**
 * npm run demo — one-command demo: reset data, then run web + worker together.
 * Ctrl-C stops both.
 */
import "@/eval/loadEnv"; // .env.local / .env — must be the FIRST import
import { spawn } from "node:child_process";
import { seed } from "@/sim/seed";
import { syncConnectedDemoCalendars } from "@/scripts/demoCalendarSync";

async function main() {
  const profile = process.argv[2] === "full" ? "full" : "lite";
  const s = seed(profile, { preserveIntegrations: true });
  console.log(
    `\n[demo] Seeded ${profile} profile: ${s.patients} patients / ${s.appointments} appointments. ${s.demoDayAffected}-patient cascade: ${s.demoDay} (Asia/Manila).`,
  );
  const calendar = await syncConnectedDemoCalendars();
  console.log(
    calendar.skipped
      ? `[demo] Calendar sync skipped: ${calendar.skipped}.`
      : `[demo] Reset ${calendar.calendarsCleared} dedicated Google calendars (${calendar.eventsDeleted} old events deleted); created ${calendar.appointmentsCreated} appointments and ${calendar.busyBlocksCreated} busy blocks.`,
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
}

void main().catch((error) => {
  console.error(`[demo] Setup failed: ${String((error as Error).message ?? error)}`);
  process.exit(1);
});
