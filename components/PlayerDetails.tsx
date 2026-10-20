import Link from "next/link";
import type { PlayerDetail } from "@/lib/types";
import { ago, dateTime, num } from "@/lib/format";
import { EXTRA_STATS, EXTRA_STAT_KEYS, FORMATTERS, STAT_GROUPS, TOP_LABELS } from "@/lib/playerStats";
import { Icon } from "@/components/Icons";

const GROUP_ICON: Record<string, keyof typeof Icon> = {
  abbau: "pickaxe",
  kampf: "sword",
  bewegung: "boots",
  items: "gift",
  tiere: "heart",
  afk: "clock",
};
const GROUP_TONE: Record<string, string> = {
  abbau: "gold",
  kampf: "redstone",
  bewegung: "pink",
  items: "sky",
  tiere: "grass",
  afk: "paper",
};

/** Zusatzwerte aus /api/player/<id> im Profil: nach Rubrik gruppiert, jede Zeile öffnet den Graphen. */
export function PlayerDetails({ id, detail, name, now }: { id: string; detail: PlayerDetail | null; name: string; now: number }) {
  if (!detail) return null;
  const graphHref = (metric: string) => `/statistik?metric=${metric}&spieler=${encodeURIComponent(id)}&zeit=alle#graph`;
  const groups = STAT_GROUPS.map((g) => ({
    ...g,
    keys: EXTRA_STAT_KEYS.filter((k) => EXTRA_STATS[k].group === g.key && typeof detail.stats[k] === "number"),
  })).filter((g) => g.keys.length > 0);
  const tops = Object.entries(detail.tops).filter(([, list]) => list.length > 0);
  if (groups.length === 0 && tops.length === 0) return null;

  return (
    <section className="block" data-tone="paper">
      <div className="wrap">
        <div className="section-head">
          <h2 className="t-2">Weitere Statistiken</h2>
          <span className="muted pdetail__stamp" title={dateTime(detail.fetchedAt)}>
            Stand {ago(detail.fetchedAt, now)}
          </span>
        </div>

        {groups.length > 0 && (
          <div className="pdetail__grid">
            {groups.map((g) => {
              const IconCmp = Icon[GROUP_ICON[g.key] ?? "bolt"];
              return (
                <div key={g.key} className="box pdetail__card" data-tone="white">
                  <p className="pdetail__head" data-tone={GROUP_TONE[g.key] ?? "paper"}>
                    <IconCmp width={16} height={16} aria-hidden="true" />
                    <span>{g.label}</span>
                  </p>
                  <dl className="pdetail__rows">
                    {g.keys.map((k) => {
                      const meta = EXTRA_STATS[k];
                      const rank = detail.ranks[k];
                      return (
                        <div key={k} className="pdetail__row">
                          <dt>
                            <Link href={graphHref(meta.metric)} title={`${meta.label} von ${name} im Graphen öffnen`}>
                              {meta.label}
                            </Link>
                          </dt>
                          <dd className="num">{FORMATTERS[meta.format](detail.stats[k])}</dd>
                          <dd className="pdetail__rank">
                            {rank && (
                              <span className="tag" data-tone={rank.rank <= 3 ? "gold" : "ink"} title={`Platz ${rank.rank} von ${rank.of}`}>
                                #{rank.rank}
                              </span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              );
            })}
          </div>
        )}

        {tops.length > 0 && (
          <>
            <h3 className="t-3 pdetail__subhead">Top-Listen</h3>
            <div className="pdetail__tops">
              {tops.map(([key, list]) => {
                const max = Math.max(1, ...list.map((e) => e.count));
                return (
                  <div key={key} className="box pdetail__card" data-tone="white">
                    <p className="pdetail__head" data-tone="paper">
                      <span>{TOP_LABELS[key] ?? key}</span>
                    </p>
                    <ol className="ptop">
                      {list.map((entry) => (
                        <li key={entry.key} className="ptop__row">
                          <span className="ptop__name">{entry.name}</span>
                          <span className="ptop__count num">{num(entry.count)}</span>
                          <span className="ptop__bar" aria-hidden="true">
                            <span style={{ width: `${(entry.count / max) * 100}%` }} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="muted" style={{ marginTop: 16, fontSize: ".875rem" }}>
          Aus der Einzelstatistik der API. Solange {name} online ist, kommen die Werte jede Minute neu, sonst höchstens alle 15 Minuten.
          #-Zahlen sind der Rang unter allen Teilnehmenden, Gold markiert die Top 3. Ein Klick auf eine Kennzahl öffnet ihren Verlauf.
          {detail.firstJoin && <> Erster Join: {dateTime(detail.firstJoin)}.</>}
        </p>
      </div>
    </section>
  );
}
