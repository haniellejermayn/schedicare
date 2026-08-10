import { networkInterfaces } from "node:os";

export type LanAddress = {
  /** Adapter name, e.g. "Wi-Fi". */
  name: string;
  address: string;
  /**
   * False for virtual adapters (WSL, Docker, Hyper-V, VirtualBox). Those are
   * reachable from this machine but never from a phone, so they rank last
   * rather than being hidden — seeing them helps when the real one is missing.
   */
  likelyReachable: boolean;
};

const VIRTUAL = /vEthernet|WSL|Docker|VirtualBox|VMware|Loopback|Hyper-V|Tailscale|ZeroTier/i;

/** External IPv4 addresses, most-likely-reachable first. */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      out.push({ name, address: a.address, likelyReachable: !VIRTUAL.test(name) });
    }
  }
  return out.sort(
    (x, y) => Number(y.likelyReachable) - Number(x.likelyReachable),
  );
}

export function bestLanUrl(path = "/book", port = process.env.PORT ?? "3000"): string | null {
  const best = lanAddresses()[0];
  return best ? `http://${best.address}:${port}${path}` : null;
}
