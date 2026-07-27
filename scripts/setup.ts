/** npm run setup — create schema + deterministic seed. */
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  const { ensureSchema } = await import("@/core/db/migrate");
  const { seed } = await import("@/sim/seed");

  ensureSchema();

  const s = seed();

  console.log(
    `[setup] Riverside Family Clinic seeded: ${s.patients} patients, ` +
      `${s.appointments} appointments (${s.demoDayAffected} on the demo day ` +
      `for Dr. Santos), ${s.waitlist} waitlist entries.`,
  );

  console.log(
    `[setup] Demo clock anchor: 2026-08-10 07:30 Asia/Manila ` +
      `(override with DEMO_NOW).`,
  );

  console.log(
    `[setup] Demo patient aliases: ${
      process.env.DEMO_PATIENT_EMAIL
        ? `enabled for ${process.env.DEMO_PATIENT_EMAIL}`
        : "disabled — using fictional addresses"
    }.`,
  );
}

main().catch((error) => {
  console.error("[setup] Failed:", error);
  process.exitCode = 1;
});
