/** Client-safe formatting helpers (mirror server formats without imports from core). */
export function fmtTimeManila(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
}

export function fmtWhenManila(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));
}

export function fmtDayManila(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(iso));
}

export function typeLabel(t: string): string {
  return t === "follow_up" ? "Follow-up" : t === "urgent" ? "Urgent" : "Routine";
}

export function agentLabel(actor: string): string {
  const map: Record<string, string> = {
    orchestrator: "Orchestrator",
    assessment: "Assessment",
    scheduling: "Scheduling",
    recovery: "Recovery",
    risk: "Attendance Risk",
    comms: "Communication",
    executor: "Executor",
    staff: "Staff",
    system: "System",
    sim: "Simulated patient",
    worker: "Worker",
  };
  return map[actor] ?? actor;
}

export async function jfetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}
