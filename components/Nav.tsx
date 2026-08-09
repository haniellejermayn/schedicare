"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";
import { usePoll } from "@/lib/usePoll";

const ROLES = [
  { href: "/doctor", label: "Doctor" },
  { href: "/ops", label: "Front desk" },
];

function ModeDot() {
  const { data } = usePoll<any>("/api/status", 5000);
  const live = data?.mode === "live";
  return (
    <span
      className="mode-dot"
      title={
        data
          ? live
            ? "Claude, Google Calendar, and Gmail are connected and verified."
            : data.reasons?.join(" ") || "Using presentation resilience mode."
          : "Checking integration status."
      }
    >
      <i style={{ background: live ? "var(--moss)" : "var(--amber)" }}></i>
      {data ? (live ? "Live" : "Resilience") : "Checking"}
    </span>
  );
}

export function Nav() {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <span className="logo"><span></span></span>
        <span className="brand">SchediCare</span>
        <nav className="roles" aria-label="Switch role">
          {ROLES.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className={cn(active(r.href) && "active")}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        <ModeDot />
        <Link href="/settings" className="gear" aria-label="Settings">
          ⚙︎
        </Link>
      </div>
    </header>
  );
}
