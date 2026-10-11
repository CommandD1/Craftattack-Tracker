"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** Vortag / Datumsfeld / Folgetag – das Feld springt beim Ändern direkt zur Seite des Tages. */
export function DateNav({ base, day, prev, next, min, max }: { base: string; day: string; prev: string | null; next: string | null; min?: string; max: string }) {
  const router = useRouter();
  return (
    <div className="daynav" role="group" aria-label="Tag wählen">
      {prev ? (
        <Link className="btn btn--small" data-tone="white" href={`${base}?tag=${prev}`} aria-label="Vortag">
          ‹
        </Link>
      ) : (
        <span className="btn btn--small daynav__off" aria-hidden="true">
          ‹
        </span>
      )}
      <input
        className="daynav__input"
        type="date"
        value={day}
        min={min}
        max={max}
        aria-label="Tag"
        onChange={(e) => {
          if (e.target.value) router.push(`${base}?tag=${e.target.value}`);
        }}
      />
      {next ? (
        <Link className="btn btn--small" data-tone="white" href={`${base}?tag=${next}`} aria-label="Folgetag">
          ›
        </Link>
      ) : (
        <span className="btn btn--small daynav__off" aria-hidden="true">
          ›
        </span>
      )}
    </div>
  );
}
