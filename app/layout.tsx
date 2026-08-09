import type { Metadata, Viewport } from "next";
import "./globals.css";
import { mono, sans } from "./fonts";

export const metadata: Metadata = {
  title: "SchediCare — Riverside Family Clinic",
  description:
    "Scheduling copilot for a small clinic. SchediCare proposes; clinic staff approve.",
};

/**
 * `viewport-fit=cover` pairs with the safe-area padding in PatientShell so the
 * booking flow clears the iPhone home indicator.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F7FA",
};

/**
 * Chrome lives in the per-role shells, not here — each route group
 * (`(frontdesk)`, `(doctor)`) supplies its own layout, and `/book` renders the
 * patient shell itself because that shell owns tab state.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
