import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { getCoPresence } from "@/lib/analytics";
import { duration, headUrl, num } from "@/lib/format";
import { NetworkGraph } from "@/components/NetworkGraph";

export const instant = false;
export const metadata: Metadata = { title: "Netzwerk" };

const RANGES = [
  { key: "24", hours: 24, label: "24 h" },
  { key: "72", hours: 72, label: "3 Tage" },
  { key: "alle", hours: 24 * 365, label: "Staffel" },
];

export default async function Page(props: PageProps<"/netz">) {
  const sp = await props.searchParams;
  const { state } = await loadTracker();
  const range = RANGES.find((r) => r.key === sp.zeit) ?? RANGES[1];
  const { nodes, edges } = await getCoPresence(range.hours);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const top = [...edges].sort((a, b) => b.lift - a.lift || b.seconds - a.seconds).slice(0, 30);
  const longest = [...edges].sort((a, b) => b.seconds - a.seconds).slice(0, 10);
  const nowPairs = edges.filter((e) => e.now).length;

  const Person = ({ id }: { id: string }) => {
    const n = byId.get(id) ?? { id, name: state.players[id]?.name ?? id, uuid: state.players[id]?.uuid ?? "" };
    return (
      <Link className="netz__person" href={`/spieler/${encodeURIComponent(id)}`}>
        <img className="head" src={headUrl(n.uuid, 24, id)} alt="" width={24} height={24} loading="lazy" />
        <span>{n.name}</span>
      </Link>
    );
  };

  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Wer mit wem</p>
          <h1 className="t-1">Netzwerk</h1>
          <p>
            Wer ist auffällig oft gleichzeitig auf dem Server? Gerechnet nur aus der Anwesenheit: Wie viel häufiger sind zwei Spieler zusammen
            online, als es der Zufall erwarten ließe. Linienstärke = dieser Faktor, grün = gerade beide drauf.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="section-head">
            <ul className="filters" aria-label="Zeitraum">
              {RANGES.map((r) => (
                <li key={r.key}>
                  <Link className="tag" aria-current={r.key === range.key ? "true" : undefined} href={`/netz?zeit=${r.key}`}>
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="muted num">
              {num(nodes.length)} Spieler · {num(edges.length)} Verbindungen · {num(nowPairs)} gerade zusammen online
            </p>
          </div>
          <div className="netz">
            <div className="box netz__graph" data-tone="white">
              <NetworkGraph nodes={nodes} edges={edges} />
              <p className="muted netz__hint">Knoten ziehen zum Sortieren, antippen öffnet das Profil.</p>
            </div>
            <div className="stack" style={{ "--stack": "16px" } as React.CSSProperties}>
              <div className="box" data-tone="white">
                <h2 className="t-3" style={{ marginBottom: 12 }}>
                  Stärkste Verbindungen
                </h2>
                {top.length === 0 ? (
                  <p className="muted">Noch zu wenige Daten – nach ein paar Stunden wird es hier spannend.</p>
                ) : (
                  <ol className="netz__list">
                    {top.map((e) => (
                      <li key={`${e.a}|${e.b}`} data-now={e.now ? "true" : undefined}>
                        <Person id={e.a} /> <span className="muted">&amp;</span> <Person id={e.b} />
                        <span className="netz__val num">
                          {num(e.lift)}× · {duration(e.seconds)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="box" data-tone="white">
                <h2 className="t-3" style={{ marginBottom: 12 }}>
                  Meiste gemeinsame Zeit
                </h2>
                {longest.length === 0 ? (
                  <p className="muted">Noch nichts.</p>
                ) : (
                  <ol className="netz__list">
                    {longest.map((e) => (
                      <li key={`${e.a}|${e.b}`} data-now={e.now ? "true" : undefined}>
                        <Person id={e.a} /> <span className="muted">&amp;</span> <Person id={e.b} />
                        <span className="netz__val num">{duration(e.seconds)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
            „Gleichzeitig online“ heißt nicht „zusammen gespielt“. Gezeigt werden Paare mit mindestens 20 Minuten gemeinsamer Zeit, die mindestens
            1,3× häufiger zusammen online waren als zufällig zu erwarten, oder mit über sechs Stunden gemeinsamer Zeit.
          </p>
        </div>
      </section>
    </>
  );
}
