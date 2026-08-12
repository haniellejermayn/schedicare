"use client";

import { usePoll } from "@/lib/usePoll";
import { Chip, Logo, cn } from "@/components/ui";
import type { Tone } from "@/components/copy";

type LivePatient = {
  id: string;
  name: string;
  label: string;
  detail: string;
  tone: Tone;
  settled: boolean;
  updatedAt: string | null;
};

type LiveData = {
  patients: LivePatient[];
  settled: number;
  total: number;
  generatedAt: string;
};

const FALLBACK: LivePatient[] = ["Camille", "Miguel", "Grace"].map(
  (name) => ({
    id: name.toLowerCase(),
    name,
    label: "Connecting…",
    detail: "Waiting for the live demo",
    tone: "neutral",
    settled: false,
    updatedAt: null,
  }),
);

const cardTone: Record<Tone, string> = {
  neutral: "border-line bg-white",
  accent: "border-accent-line bg-accent-soft",
  warn: "border-warn-line bg-warn-soft",
  ok: "border-ok-line bg-ok-soft",
  bad: "border-bad-line bg-bad-soft",
};

const dotTone: Record<Tone, string> = {
  neutral: "bg-muted",
  accent: "bg-accent-rail",
  warn: "bg-warn-rail",
  ok: "bg-ok-rail",
  bad: "bg-bad-rail",
};

export default function LiveDemoPage() {
  const { data, error } = usePoll<LiveData>("/api/live/demo", 1200);
  const patients = data?.patients ?? FALLBACK;
  const settled = data?.settled ?? 0;
  const total = data?.total ?? 3;
  const complete = settled === total;

  return (
    <main className="min-h-dvh bg-paper px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-card border border-line bg-white shadow-cut">
            <Logo size={29} />
          </div>
          <div>
            <p className="eyebrow">Riverside Family Clinic</p>
            <h1 className="text-[21px] font-bold tracking-tight text-ink sm:text-[25px]">
              Live appointment recovery
            </h1>
          </div>
          <Chip tone="accent" className="ml-auto hidden sm:inline-flex">
            Read-only audience view
          </Chip>
        </header>

        <section className="mt-8 overflow-hidden rounded-[20px] border border-line bg-white shadow-soft">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-5 sm:px-7">
            <div>
              <p className="eyebrow">Recovery progress</p>
              <p className="mt-1 text-[28px] font-bold tracking-tight text-ink sm:text-[34px]">
                {complete ? "All three settled" : `${settled} of ${total} settled`}
              </p>
              <p className="mt-1 text-[14px] text-muted">
                Watch each fictional demo patient update as the clinic responds.
              </p>
            </div>
            <div className="tnum text-[12px] font-semibold text-muted" aria-live="polite">
              {error
                ? "Reconnecting…"
                : data
                  ? `Updated ${new Date(data.generatedAt).toLocaleTimeString("en-PH", {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                      timeZone: "Asia/Manila",
                    })}`
                  : "Connecting…"}
            </div>
          </div>

          <div className="h-2 bg-surface-strong" aria-hidden>
            <div
              className="h-full bg-accent-rail transition-[width] duration-base ease-snappy"
              style={{ width: `${(settled / total) * 100}%` }}
            />
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-6" aria-live="polite">
            {patients.map((patient, index) => (
              <article
                key={patient.id}
                className={cn(
                  "animate-rise rounded-[16px] border p-5 transition-colors duration-base",
                  cardTone[patient.tone],
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-[14px] font-bold text-white">
                    {patient.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="eyebrow">Patient {index + 1}</p>
                    <h2 className="truncate text-[19px] font-bold text-ink">
                      {patient.name}
                    </h2>
                  </div>
                  <span
                    className={cn("ml-auto h-3 w-3 rounded-full", dotTone[patient.tone])}
                    aria-hidden
                  />
                </div>
                <p className="mt-6 text-[18px] font-bold text-ink">
                  {patient.label}
                </p>
                <p className="mt-1 min-h-10 text-[13px] leading-relaxed text-ink-soft">
                  {patient.detail}
                </p>
                <div className="mt-5 border-t border-current/10 pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {patient.settled ? "Case settled" : "Updating live"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[12px] text-muted">
          <span>Fictional demo patients only</span>
          <span aria-hidden>·</span>
          <span>No contact details or patient actions</span>
          <span aria-hidden>·</span>
          <span>Scheduling status only</span>
        </footer>
      </div>
    </main>
  );
}

