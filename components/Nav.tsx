"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll } from "@/lib/usePoll";
import { Logo, cn } from "@/components/ui";

const ROLES = [
  { href: "/doctor", label: "Doctor" },
  { href: "/ops", label: "Front desk" },
];

function ModeDot() {
  const { data } = usePoll<any>("/api/status", 5000);
  if (!data) return null;
  const live = data.mode === "live";
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
      title={
        live
          ? "Connected to Google — approved recommendations reserve slots and send reviewed messages."
          : `Demo mode — nothing external is touched. ${data.reasons?.length ? data.reasons.join("; ") : ""}`
      }
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          live ? "bg-ok-rail" : "bg-warn-rail",
        )}
      />
      {live ? "Live" : "Demo mode"}
    </span>
  );
}

export function Nav() {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        <Link href="/ops" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-[15px] font-bold tracking-tight text-ink">
            SchediCare
          </span>
        </Link>
        <nav
          aria-label="Switch role"
          className="ml-2 flex items-center rounded-full border border-line bg-white p-0.5"
        >
          {ROLES.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className={cn(
                "rounded-full px-3 py-1 text-[13px] font-semibold transition-colors duration-fast",
                active(r.href)
                  ? "bg-ink text-white shadow-cut"
                  : "text-muted hover:text-ink",
              )}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ModeDot />
          <Link
            href="/settings"
            aria-label="Settings"
            className={cn(
              "rounded-ctl border px-2.5 py-1.5 text-[13px] font-semibold transition-colors duration-fast",
              active("/settings")
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-muted hover:text-ink",
            )}
          >
            ⚙︎
          </Link>
        </div>
      </div>
    </header>
  );
}
