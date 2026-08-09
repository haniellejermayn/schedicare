"use client";
import { clsx } from "clsx";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { fmtWhenManila } from "@/lib/format";
import type { Tone } from "@/components/copy";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

/* ================================================================== brand */

/**
 * Concept B, "proposed → approved": a check whose approach stroke is dotted and
 * whose exit is solid. The agent proposes; the human approves. The dotted
 * lead-in is the whole idea — a plain check in a rounded square is the most
 * common mark in software, and the dashes are what stop this being that.
 *
 * The mark is size-aware. Below ~28px the dashes stop resolving and read as a
 * rendering fault, so small sizes fall back to a continuous lead-in at reduced
 * opacity: same two-part gesture, no visual noise.
 *
 * To switch concepts, change LOGO_CONCEPT — every surface, the favicon and the
 * reversed slide lockup follow from here.
 */
const LOGO_CONCEPT: "approved" | "shift" | "recovery" = "approved";

/** Below this the dotted lead-in is drawn solid-but-faded instead. */
const DASH_LEGIBILITY_FLOOR = 28;

function LogoGlyph({ fg, size }: { fg: string; size: number }) {
  if (LOGO_CONCEPT === "approved") {
    const dashed = size >= DASH_LEGIBILITY_FLOOR;
    return (
      <>
        <path
          d="M7.4 14.9 L13.3 21.1"
          stroke={fg}
          strokeWidth="3.1"
          strokeLinecap="round"
          fill="none"
          opacity={dashed ? 0.55 : 0.4}
          strokeDasharray={dashed ? "0.1 4.6" : undefined}
        />
        <path
          d="M13.3 21.1 L24.7 9.9"
          stroke={fg}
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </>
    );
  }
  if (LOGO_CONCEPT === "recovery") {
    return (
      <>
        <path
          d="M23.4 13.4a8 8 0 1 0 .6 3.1"
          stroke={fg}
          strokeWidth="2.7"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M17.6 13.1 L23.8 13.5 L24.2 7.4"
          stroke={fg}
          strokeWidth="2.7"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="16.5" r="2.5" fill={fg} />
      </>
    );
  }
  return (
    <>
      <rect
        x="6.5"
        y="18.5"
        width="12"
        height="5"
        rx="2.5"
        fill={fg}
        opacity=".42"
      />
      <rect x="13.5" y="8.5" width="12" height="5" rx="2.5" fill={fg} />
    </>
  );
}

export function Logo({
  size = 24,
  reversed = false,
  className,
}: {
  size?: number;
  /** White tile with dark glyph — for dark headers and slide decks. */
  reversed?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      aria-hidden
      focusable="false"
    >
      <rect
        width="32"
        height="32"
        rx="9"
        fill={reversed ? "#FFFFFF" : "var(--accent)"}
      />
      <LogoGlyph fg={reversed ? "var(--ink)" : "#FFFFFF"} size={size} />
    </svg>
  );
}

export function Wordmark({
  size = 24,
  reversed = false,
  className,
}: {
  size?: number;
  reversed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logo size={size} reversed={reversed} />
      <span
        className={cn(
          "font-bold tracking-[-0.025em]",
          reversed ? "text-white" : "text-ink",
        )}
        style={{ fontSize: size * 0.66 }}
      >
        SchediCare
      </span>
    </span>
  );
}

/* ================================================================ buttons */

type Variant = "primary" | "secondary" | "quiet" | "danger" | "success";

export function Button({
  variant = "primary",
  small = false,
  block = false,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
  /** Full-width — the default shape for primary actions on the phone view. */
  block?: boolean;
  loading?: boolean;
}) {
  const styles: Record<Variant, string> = {
    primary:
      "bg-accent text-white border-accent-press hover:bg-accent-press shadow-xs",
    secondary:
      "bg-surface text-ink border-line-strong hover:bg-surface-alt shadow-xs",
    quiet:
      "bg-transparent text-muted border-transparent hover:bg-surface-alt hover:text-ink",
    danger: "bg-bad text-white border-transparent hover:brightness-95 shadow-xs",
    success: "bg-ok text-white border-transparent hover:brightness-95 shadow-xs",
  };
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-ctl border font-semibold",
        "transition-colors duration-fast ease-snappy",
        "disabled:pointer-events-none disabled:opacity-45",
        // 40px tall at the default size keeps every control above the 44px
        // touch target once its 2px focus ring is counted, which matters on
        // the patient view.
        small ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-base",
        block && "w-full",
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

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-ctl border border-line bg-surface text-muted",
        "transition-colors duration-fast ease-snappy hover:border-line-strong hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full",
        "border-2 border-current/25 border-t-current align-middle",
        className,
      )}
    />
  );
}

/* ================================================================== cards */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-line bg-surface", className)}
      {...props}
    />
  );
}

/** Card with a heading row and optional trailing control. */
export function Panel({
  title,
  subtitle,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-md font-bold text-ink">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </Card>
  );
}

const railTone: Record<Tone, string> = {
  warn: "border-l-warn-rail",
  accent: "border-l-accent-rail",
  ok: "border-l-ok-rail",
  bad: "border-l-bad-rail",
  neutral: "border-l-line-strong",
};

/** The list unit across the app: a card with a 3px status rail. */
export function RailRow({
  tone,
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone: Tone; interactive?: boolean }) {
  return (
    <div
      className={cn(
        "animate-rise rounded-card border border-line border-l-[3px] bg-surface",
        railTone[tone],
        interactive &&
          "cursor-pointer transition-[border-color,box-shadow] duration-fast ease-snappy hover:border-line-strong hover:shadow-md",
        // Re-apply the rail after the hover border rule so it is not overridden.
        interactive && `hover:${railTone[tone]}`,
        className,
      )}
      {...props}
    />
  );
}

/* ================================================================== chips */

const chipTone: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn border-warn-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  ok: "bg-ok-soft text-ok border-ok-line",
  bad: "bg-bad-soft text-bad border-bad-line",
  neutral: "bg-surface-alt text-muted border-line",
};

export function Chip({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  const dotTone: Record<Tone, string> = {
    warn: "bg-warn-rail",
    accent: "bg-accent-rail",
    ok: "bg-ok-rail",
    bad: "bg-bad-rail",
    neutral: "bg-muted",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        chipTone[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", dotTone[tone])}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/** Attention marker for rows that are actively waiting on the user. */
export function Pulse({ tone = "bad" }: { tone?: Tone }) {
  const fill: Record<Tone, string> = {
    warn: "bg-warn-rail",
    accent: "bg-accent-rail",
    ok: "bg-ok-rail",
    bad: "bg-bad-rail",
    neutral: "bg-muted",
  };
  const ring: Record<Tone, string> = {
    warn: "border-warn-rail",
    accent: "border-accent-rail",
    ok: "border-ok-rail",
    bad: "border-bad-rail",
    neutral: "border-muted",
  };
  return (
    <span
      className={cn(
        "relative h-[7px] w-[7px] shrink-0 rounded-full",
        fill[tone],
      )}
    >
      {/* Tailwind's `ping` is exactly this expanding ring — using a custom
          `pulse` keyframe here would collide with the built-in `animate-pulse`
          that Skeleton relies on. */}
      <span
        className={cn(
          "absolute -inset-1 animate-ping rounded-full border-[1.5px] opacity-50",
          ring[tone],
        )}
        aria-hidden
      />
    </span>
  );
}

/* ================================================================ avatars */

/** Deterministic tint per name — same person, same colour, every render. */
const AVATAR_TINTS = [
  "bg-tech text-white",
  "bg-accent text-white",
  "bg-ok text-white",
  "bg-warn text-white",
  "bg-bad text-white",
] as const;

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
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
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

/* ============================================================ segment bar */

export type Segment = {
  label: string;
  value: number;
  tone: Tone;
  /** Rendered as a hollow/hatched remainder rather than a filled segment. */
  remainder?: boolean;
};

/**
 * One horizontal bar showing how a whole divides, with the counts inline
 * beneath it.
 *
 * This replaced a row of five identical metric tiles on both the front desk and
 * the case page. Tiles state five unrelated numbers; a bar states one thing —
 * how much of the day is settled, or how far a recovery has got — which is the
 * actual question being asked on each of those screens. It also means the two
 * screens share a visual idea instead of repeating a layout.
 *
 * Segments use `rail` grades (graphical, 3:1 is the bar); labels use the AA
 * text grades. Counts are never colour-only — each carries a dot and a word.
 */
export function SegmentBar({
  caption,
  total,
  totalLabel,
  segments,
  right,
}: {
  caption: string;
  total: number;
  totalLabel: string;
  segments: Segment[];
  right?: ReactNode;
}) {
  const fill: Record<Tone, string> = {
    warn: "bg-warn-rail",
    accent: "bg-accent-rail",
    ok: "bg-ok-rail",
    bad: "bg-bad-rail",
    neutral: "bg-surface-strong",
  };
  const text: Record<Tone, string> = {
    warn: "text-warn",
    accent: "text-accent",
    ok: "text-ok",
    bad: "text-bad",
    neutral: "text-muted",
  };

  const counted = segments.reduce((n, s) => n + s.value, 0);
  const denominator = Math.max(total, counted, 1);
  const shown = segments.filter((s) => s.value > 0);

  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-md font-bold text-ink">{caption}</h2>
        <span className="tnum text-sm text-muted">
          <b className="font-semibold text-ink-soft">{total}</b> {totalLabel}
        </span>
        {right && <span className="ml-auto">{right}</span>}
      </div>

      <div
        className="mt-3 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-surface-alt"
        role="img"
        aria-label={shown
          .map((s) => `${s.value} ${s.label}`)
          .join(", ")}
      >
        {shown.map((s) => (
          <span
            key={s.label}
            className={cn(
              "h-full first:rounded-l-full last:rounded-r-full",
              s.remainder ? "bg-surface-strong" : fill[s.tone],
            )}
            style={{ width: `${(s.value / denominator) * 100}%` }}
          />
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-baseline gap-1.5">
            <span
              aria-hidden
              className={cn(
                "translate-y-[-1px] h-1.5 w-1.5 shrink-0 self-center rounded-full",
                s.remainder ? "bg-surface-strong" : fill[s.tone],
              )}
            />
            <b
              className={cn(
                "tnum text-base font-bold",
                s.value === 0 ? "text-muted" : text[s.tone],
              )}
            >
              {s.value}
            </b>
            <span className="text-sm text-muted">{s.label}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ============================================================== stat tile */

export function StatTile({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  const valueTone: Record<Tone, string> = {
    warn: "text-warn",
    accent: "text-accent",
    ok: "text-ok",
    bad: "text-bad",
    neutral: "text-ink",
  };
  return (
    <div className="flex flex-col gap-0.5 rounded-card border border-line bg-surface px-4 py-3">
      <span className="eyebrow">{label}</span>
      <span
        className={cn("tnum text-xl font-bold leading-tight", valueTone[tone])}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

/* =========================================================== the signature */

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
    <p className="tnum text-base leading-6">
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

/* =================================================================== tabs */

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
    <div className="flex items-end justify-between gap-3 border-b border-line">
      <div
        className="scroll-quiet -mb-px flex gap-1 overflow-x-auto"
        role="tablist"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-base font-semibold",
              "transition-colors duration-fast ease-snappy",
              value === t.id
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span
                className={cn(
                  "tnum rounded-full px-1.5 text-xs font-bold",
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

/**
 * Filter pills with counts — the front-desk queue switcher. Distinct from Tabs:
 * these carry a tone when active, because which bucket you are in is itself
 * status information.
 */
export function SegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ id: T; label: string; count?: number; tone?: Tone }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const activeTone: Record<Tone, string> = {
    warn: "bg-warn text-white border-warn",
    accent: "bg-accent text-white border-accent",
    ok: "bg-ok text-white border-ok",
    bad: "bg-bad text-white border-bad",
    neutral: "bg-ink text-white border-ink",
  };
  return (
    <div
      className={cn("scroll-quiet flex gap-2 overflow-x-auto pb-0.5", className)}
      role="tablist"
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-semibold",
              "transition-colors duration-fast ease-snappy",
              active
                ? activeTone[o.tone ?? "neutral"]
                : "border-line bg-surface text-ink-soft hover:border-line-strong",
            )}
          >
            {o.label}
            {typeof o.count === "number" && (
              <span className={cn("tnum font-mono text-xs", active ? "opacity-85" : "opacity-70")}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* =========================================================== choice cards */

/**
 * A selectable option tile. The same pattern appears in the follow-up modal,
 * the decision card's alternate times and the patient booking flow, and each
 * had grown its own slightly different selected state.
 */
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
          ? "border-accent bg-accent-soft"
          : "border-line bg-surface hover:border-line-strong",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-base font-semibold",
            selected ? "text-accent" : "text-ink",
          )}
        >
          {title}
        </span>
        {detail && (
          <span className="mt-0.5 block text-sm text-muted">{detail}</span>
        )}
      </span>
      {right}
    </button>
  );
}

/** Collapsible section with a persistent header — used for the case log. */
export function Disclosure({
  open,
  onToggle,
  label,
  count,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-base font-bold text-ink"
      >
        {label}
        {typeof count === "number" && (
          <span className="tnum ml-auto font-mono text-xs font-normal text-muted">
            {count}
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={cn(
            "shrink-0 text-muted transition-transform duration-fast ease-snappy",
            open && "rotate-90",
            typeof count !== "number" && "ml-auto",
          )}
          aria-hidden
        >
          <path
            d="M4 2l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && <div className="border-t border-line px-4 py-3">{children}</div>}
    </Card>
  );
}

/* ================================================================= fields */

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink-soft">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs font-medium text-bad">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-ctl border border-line bg-surface px-3 py-2.5 text-base text-ink " +
  "outline-none transition-colors duration-fast ease-snappy " +
  "placeholder:text-muted focus:border-accent disabled:bg-surface-alt disabled:text-muted";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(controlBase, "cursor-pointer appearance-none bg-none pr-8", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' stroke='%235A6B80' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 11px center",
      }}
      {...props}
    />
  );
}

export function SearchInput({
  value,
  onValueChange,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <svg
        className="pointer-events-none absolute left-3 text-muted"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className={cn(controlBase, "py-2.5 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden")}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onValueChange("")}
          className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-alt hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ================================================================== modal */

/** Elements that can hold focus inside a dialog. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
  /** Slides up from the bottom edge on phones. Right for patient-facing flows. */
  sheetOnMobile = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  sheetOnMobile?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus trap. PROJECT_STATUS lists dialog focus traps as a known gap; it is
  // cheap to close, and a keyboard user tabbing out of an approval dialog onto
  // the page behind it is exactly the kind of thing a panel notices.
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown, true);

    // Focus the panel itself, not the first control: announcing the title
    // before the first field is the accessible order.
    const raf = requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open, onKeyDown]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9999] isolate flex justify-center p-4",
        sheetOnMobile ? "items-end sm:items-center sm:p-4" : "items-center",
      )}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-ink/45"
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "scroll-quiet relative z-10 flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-y-auto",
          "border border-line bg-surface shadow-lg outline-none",
          sheetOnMobile
            ? "animate-slide-up rounded-modal sm:animate-pop"
            : "animate-pop rounded-modal",
          wide ? "max-w-xl" : "max-w-md",
        )}
      >
        <div className="flex flex-col gap-1 px-5 pt-5">
          <h2 id={titleId} className="text-lg font-bold text-ink">
            {title}
          </h2>
          {description && (
            <p id={descId} className="text-sm text-muted">
              {description}
            </p>
          )}
        </div>
        <div className="px-5 py-4 text-base text-ink-soft">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* =================================================================== misc */

export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
      <p className="max-w-[42ch] text-base text-muted">{children}</p>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={cn("block animate-pulse rounded-ctl bg-surface-alt", className)}
      aria-hidden
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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink">{children}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** Mono section label. Matches the `.eyebrow` class for non-Tailwind call sites. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("eyebrow", className)}>{children}</span>;
}
