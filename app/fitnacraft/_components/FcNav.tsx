import Link from "next/link";
import type { ReactNode } from "react";
import { fcBase, type FcData } from "@/lib/fitnacraft";
import { dateTime } from "@/lib/format";

const TABS = [
  { href: "", label: "Übersicht" },
  { href: "/zeitstrahl", label: "Zeitstrahl" },
  { href: "/spieler", label: "Spieler" },
  { href: "/verbindungen", label: "Verbindungen" },
  { href: "/ereignisse", label: "Ereignisse" },
  { href: "/clips", label: "Clips" },
] as const;
export type FcTab = (typeof TABS)[number]["href"];

const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "Europe/Berlin" });

/** Kopf jeder FitnaCraft-Seite: Titel, Hinweis auf die Datenquelle und die Reiter */
export function FcHead({ k, d, tab, eyebrow, title, children }: { k: string; d: FcData; tab: FcTab; eyebrow?: string; title: string; children?: ReactNode }) {
  const base = fcBase(k);
  return (
    <section className="block page-head" data-tone="ender">
      <div className="wrap">
        <p className="eyebrow">{eyebrow ?? `FitnaCraft-Rückblick · ${dayFmt.format(d.from)} – ${dayFmt.format(d.to)}`}</p>
        <h1 className="t-1">{title}</h1>
        {children}
        <nav aria-label="FitnaCraft-Rückblick" style={{ marginTop: 20 }}>
          <ul className="filters">
            {TABS.map((t) => (
              <li key={t.href}>
                <Link className="tag" href={`${base}${t.href}`} aria-current={t.href === tab ? "page" : undefined}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="muted fc-source">
          Einmalige Auswertung vom {dateTime(new Date(d.generatedAt).toISOString())} · nur Twitch-Daten der CraftAttack-Mitglieder, der FitnaCraft-Server selbst wurde nie abgefragt
        </p>
      </div>
    </section>
  );
}

/** Link auf die FitnaCraft-Seite eines Spielers */
export const fcPlayerHref = (k: string, id: string) => `${fcBase(k)}/spieler/${encodeURIComponent(id)}`;

const pctFmt = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
/** Veränderung gegenüber einem Vergleichswert, z. B. „+23 %“ */
export const change = (v: number, base: number | null | undefined) => (base ? pctFmt.format(v / base - 1) : "–");

/** Stunden mit einer Nachkommastelle („12,5 Std“) */
export const hours = (sec: number) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: sec >= 36_000 ? 0 : 1 }).format(sec / 3600)} Std`;
