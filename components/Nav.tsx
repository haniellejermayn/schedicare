"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
import { Logo, cn } from "@/components/ui";

interface StatusPayload {
  mode: "live" | "resilience";
  reasons: string[];
  services: Record<string, { live: boolean; detail: string }>;
  demoNow: string;
  counts: { openCases: number; pendingRecommendations: number };
}

export function ModePill({ compact = false }: { compact?: boolean }) {
  const { data } = usePoll<StatusPayload>("/api/status", 4000);
  if (!data) return null;
  const live = data.mode === "live";
  return (
    <span
      title={live ? "Gemini + Google Workspace are live" : `Presentation Resilience Mode — ${data.reasons.join("; ") || "simulated providers"}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-[11px] font-bold uppercase tracking-wide border",
        live ? "bg-[#E2F6ED] text-[#116B47] border-[#bfe9d6]" : "bg-[#F9EFDC] text-[#7A5310] border-[#eeddb8]"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-scd-success" : "bg-scd-warning animate-scd-blink")} />
      {live ? "Live Agentic Mode" : compact ? "Resilience Mode" : "Presentation Resilience Mode"}
    </span>
  );
}

const ROLES = [
  { href: "/book", label: "Patient" },
  { href: "/doctor", label: "Doctor" },
  { href: "/ops", label: "Staff Ops" },
];
const SYSTEM = [
  { href: "/integrations", label: "Integrations" },
  { href: "/admin", label: "Admin" },
];

export function Nav() {
  const path = usePathname();
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <header className="sticky top-0 z-40 border-b border-scd-line/70 bg-scd-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
        <Link href="/ops" className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="text-[17px] font-extrabold tracking-tight text-scd-ink">
            Schedi<span className="text-scd-primary">Care</span>
          </span>
        </Link>
        <nav className="ml-2 flex items-center gap-1 rounded-pill bg-white p-1 shadow-ambient border border-scd-line/70" aria-label="Role switcher">
          {ROLES.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className={cn(
                "rounded-pill px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                isActive(r.href) ? "bg-scd-primary text-white shadow-glow" : "text-scd-muted hover:text-scd-deep"
              )}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ModePill compact />
          <nav className="flex items-center gap-1" aria-label="System">
            {SYSTEM.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className={cn(
                  "rounded-pill px-3 py-1.5 text-[13px] font-semibold",
                  isActive(r.href) ? "bg-scd-lavender text-scd-deep" : "text-scd-muted hover:text-scd-deep"
                )}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
