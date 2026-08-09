"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { ModeIndicator } from "@/components/shell/ModeIndicator";
import { RoleSwitcher } from "@/components/shell/RoleSwitcher";

/**
 * The doctor view is not a queue — it is one person looking at their own day.
 * So the chrome deliberately reads differently from the front desk: a white
 * header band rather than the canvas console bar, a narrower well, and no
 * approval-gate footer (that copy belongs to staff).
 *
 * The doctor selector lives in the page, not here: `app/doctor/page.tsx` already
 * owns that state and duplicating it in the shell would give us two sources of
 * truth for who is being viewed.
 */
export function DoctorShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1080px] items-center gap-3 px-4 sm:px-6">
          <Link
            href="/doctor"
            className="flex items-center gap-2 rounded-ctl"
            aria-label="SchediCare doctor view"
          >
            <Logo size={24} />
            <span className="hidden text-md font-bold tracking-[-0.025em] text-ink sm:inline">
              SchediCare
            </span>
          </Link>

          <span className="hidden h-4 w-px shrink-0 bg-line sm:block" aria-hidden />
          <span className="eyebrow hidden sm:inline">Doctor</span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ModeIndicator />
            <RoleSwitcher className="hidden sm:flex" />
          </div>
        </div>
        <div className="border-t border-line px-4 py-2 sm:hidden">
          <RoleSwitcher className="w-full justify-between" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
