"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, cn } from "@/components/ui";

const ROLES = [
  { href: "/doctor", label: "Doctor" },
  { href: "/ops", label: "Front desk" },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Logo size={24} />
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
        <Link href="/settings" className="gear" aria-label="Settings">
          ⚙︎
        </Link>
      </div>
    </header>
  );
}
