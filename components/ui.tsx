"use client";
import { clsx } from "clsx";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { fmtWhenManila } from "@/lib/format";
import type { Tone } from "@/components/copy";
import { createPortal } from "react-dom";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

/* ------------------------------------------------------------------ marks */

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-[6px] bg-accent-rail shadow-cut"
      style={{ width: size, height: size }}
    >
      <span
        className="rounded-[2px] bg-white"
        style={{ width: size * 0.32, height: size * 0.32 }}
      />
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
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
}) {
  // The Atlas signature: a hard 2px ink "cut" under anything pressable,
  // which compresses flat on :active. Quiet buttons opt out.
  const cut =
    "shadow-cut active:translate-y-[1px] active:shadow-none transition-[background-color,box-shadow,transform] duration-fast ease-snappy";
  const styles: Record<Variant, string> = {
    primary: `bg-accent text-white border border-accent-press hover:bg-accent-press ${cut}`,
    secondary: `bg-white text-ink border border-strong hover:bg-surface-alt ${cut}`,
    quiet:
      "bg-transparent text-muted hover:text-ink border border-transparent transition-colors",
    danger: `bg-bad text-white border border-transparent hover:brightness-95 ${cut}`,
    success: `bg-ok text-white border border-transparent hover:brightness-95 ${cut}`,
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-ctl font-semibold disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none",
        small ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-[14px]",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent align-middle"
      aria-label="loading"
    />
  );
}

/* ------------------------------------------------------------------ cards */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-line bg-white", className)}
      {...props}
    />
  );
}

/** Row with the 3px status rail — the list unit across the app. */
export function RailRow({
  tone,
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone: Tone; interactive?: boolean }) {
  // Rails carry the raw Atlas hues (graphical contrast is enough there);
  // text inside rows uses the darker AA grades from the theme.
  const rail: Record<Tone, string> = {
    warn: "border-l-warn-rail",
    accent: "border-l-accent-rail",
    ok: "border-l-ok-rail",
    bad: "border-l-bad-rail",
    neutral: "border-l-line",
  };
  return (
    <div
      className={cn(
        "animate-rise rounded-card border border-line border-l-[3px] bg-white",
        rail[tone],
        interactive &&
          "cursor-pointer transition-colors duration-fast ease-snappy hover:border-strong hover:border-l-[3px]",
        interactive && `hover:${rail[tone]}`,
        className,
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
  neutral: "bg-surface-alt text-muted border-line",
};
export function Chip({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold",
        chipTone[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------ the signature: reschedule line */

export function RescheduleLine({
  fromLabel,
  toUtc,
  doctorName,
}: {
  fromLabel?: string | null;
  toUtc: string;
  doctorName?: string;
}) {
  return (
    <p className="tnum text-[14px] leading-6">
      {fromLabel && <s className="text-muted decoration-line">{fromLabel}</s>}
      {fromLabel && (
        <span className="mx-2 text-muted" aria-hidden>
          ⟶
        </span>
      )}
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
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[14px] font-semibold transition-colors duration-fast",
              value === t.id
                ? "border-accent-rail text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-bold",
                  value === t.id
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-alt text-muted",
                )}
              >
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
  const onCloseRef = useRef(onClose);

  // Always retain the latest callback without rerunning the modal-open effect.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] isolate flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 cursor-default bg-ink/40"
        onClick={() => onCloseRef.current()}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative z-10 max-h-[calc(100vh-2rem)] w-full overflow-y-auto",
          "animate-pop rounded-card border border-line bg-white p-5",
          "shadow-soft outline-none",
          wide ? "max-w-xl" : "max-w-md",
        )}
      >
        <h3 className="font-display text-[16px] font-bold text-ink">{title}</h3>

        <div className="mt-3 text-[14px] leading-relaxed text-ink/90">
          {children}
        </div>

        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------- misc */

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-white/60 p-8 text-center text-[14px] text-muted">
      {children}
    </div>
  );
}

export function PageTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-[22px] font-bold tracking-tight text-ink">
        {children}
      </h1>
      {right}
    </div>
  );
}
