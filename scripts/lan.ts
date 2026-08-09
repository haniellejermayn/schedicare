/**
 * Print the addresses a phone on the same network can use to reach the dev
 * server, and where to project the scannable version.
 *
 * Run alongside `npm run dev:lan` (which binds 0.0.0.0 instead of localhost —
 * the default binding is why a phone on the same wi-fi still cannot connect).
 *
 * Detection lives in lib/lan.ts so this and the /qr page can never disagree.
 */
import { lanAddresses } from "../lib/lan";

const PORT = process.env.PORT ?? "3000";
const found = lanAddresses();

console.log("");
if (found.length === 0) {
  console.log("  No external IPv4 address found — is wi-fi off?");
} else {
  console.log("  Patient view, from a phone on the same network:");
  console.log("");
  for (const c of found) {
    const url = `http://${c.address}:${PORT}/book`;
    console.log(
      `    ${url.padEnd(34)} ${
        c.likelyReachable ? `(${c.name})` : `(${c.name} — virtual adapter, unlikely)`
      }`,
    );
  }
  console.log("");
  console.log("  Scannable version to project:");
  console.log(`    http://localhost:${PORT}/qr`);
}

console.log("");
console.log("  Phone and laptop must be on the SAME network, and the server");
console.log("  must be started with `npm run dev:lan` (not `npm run dev`).");
console.log("");
console.log("  Test one phone before the room fills. Many campus networks");
console.log("  isolate clients, so devices cannot reach each other even on");
console.log("  the same wi-fi. If that happens, either:");
console.log("    · use your phone's hotspot and join the laptop to it, or");
console.log("    · cloudflared tunnel --url http://localhost:3000");
console.log(`      then open  http://localhost:${PORT}/qr?url=<the https link>`);
console.log("");
console.log("  With no phones at all, project the framed view instead:");
console.log(`    http://localhost:${PORT}/book?frame=phone`);
console.log("");
