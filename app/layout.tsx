import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "SchediCare — Riverside Family Clinic",
  description: "Scheduling copilot for a small clinic. SchediCare proposes; clinic staff approve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto w-full max-w-[1180px] px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
