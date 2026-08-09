"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui";

export const ROLES = [
  { href: "/ops", label: "Front desk" },
  { href: "/doctor", label: "Doctor" },
  { href: "/book", label: "Patient" },
] as const;

export function useActiveRole() {
  const path = usePathname();
  return (
    ROLES.find((r) => path === r.href || path.startsWith(`${r.href}/`))?.href ??
    null
  );
}

/**
 * There is no authentication in this build (PROJECT_STATUS names it as
 * deliberate scope), so the switcher stands in for signing in as each persona.
 * It stays reachable from every shell so a demo can move between roles without
 * typing a URL.
 */
export function RoleSwitcher({ className }: { className?: string }) {
  const active = useActiveRole();
  return (
    <nav
      aria-label="Switch role"
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5",
        className,
      )}
    >
      {ROLES.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          aria-current={active === r.href ? "page" : undefined}
          className={cn(
            // min-h keeps the pills thumb-sized on the phone layout, where this
            // row is the full-width control under the header.
            "inline-flex min-h-[38px] items-center rounded-full px-3.5 text-sm font-semibold",
            "transition-colors duration-fast ease-snappy",
            active === r.href
              ? "bg-ink text-white"
              : "text-muted hover:text-ink",
          )}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Patient-shell variant. A visible "Front desk / Doctor / Patient" toggle would
 * break the illusion that this is a patient's own phone, so it collapses into a
 * discreet corner control that is obviously a demo affordance.
 */
export function DemoRoleFab() {
  const [open, setOpen] = useState(false);
  const active = useActiveRole();
  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="animate-rise flex flex-col gap-1 rounded-card border border-line bg-surface p-1.5 shadow-lg">
          <span className="eyebrow px-2 pb-0.5 pt-1">View as</span>
          {ROLES.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className={cn(
                "rounded-ctl px-3 py-2 text-sm font-semibold transition-colors",
                active === r.href
                  ? "bg-ink text-white"
                  : "text-ink-soft hover:bg-surface-alt",
              )}
            >
              {r.label}
            </Link>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Hide role switcher" : "Switch role (demo)"}
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5",
          "text-xs font-semibold text-muted shadow-md transition-colors duration-fast",
          "hover:border-line-strong hover:text-ink",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warn-rail" aria-hidden />
        Demo
      </button>
    </div>
  );
}
