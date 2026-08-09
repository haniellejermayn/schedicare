import { FrontDeskShell } from "@/components/shell/FrontDeskShell";

/**
 * Route group — `(frontdesk)` does not appear in the URL. `/ops`, `/ops/cases/[id]`
 * and `/settings` all render inside the staff console chrome.
 */
export default function FrontDeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FrontDeskShell>{children}</FrontDeskShell>;
}
