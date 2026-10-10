"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Server-Daten regelmäßig neu, solange der Tab sichtbar ist. */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, intervalMs]);
  return null;
}
