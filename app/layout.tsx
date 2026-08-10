import type { Metadata } from "next";
import "./globals.css";
import { AppChrome } from "@/components/shell/AppChrome";

export const metadata: Metadata = {
  title: "SchediCare — Riverside Family Clinic",
  description: "Scheduling copilot for a small clinic. SchediCare proposes; clinic staff approve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
