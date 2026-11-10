import Link from "next/link";
import type { Metadata } from "next";
import { CHANGES, KIND_LABEL, KIND_TONE, type Change, type ChangeKind } from "@/lib/changelog";
import { ChangelogSince, NewForYou } from "@/components/ChangelogNew";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Was sich am CraftAttack 14 Tracker geändert hat, seit dem ersten Tag der Staffel.",
};

const REPO = "https://github.com/CommandD1/Craftattack-Tracker/pull/";
const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

function byDay(list: Change[]): [string, Change[]][] {
  const out = new Map<string, Change[]>();
  for (const c of [...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const k = dayKey.format(Date.parse(c.at));
    out.set(k, [...(out.get(k) ?? []), c]);
  }
  return [...out];
}

export default function Changelog() {
  const days = byDay(CHANGES);
  const counts = CHANGES.reduce((m, c) => m.set(c.kind, (m.get(c.kind) ?? 0) + 1), new Map<ChangeKind, number>());
  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Was sich an der Seite ändert</p>
          <h1 className="t-1">Changelog</h1>
          <p>
            Alle Änderungen am Tracker für Besucher, neueste zuerst: {CHANGES.length} Einträge seit dem Start am 10. Oktober. Was seit deinem letzten
            Besuch dazugekommen ist, ist markiert.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap cl">
          <ChangelogSince at={CHANGES.map((c) => Date.parse(c.at))} />
          <ul className="filters cl__legend" aria-label="Arten">
            {(Object.keys(KIND_LABEL) as ChangeKind[]).map((k) => (
              <li key={k} className="tag" data-tone="white">
                <span className="swatch" data-tone={KIND_TONE[k]} aria-hidden="true" />
                {KIND_LABEL[k]} <span className="muted num">{counts.get(k) ?? 0}</span>
              </li>
            ))}
          </ul>
          <ol className="cl__days">
            {days.map(([k, list]) => (
              <li key={k}>
                <h2 className="feed__day">{dayFmt.format(Date.parse(list[0].at))}</h2>
                <ul className="cl__list">
                  {list.map((c, i) => (
                    <li key={`${c.at}-${i}`} className="box cl__item" data-tone="white">
                      <div className="cl__top">
                        <span className="cl__kind" data-tone={KIND_TONE[c.kind]}>
                          {KIND_LABEL[c.kind]}
                        </span>
                        <NewForYou at={Date.parse(c.at)} />
                      </div>
                      <h3 className="cl__title t-3">{c.href ? <Link href={c.href}>{c.title} →</Link> : c.title}</h3>
                      {c.text && <p className="cl__text">{c.text}</p>}
                      {c.pr && (
                        <p className="cl__pr muted">
                          {c.pr.map((n, j) => (
                            <span key={n}>
                              {j > 0 && " · "}
                              <a href={REPO + n} target="_blank" rel="noopener">
                                #{n}
                              </a>
                            </span>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="muted cl__foot">
            Ideen oder Fehler gefunden? Issues und Pull Requests sind auf{" "}
            <a href="https://github.com/CommandD1/Craftattack-Tracker" target="_blank" rel="noopener">
              GitHub
            </a>{" "}
            willkommen.
          </p>
        </div>
      </section>
    </>
  );
}
