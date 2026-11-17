import Link from "next/link";
import type { Metadata } from "next";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";

export const metadata: Metadata = { title: "Neuigkeiten" };

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** TT.MM. → sortierbare Zahl MMTT */
const order = (e: ChangelogEntry) => {
  const [d, m] = e.date.split(".").map(Number);
  return m * 100 + d;
};

/** Einträge nach Monat gruppiert, neueste zuerst (auch wenn die Liste einmal nicht sortiert ist) */
function byMonth(list: ChangelogEntry[]) {
  const out: { month: string; items: ChangelogEntry[] }[] = [];
  for (const e of [...list].sort((a, b) => order(b) - order(a))) {
    const month = MONTHS[Number(e.date.split(".")[1]) - 1] ?? "";
    if (out.at(-1)?.month !== month) out.push({ month, items: [] });
    out.at(-1)!.items.push(e);
  }
  return out;
}

/** Neue Auswertungen und Ansichten der Seite, jeweils mit Link dorthin */
export default function News() {
  return (
    <>
      <section className="block page-head" data-tone="diamond">
        <div className="wrap">
          <p className="eyebrow">Was ist neu?</p>
          <h1 className="t-1">Neuigkeiten</h1>
          <p>Neue Auswertungen und Ansichten auf dieser Seite, die neuesten zuerst. Ein Klick öffnet die Stelle, um die es geht.</p>
        </div>
      </section>
      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          {byMonth(CHANGELOG).map((g) => (
            <section className="news-month" key={g.month} aria-labelledby={`m-${g.month}`}>
              <h2 className="t-2 news-month__h" id={`m-${g.month}`}>
                {g.month}
              </h2>
              <ol className="news-grid">
                {g.items.map((e) => (
                  <li key={e.date + e.title}>
                    <Link className="box news-card" data-tone="white" href={e.href}>
                      <span className="news-card__date num">{e.date}</span>
                      <span className="news-card__title">{e.title}</span>
                      <p className="news-card__text">{e.text}</p>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
