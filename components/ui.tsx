"use client";
import { clsx } from "clsx";
import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, useEffect, useRef } from "react";
import { fmtWhenManila } from "@/lib/format";
import type { Tone } from "@/components/copy";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

/* ------------------------------------------------------------------ marks */

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span aria-hidden className="inline-flex items-center justify-center rounded-[6px] bg-accent" style={{ width: size, height: size }}>
      <span className="rounded-[2px] bg-white" style={{ width: size * 0.32, height: size * 0.32 }} />
    </span>
  );
}

/* ---------------------------------------------------------------- buttons */

type Variant = "primary" | "secondary" | "quiet" | "danger" | "success";
export function Button({
  variant = "primary",
  small = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-white hover:bg-[#1a44bd] border border-transparent",
    secondary: "bg-white text-ink border border-line hover:border-[#c8cdd8]",
    quiet: "bg-transparent text-muted hover:text-ink border border-transparent",
    danger: "bg-bad text-white hover:brightness-95 border border-transparent",
    success: "bg-ok text-white hover:brightness-95 border border-transparent",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-ctl font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none",
        small ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-[14px]",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}

export function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent align-middle" aria-label="loading" />;
}

/* ------------------------------------------------------------------ cards */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-white", className)} {...props} />;
}

/** Row with the 3px status rail — the list unit across the app. */
export function RailRow({
  tone,
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone: Tone; interactive?: boolean }) {
  const rail: Record<Tone, string> = {
    warn: "border-l-warn",
    accent: "border-l-accent",
    ok: "border-l-ok",
    bad: "border-l-bad",
    neutral: "border-l-line",
  };
  return (
    <div
      className={cn(
        "animate-rise rounded-card border border-line border-l-[3px] bg-white",
        rail[tone],
        interactive && "cursor-pointer transition-colors hover:border-[#c8cdd8] hover:border-l-[3px]",
        interactive && `hover:${rail[tone]}`,
        className
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ chips */

const chipTone: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn border-warn-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  ok: "bg-ok-soft text-ok border-ok-line",
  bad: "bg-bad-soft text-bad border-bad-line",
  neutral: "bg-paper text-muted border-line",
};
export function Chip({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold", chipTone[tone], className)}
      {...props}
    />
  );
}

/* ------------------------------------------ the signature: reschedule line */

export function RescheduleLine({ fromLabel, toUtc, doctorName }: { fromLabel?: string | null; toUtc: string; doctorName?: string }) {
  return (
    <p className="tnum text-[14px] leading-6">
      {fromLabel && <s className="text-muted decoration-line">{fromLabel}</s>}
      {fromLabel && <span className="mx-2 text-muted" aria-hidden>⟶</span>}
      <b className="font-bold text-ink">{fmtWhenManila(toUtc)}</b>
      {doctorName && <span className="text-muted"> · {doctorName}</span>}
    </p>
  );
}

/* ------------------------------------------------------------------- tabs */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  right,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (v: T) => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between border-b border-line">
      <div className="flex gap-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[14px] font-semibold",
              value === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            )}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className={cn("rounded-full px-1.5 text-[11px] font-bold", value === t.id ? "bg-accent-soft text-accent" : "bg-paper text-muted")}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn("relative w-full animate-pop rounded-card border border-line bg-white p-5 shadow-[0_20px_50px_rgba(16,24,40,0.18)] outline-none", wide ? "max-w-xl" : "max-w-md")}
      >
        <h3 className="text-[16px] font-bold text-ink">{title}</h3>
        <div className="mt-3 text-[14px] leading-relaxed text-ink/90">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- misc */

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-card border border-dashed border-line bg-white/60 p-8 text-center text-[14px] text-muted">{children}</div>;
}

export function PageTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[22px] font-bold tracking-tight text-ink">{children}</h1>
      {right}
    </div>
  );
}
