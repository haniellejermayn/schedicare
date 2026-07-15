"use client";
import { clsx } from "clsx";
import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, useEffect } from "react";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

/* ----------------------------------------------------------------------- */
/* Logo — 30px rotated square with a white 9px core                         */
/* ----------------------------------------------------------------------- */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center bg-scd-primary shadow-glow"
      style={{ width: size, height: size, borderRadius: size * 0.3, transform: "rotate(45deg)" }}
    >
      <span className="bg-white" style={{ width: size * 0.3, height: size * 0.3, borderRadius: size * 0.1 }} />
    </span>
  );
}

/* ----------------------------------------------------------------------- */
/* Buttons                                                                  */
/* ----------------------------------------------------------------------- */
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, string> = {
    primary: "bg-scd-primary text-white hover:bg-scd-deep shadow-glow",
    secondary: "bg-scd-lavender text-scd-deep hover:bg-[#e2d9ff]",
    ghost: "bg-transparent text-scd-deep hover:bg-scd-chip",
    outline: "bg-white text-scd-deep border border-scd-line hover:border-scd-primary",
    danger: "bg-scd-danger text-white hover:brightness-95",
    success: "bg-scd-success text-white hover:brightness-95",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-pill px-4 py-2 text-sm font-semibold transition-all",
        "disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}

/* ----------------------------------------------------------------------- */
/* Cards & badges                                                           */
/* ----------------------------------------------------------------------- */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-white rounded-card shadow-ambient border border-scd-line/60", className)} {...props} />;
}

const badgeTones: Record<string, string> = {
  neutral: "bg-scd-chip text-scd-deep",
  primary: "bg-scd-lavender text-scd-deep",
  success: "bg-[#E2F6ED] text-[#116B47]",
  warning: "bg-[#F9EFDC] text-[#7A5310]",
  danger: "bg-[#F9E2DE] text-[#8C2B20]",
  info: "bg-[#E3ECFB] text-[#1D4E9E]",
};
export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", badgeTones[tone], className)}
      {...props}
    />
  );
}

/** Case / appointment status → labeled badge (never color-only). */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: keyof typeof badgeTones; label: string }> = {
    open: { tone: "info", label: "Open" },
    assessing: { tone: "info", label: "Assessing" },
    planning: { tone: "info", label: "Planning" },
    awaiting_approval: { tone: "warning", label: "Awaiting approval" },
    executing: { tone: "primary", label: "Executing" },
    resolving: { tone: "primary", label: "Resolving" },
    resolved: { tone: "success", label: "Resolved" },
    escalated: { tone: "danger", label: "Escalated" },
    booked: { tone: "warning", label: "Booked" },
    confirmed: { tone: "success", label: "Confirmed" },
    completed: { tone: "neutral", label: "Completed" },
    no_show: { tone: "danger", label: "No-show" },
    cancelled_by_patient: { tone: "danger", label: "Cancelled by patient" },
    cancelled_by_doctor: { tone: "danger", label: "Cancelled by clinic" },
    superseded: { tone: "neutral", label: "Superseded" },
    proposed: { tone: "warning", label: "Proposed" },
    approved: { tone: "success", label: "Approved" },
    modified: { tone: "info", label: "Modified" },
    rejected: { tone: "danger", label: "Rejected" },
    executed: { tone: "success", label: "Executed" },
    failed: { tone: "danger", label: "Failed" },
  };
  const m = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/** Score chip used in "Why?" explanations. */
export function WhyChip({ label, pts }: { label: string; pts?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-scd-chip border border-scd-line px-2 py-0.5 text-[11px] font-medium text-scd-deep">
      {label}
      {typeof pts === "number" && (
        <b className={cn("font-bold", pts >= 0 ? "text-scd-success" : "text-scd-danger")}>
          {pts >= 0 ? `+${pts}` : pts}
        </b>
      )}
    </span>
  );
}

/** 1–5 dot fit meter with accessible label. */
export function FitDots({ dots }: { dots: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`fit ${dots} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i <= dots ? "bg-scd-primary" : "bg-scd-line")} />
      ))}
    </span>
  );
}

/* ----------------------------------------------------------------------- */
/* Dialog (dependency-free)                                                 */
/* ----------------------------------------------------------------------- */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-scd-deep/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-scd-pop rounded-panel bg-white p-6 shadow-floating">
        <h3 className="text-lg font-bold text-scd-ink">{title}</h3>
        <div className="mt-3 text-sm text-scd-ink/90">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Small helpers                                                            */
/* ----------------------------------------------------------------------- */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-scd-muted">{children}</h2>
      {right}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-card border border-dashed border-scd-line bg-scd-bg/60 p-6 text-center text-sm text-scd-muted">{children}</div>;
}

export function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-scd-lavender border-t-scd-primary align-middle" aria-label="loading" />;
}
