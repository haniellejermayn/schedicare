/** npm run demo:reset — wipe and reseed to the exact pre-demo state. */
import { seed } from "@/sim/seed";

const s = seed();
console.log(`[reset] Demo state restored: ${s.patients} patients, ${s.appointments} appointments, ${s.waitlist} waitlist entries. All cases, events, messages and audit entries cleared.`);
