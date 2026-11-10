"use client";

import Link from "next/link";
import { useLastVisit, visitLabel } from "@/lib/visit";

/** „Neu für dich“ an einem Eintrag, der nach dem letzten Besuch live ging */
export function NewForYou({ at }: { at: number }) {
  const since = useLastVisit();
  if (since === null || at <= since) return null;
  return <span className="cl__new">Neu für dich</span>;
}

/** Zeile über dem Changelog: wie viele Änderungen seit dem letzten Besuch */
export function ChangelogSince({ at }: { at: number[] }) {
  const since = useLastVisit();
  if (since === null) return null;
  const n = at.filter((t) => t > since).length;
  return (
    <p className="feed-since" data-state={n ? "new" : "none"}>
      <span className="feed-since__dot" aria-hidden="true">
        {n || "✓"}
      </span>
      <span>
        {n === 0 ? "Keine Änderungen an der Seite" : n === 1 ? "1 Änderung an der Seite" : `${n} Änderungen an der Seite`} seit deinem letzten Besuch{" "}
        <span className="muted">({visitLabel(since)})</span>.
      </span>
    </p>
  );
}

/** Footer-Link mit Punkt, wenn es seit dem letzten Besuch Änderungen gibt */
export function ChangelogLink({ latest }: { latest: number }) {
  const since = useLastVisit();
  const fresh = since !== null && latest > since;
  return (
    <Link href="/changelog">
      Changelog
      {fresh && (
        <span className="cl-dot" title="Neu seit deinem letzten Besuch">
          <span className="sr-only"> (neu seit deinem letzten Besuch)</span>
        </span>
      )}
    </Link>
  );
}
