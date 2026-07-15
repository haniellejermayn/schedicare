/** npm run setup — create schema + deterministic seed. */
import { ensureSchema } from "@/core/db/migrate";
import { seed } from "@/sim/seed";

ensureSchema();
const s = seed();
console.log(`[setup] Riverside Family Clinic seeded: ${s.patients} patients, ${s.appointments} appointments (${s.demoDayAffected} on the demo day for Dr. Santos), ${s.waitlist} waitlist entries.`);
console.log(`[setup] Demo clock anchor: 2026-08-10 07:30 Asia/Manila (override with DEMO_NOW).`);
