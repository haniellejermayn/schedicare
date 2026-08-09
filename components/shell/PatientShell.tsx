"use client";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Logo, cn } from "@/components/ui";
import { DemoRoleFab } from "@/components/shell/RoleSwitcher";

export type PatientTab = "visits" | "book";

const TABS: Array<{ id: PatientTab; label: string; icon: ReactNode }> = [
  {
    id: "visits",
    label: "My visits",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "book",
    label: "Book",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * Built for a phone first and centred on desktop at phone-ish width, so the
 * same URL reads correctly whether it is opened on a handset or projected from
 * a laptop. Chrome is deliberately minimal — a patient should see a clinic's
 * app, not a console.
 */
export function PatientShell(props: {
  tab: PatientTab;
  onTabChange: (t: PatientTab) => void;
  children: ReactNode;
}) {
  const framed = useSearchParams().get("frame") === "phone";
  if (!framed) return <PatientChrome {...props} />;

  // Presentation fallback for when no handset can reach the dev server (venue
  // wi-fi often isolates clients). Projecting the plain page at desktop width
  // reads as a narrow web page; inside a bezel it reads as a phone, which is
  // what the audience needs to understand at a glance.
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-strong p-6">
      <div className="rounded-[44px] border-[3px] border-ink/85 bg-ink/85 p-2 shadow-lg">
        <div className="relative h-[812px] w-[375px] overflow-hidden rounded-[36px] bg-canvas">
          {/* Status-bar stand-in — sells the device without faking chrome. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex h-7 items-center justify-center">
            <span className="h-1.5 w-20 rounded-full bg-ink/25" />
          </div>
          <div className="scroll-quiet h-full overflow-y-auto pt-7">
            <PatientChrome {...props} framed />
          </div>
        </div>
      </div>
    </div>
  );
}

function PatientChrome({
  tab,
  onTabChange,
  children,
  framed = false,
}: {
  tab: PatientTab;
  onTabChange: (t: PatientTab) => void;
  children: ReactNode;
  framed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col bg-canvas",
        // Inside the bezel the frame scrolls, not the viewport.
        framed ? "min-h-full" : "min-h-dvh",
      )}
    >
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[520px] items-center gap-2.5 px-4">
          <Logo size={24} />
          <span className="text-md font-bold tracking-[-0.025em] text-ink">
            SchediCare
          </span>
          <span className="ml-auto text-xs font-semibold text-muted">
            Riverside Family Clinic
          </span>
        </div>

        {/* Desktop gets inline tabs; the phone gets a bottom bar instead.
            `sm:` is viewport-based and cannot see the 375px bezel, so inside
            the frame the phone treatment is forced on regardless of viewport. */}
        <div
          className={cn(
            "mx-auto w-full max-w-[520px] gap-1 px-4",
            framed ? "hidden" : "hidden sm:flex",
          )}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-base font-semibold transition-colors duration-fast",
                tab === t.id
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-[520px] flex-1 px-4 pt-5",
          framed ? "pb-28" : "pb-28 sm:pb-10",
        )}
      >
        {children}
      </main>

      {/* Bottom tab bar — phones only. Safe-area padding keeps it clear of the
          iPhone home indicator.
          Inside the bezel it is `sticky`, not `fixed` (which pins to the browser
          viewport and escapes the frame) and not `absolute` (which is taken out
          of flow but still translates with the scroll container). Sticky pins to
          the bottom of the scrollport, which is what a phone tab bar does. */}
      <nav
        aria-label="Sections"
        className={cn(
          "z-30 border-t border-line bg-surface/95 backdrop-blur-md",
          "pb-[env(safe-area-inset-bottom)]",
          framed
            ? "sticky bottom-0 mt-auto"
            : "fixed inset-x-0 bottom-0 sm:hidden",
        )}
      >
        <div className="mx-auto flex max-w-[520px]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-semibold transition-colors duration-fast",
                tab === t.id ? "text-accent" : "text-muted",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <DemoRoleFab />
    </div>
  );
}
