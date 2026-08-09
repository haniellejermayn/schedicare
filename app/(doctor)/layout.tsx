import { DoctorShell } from "@/components/shell/DoctorShell";

/** Route group — `(doctor)` does not appear in the URL; this wraps `/doctor`. */
export default function DoctorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DoctorShell>{children}</DoctorShell>;
}
