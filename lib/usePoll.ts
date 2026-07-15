"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { jfetch } from "./format";

/** Poll a JSON endpoint on an interval; returns data + manual refresh. */
export function usePoll<T = any>(url: string | null, intervalMs = 2500): { data: T | null; refresh: () => void; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    if (!url) return;
    jfetch<T>(url)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [url]);

  useEffect(() => {
    load();
    if (!url) return;
    timer.current = setInterval(load, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [url, intervalMs, load]);

  return { data, refresh: load, error };
}

export interface FeedItem {
  id: number;
  caseId: string;
  actor: string;
  kind: string;
  title: string;
  detail: string | null;
  refs: any;
  at: string;
}

/** Server-sent live feed of case timeline entries (optionally one case). */
export function useFeed(caseId?: string | null): { items: FeedItem[]; connected: boolean; bump: number } {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    setItems([]);
    const qs = new URLSearchParams();
    if (caseId) qs.set("caseId", caseId);
    const es = new EventSource(`/api/feed?${qs.toString()}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("timeline", (ev) => {
      const batch: FeedItem[] = JSON.parse((ev as MessageEvent).data);
      if (batch.length === 0) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev, ...batch.filter((b) => !seen.has(b.id))];
        return merged.slice(-400);
      });
      setBump((b) => b + 1);
    });
    return () => es.close();
  }, [caseId]);

  return { items, connected, bump };
}
