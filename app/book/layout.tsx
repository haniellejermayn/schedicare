import { Suspense } from "react";

/**
 * `PatientShell` reads `?frame=phone` via `useSearchParams`, which Next requires
 * to sit under a Suspense boundary or the static prerender of `/book` fails.
 * The fallback is a bare canvas rather than a spinner — this resolves in the
 * same tick, and a flashing spinner would be more noticeable than nothing.
 */
export default function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" />}>
      {children}
    </Suspense>
  );
}
