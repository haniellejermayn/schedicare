/** npm run setup — create schema and seed once; later runs refresh patient aliases. */
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  const { ensureSchema } = await import("@/core/db/migrate");
  const { db, schema } = await import("@/core/db/client");
  const { seed, syncSeededPatientEmails } = await import("@/sim/seed");

  ensureSchema();

  const existingPatients = db
    .select({ id: schema.patients.id })
    .from(schema.patients)
    .limit(1)
    .all();
  const profile =
    process.argv[2] === "lite" ? ("lite" as const) : ("full" as const);
  if (existingPatients.length === 0) {
    const s = seed(profile, { preserveIntegrations: true });
    console.log(
      `[setup] Riverside Family Clinic seeded (${profile}): ${s.patients} patients, ` +
        `${s.appointments} appointments (${s.demoDayAffected} on the demo day ` +
        `for Dr. Santos), ${s.waitlist} waitlist entries.`,
    );
  } else {
    const updated = syncSeededPatientEmails();
    console.log(
      `[setup] Updated ${updated} seeded patient email aliases without resetting demo or integration state.`,
    );
  }

  console.log(
    `[setup] Clock: ${process.env.DEMO_NOW || "now"} (Asia/Manila; use an ISO DEMO_NOW for deterministic runs).`,
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
