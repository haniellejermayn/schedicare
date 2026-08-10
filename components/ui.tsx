"use client";
import { clsx } from "clsx";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useRef,
} from "react";
import Image from "next/image";
import { fmtWhenManila } from "@/lib/format";
import type { Tone } from "@/components/copy";
import { createPortal } from "react-dom";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

/* ------------------------------------------------------------------ marks */

/**
 * The clinic mark. Source art is 54×75, so `size` sets the height and the
 * width follows the aspect ratio — passing it as a square crops the hourglass.
 * `onDark` swaps to the knocked-out variant for use on a filled header.
 */
export function Logo({
  size = 22,
  onDark = false,
}: {
  size?: number;
  onDark?: boolean;
}) {
  return (
    <Image
      src={onDark ? "/logo-filled.png" : "/logo.png"}
      alt=""
      aria-hidden
      width={Math.round((size * 54) / 75)}
      height={size}
      priority
      className="inline-block select-none"
    />
  );
}

/* ---------------------------------------------------------------- buttons */

type Variant = "primary" | "secondary" | "quiet" | "danger" | "success";
export function Button({
  variant = "primary",
  small = false,
  loading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
  loading?: boolean;
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
      // A loading button stays disabled so a double-tap cannot double-submit.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-ctl font-semibold disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none",
        small ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-[14px]",
        styles[variant],
        className,
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
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
  sheetOnMobile = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** On a phone, rise from the bottom edge as a sheet instead of a centred card. */
  sheetOnMobile?: boolean;
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
      className={cn(
        "fixed inset-0 z-[9999] isolate flex items-end justify-center sm:items-center",
        sheetOnMobile ? "p-0 sm:p-4" : "p-4",
      )}
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
          "animate-pop border border-line bg-white p-5",
          "shadow-soft outline-none",
          sheetOnMobile
            ? "rounded-t-lg2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-card sm:pb-5"
            : "rounded-card",
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

export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  /** A way out of the empty state — usually the button that creates the first item. */
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-white/60 p-8 text-center text-[14px] text-muted">
      {children}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------- patient-view additions */

/** Small mono kicker. `.eyebrow` is defined in globals.css. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("eyebrow", className)}>{children}</span>;
}

const AVATAR_TINTS = [
  "bg-accent-soft text-accent",
  "bg-ok-soft text-ok",
  "bg-warn-soft text-warn",
  "bg-bad-soft text-bad",
  "bg-surface-strong text-tech",
];

export function Avatar({
  name,
  size = 32,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  // Honorifics are dropped first, or "Dr. Elena Santos" initialises to "DE".
  const initials = name
    .trim()
    .split(/\s+/)
    .filter((p) => !/^(dr|mr|mrs|ms|miss)\.?$/i.test(p))
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  // Stable tint per name, so the same person is the same colour every render.
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const tint = AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        tint,
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

/** A tappable radio-style card — the patient view picks visit types and slots with it. */
export function ChoiceCard({
  selected,
  title,
  detail,
  right,
  disabled,
  onClick,
  className,
}: {
  selected: boolean;
  title: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-left",
        "transition-colors duration-fast ease-snappy",
        "disabled:pointer-events-none disabled:opacity-45",
        selected
          ? "border-accent bg-accent-soft shadow-cut"
          : "border-line bg-white hover:border-strong",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[14px] font-semibold",
            selected ? "text-accent" : "text-ink",
          )}
        >
          {title}
        </span>
        {detail && (
          <span className="mt-0.5 block text-[13px] text-muted">{detail}</span>
        )}
      </span>
      {right}
    </button>
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full cursor-pointer appearance-none rounded-ctl border border-strong bg-white",
        "px-3 py-2 pr-8 text-[14px] text-ink outline-none",
        "transition-colors duration-fast focus:border-accent-rail",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' stroke='%2362707c' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 11px center",
      }}
      {...props}
    />
  );
}

export function PageTitle({
  children,
  subtitle,
  right,
}: {
  children: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-bold tracking-tight text-ink">
          {children}
        </h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
