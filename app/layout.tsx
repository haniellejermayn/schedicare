import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "SchediCare — Riverside Family Clinic",
  description:
    "Multi-agent scheduling copilot for a small clinic. SchediCare proposes; clinic staff approve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
