"use client";
import { usePoll } from "@/lib/usePoll";
import { cn } from "@/components/ui";

/**
 * Live vs. resilience mode. This is a demo-safety feature, not decoration:
 * when Bedrock or Google is unreachable the system degrades to deterministic
 * fallbacks, and the presenter needs to see which path is running without
 * leaving the screen they are on.
 */
export function ModeIndicator({ compact = false }: { compact?: boolean }) {
  const { data } = usePoll<{ mode?: string; reasons?: string[] }>(
    "/api/status",
    5000,
  );
  const live = data?.mode === "live";

  const title = data
    ? live
      ? "Claude, Google Calendar and Gmail are connected and verified."
      : data.reasons?.join(" ") || "Running on deterministic fallbacks."
    : "Checking integration status.";

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.08em]",
        live ? "text-ok" : "text-warn",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 rounded-full",
          data ? (live ? "bg-ok-rail" : "bg-warn-rail") : "bg-muted",
        )}
      />
      <span className={compact ? "sr-only" : undefined}>
        {data ? (live ? "Live" : "Resilience") : "Checking"}
      </span>
    </span>
  );
}
