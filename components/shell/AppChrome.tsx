"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";

/**
 * Staff routes get the console chrome — top nav plus the 1180px well. The
 * patient view does not: it is reached by QR from a stranger's phone, so it
 * must never render staff navigation, and its own shell owns the width.
 *
 * `children` stays server-rendered; only this wrapper is a client component.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  const isPatientView = path?.startsWith("/book") ?? false;

  if (isPatientView) return <>{children}</>;

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-[1180px] px-5 py-6">{children}</main>
    </>
  );
}
