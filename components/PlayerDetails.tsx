import type { PlayerDetail } from "@/lib/types";
import { ago, dateTime, distance, duration, hearts, num } from "@/lib/format";

/** Beschriftung und Formatierung der Zusatzwerte aus /api/player/<id>. Unbekannte Keys erscheinen mit ihrem Namen. */
const EXTRA: Record<string, { label: string; format?: (v: number) => string }> = {
  blocksPlaced: { label: "Blöcke platziert" },
  itemsCrafted: { label: "Items hergestellt" },
  itemsPickedUp: { label: "Items aufgehoben" },
  itemsDropped: { label: "Items fallen gelassen" },
  itemsEnchanted: { label: "Items verzaubert" },
  chestsOpened: { label: "Truhen geöffnet" },
  tradedWithVillagers: { label: "Handel mit Dorfbewohnern" },
  animalsKilled: { label: "Tiere getötet" },
  animalsBred: { label: "Tiere gezüchtet" },
  fishCaught: { label: "Fische gefangen" },
  raidsWon: { label: "Überfälle gewonnen" },
  bellsRung: { label: "Glocken geläutet" },
  jumps: { label: "Sprünge" },
  damageTaken: { label: "Schaden erlitten (Herzen)", format: hearts },
  distanceFallen: { label: "Gefallen", format: distance },
  sneakSeconds: { label: "Geschlichen", format: duration },
  afkSeconds: { label: "AFK laut Server", format: duration },
};

const TOPS: Record<string, string> = {
  blocksBroken: "Meistabgebaute Blöcke",
  blocksPlaced: "Meistplatzierte Blöcke",
  mobsKilled: "Meistgetötete Mobs",
  animalsKilled: "Meistgetötete Tiere",
};

const ORDER = Object.keys(EXTRA);
const position = (key: string) => {
  const i = ORDER.indexOf(key);
  return i === -1 ? ORDER.length : i;
};

export function PlayerDetails({ detail, name, now }: { detail: PlayerDetail | null; name: string; now: number }) {
  if (!detail) return null;
  const stats = Object.entries(detail.stats).sort(([a], [b]) => position(a) - position(b) || a.localeCompare(b));
  const tops = Object.entries(detail.tops).filter(([, list]) => list.length > 0);
  if (stats.length === 0 && tops.length === 0) return null;

  return (
    <section className="block" data-tone="paper">
      <div className="wrap">
        <div className="section-head">
          <h2 className="t-2">Weitere Statistiken</h2>
        </div>
        <div className="grid" style={{ "--min": "260px", "--gap": "16px" } as React.CSSProperties}>
          {stats.length > 0 && (
            <div className="box" data-tone="white">
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                Laut Server
              </p>
              <dl className="player-card__stats" style={{ borderTop: 0, paddingTop: 0 }}>
                {stats.map(([key, value]) => {
                  const meta = EXTRA[key];
                  const rank = detail.ranks[key];
                  return (
                    <div key={key} style={{ display: "contents" }}>
                      <dt title={rank ? `Platz ${rank.rank} von ${rank.of}` : undefined}>
                        {meta?.label ?? key}
                        {rank && <span className="muted"> · #{rank.rank}</span>}
                      </dt>
                      <dd className="num">{(meta?.format ?? num)(value)}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
          {tops.map(([key, list]) => (
            <div key={key} className="box" data-tone="white">
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                {TOPS[key] ?? key}
              </p>
              <dl className="player-card__stats" style={{ borderTop: 0, paddingTop: 0 }}>
                {list.map((entry) => (
                  <div key={entry.key} style={{ display: "contents" }}>
                    <dt>{entry.name}</dt>
                    <dd className="num">{num(entry.count)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
          Aus der Einzelstatistik der API für {name}, zuletzt abgefragt {ago(detail.fetchedAt, now)}. Jeder Spieler wird höchstens
          alle 15 Minuten abgefragt. Die Zahl hinter # ist der Rang unter allen Teilnehmenden.
          {detail.firstJoin && <> Erster Join auf dem Server: {dateTime(detail.firstJoin)}.</>}
        </p>
      </div>
    </section>
  );
}
