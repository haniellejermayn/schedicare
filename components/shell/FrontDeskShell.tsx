"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePoll } from "@/lib/usePoll";
import { IconButton, Logo } from "@/components/ui";
import { ModeIndicator } from "@/components/shell/ModeIndicator";
import { RoleSwitcher } from "@/components/shell/RoleSwitcher";

/**
 * The front desk is the primary workspace and the densest surface: a queue that
 * someone works through. Its chrome is a compact console bar — wordmark, role,
 * running clock, integration mode — over a wide content well.
 */
export function FrontDeskShell({ children }: { children: ReactNode }) {
  const { data: status } = usePoll<{ demoNow?: string }>("/api/status", 5000);

  const clock = status?.demoNow
    ? new Date(status.demoNow).toLocaleTimeString("en-PH", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Manila",
      })
    : null;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
          <Link
            href="/ops"
            className="flex items-center gap-2 rounded-ctl"
            aria-label="SchediCare front desk"
          >
            <Logo size={24} />
            <span className="hidden text-md font-bold tracking-[-0.025em] text-ink sm:inline">
              SchediCare
            </span>
          </Link>

          <span
            className="hidden h-4 w-px shrink-0 bg-line md:block"
            aria-hidden
          />
          <span className="hidden text-sm font-semibold text-muted md:inline">
            Riverside Family Clinic
          </span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {clock && (
              <span className="tnum hidden font-mono text-xs text-muted lg:inline">
                {clock}
              </span>
            )}
            <ModeIndicator />
            <RoleSwitcher className="hidden sm:flex" />
            <Link href="/settings" aria-label="Settings">
              <IconButton label="Settings" tabIndex={-1}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </IconButton>
            </Link>
          </div>
        </div>

        {/* Role switching stays reachable on a narrow window without crowding
            the bar — the demo laptop may not be at full width. */}
        <div className="border-t border-line px-4 py-2 sm:hidden">
          <RoleSwitcher className="w-full justify-between" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
        {children}
      </main>

      <footer className="border-t border-line px-4 py-5 text-center text-sm text-muted">
        Nothing is sent or booked without your approval.
      </footer>
    </div>
  );
}
