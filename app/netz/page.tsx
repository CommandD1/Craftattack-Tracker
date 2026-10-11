import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { detectGroups, getCoPresence, type PresenceEdge } from "@/lib/analytics";
import { CLANS, CLAN_COLORS, CLAN_OF } from "@/lib/clans";
import { duration, headUrl, num } from "@/lib/format";
import { NetworkGraph, type NodeStyle } from "@/components/NetworkGraph";

export const instant = false;
export const metadata: Metadata = { title: "Netzwerk" };

const RANGES = [
  { key: "24", hours: 24, label: "24 h" },
  { key: "72", hours: 72, label: "3 Tage" },
  { key: "alle", hours: 24 * 365, label: "Staffel" },
];
const GROUP_COLORS = ["#8ccdff", "#f0b6e4", "#4be3d6", "#ff9a2e", "#c88ae6", "#6fdc5a", "#ffd23f", "#ff6452"];

export default async function Page(props: PageProps<"/netz">) {
  const sp = await props.searchParams;
  const { state } = await loadTracker();
  const range = RANGES.find((r) => r.key === sp.zeit) ?? RANGES[1];
  const { nodes, edges } = await getCoPresence(range.hours);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const player = (id: string) => byId.get(id) ?? { id, name: state.players[id]?.name ?? id, uuid: state.players[id]?.uuid ?? "", seconds: 0 };
  const onlineIds = Object.values(state.players)
    .filter((p) => p.online)
    .map((p) => p.id);
  const online = new Set(onlineIds);

  // Automatische Gruppen aus dem Netz; feste Clans haben Vorrang bei der Farbe
  const groups = detectGroups(nodes, edges);
  const styles: Record<string, NodeStyle> = {};
  groups.forEach((g, i) => {
    for (const id of g) styles[id] = { color: GROUP_COLORS[i % GROUP_COLORS.length], label: `Gruppe ${i + 1}` };
  });
  for (const c of CLANS) for (const m of c.members) styles[m] = { color: CLAN_COLORS[c.tone] ?? "#ffd23f", label: c.name };

  const top = [...edges].sort((a, b) => b.lift - a.lift || b.seconds - a.seconds).slice(0, 20);
  const longest = [...edges].sort((a, b) => b.seconds - a.seconds).slice(0, 10);
  const nowPairs = edges.filter((e) => e.now).length;
  const edgeMap = new Map<string, PresenceEdge>();
  for (const e of edges) {
    edgeMap.set(`${e.a}|${e.b}`, e);
    edgeMap.set(`${e.b}|${e.a}`, e);
  }

  const Person = ({ id }: { id: string }) => {
    const n = player(id);
    return (
      <Link className="netz__person" href={`/spieler/${encodeURIComponent(id)}`} data-online={online.has(id) ? "true" : undefined}>
        <img className="head" src={headUrl(n.uuid, 24, id)} alt="" width={24} height={24} loading="lazy" />
        <span>{n.name}</span>
      </Link>
    );
  };

  /** Zusammenhalt einer Gruppe: Ø Faktor und gemeinsame Zeit über alle Paare innerhalb */
  const cohesion = (members: string[]) => {
    let pairs = 0;
    let lift = 0;
    let seconds = 0;
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++) {
        const e = edgeMap.get(`${members[i]}|${members[j]}`);
        if (!e) continue;
        pairs++;
        lift += e.lift;
        seconds += e.seconds;
      }
    return { pairs, lift: pairs ? lift / pairs : 0, seconds };
  };

  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Wer mit wem</p>
          <h1 className="t-1">Netzwerk</h1>
          <p>
            Wer ist auffällig oft gleichzeitig auf dem Server? Gerechnet nur aus der Anwesenheit: Wie viel häufiger sind zwei Spieler zusammen
            online, als der Zufall erwarten ließe. Der Ring um den Kopf zeigt Clan oder erkannte Gruppe, der grüne Punkt heißt gerade online.
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
              {num(nodes.length)} Spieler · {num(edges.length)} Verbindungen · {num(nowPairs)} Paare gerade zusammen online
            </p>
          </div>

          <div className="box netz__graph" data-tone="white">
            <NetworkGraph nodes={nodes} edges={edges} styles={styles} onlineIds={onlineIds} />
            <ul className="legend netz__legend">
              {CLANS.filter((c) => c.members.some((m) => byId.has(m))).map((c) => (
                <li key={c.key}>
                  <i style={{ background: CLAN_COLORS[c.tone] }} /> {c.name}
                </li>
              ))}
              {groups.slice(0, 8).map((g, i) => (
                <li key={i}>
                  <i style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }} /> Gruppe {i + 1} ({g.length})
                </li>
              ))}
              <li>
                <i style={{ background: "var(--grass)" }} /> Linie grün: gerade beide online
              </li>
            </ul>
            <p className="muted netz__hint">Mit der Maus über einen Kopf fahren zeigt die engsten Partner. Köpfe lassen sich ziehen, ein Klick öffnet das Profil.</p>
          </div>
        </div>
      </section>

      <section className="block" data-tone="paper" aria-labelledby="clans-h" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <h2 className="t-2" id="clans-h">
              Clans
            </h2>
            <p className="muted">Feste Gruppen der Staffel. Wer online ist, hat einen grünen Punkt.</p>
          </div>
          <div className="grid" style={{ "--min": "320px" } as React.CSSProperties}>
            {CLANS.map((c) => {
              const members = c.members.map((m) => m.toLowerCase());
              const coh = cohesion(members);
              const onlineN = members.filter((m) => online.has(m)).length;
              return (
                <section className="box clan" data-tone={c.tone} key={c.key}>
                  <header className="clan__head">
                    <h3 className="t-3">{c.name}</h3>
                    <span className="tag" data-tone="ink">
                      {num(onlineN)}/{num(members.length)} online
                    </span>
                  </header>
                  <ul className="clan__members">
                    {members.map((m) => (
                      <li key={m}>
                        <Person id={m} />
                      </li>
                    ))}
                  </ul>
                  <dl className="clan__stats">
                    <dt>Zusammenhalt</dt>
                    <dd className="num">{coh.pairs ? `${num(coh.lift)}× häufiger zusammen als zufällig` : "noch keine Daten"}</dd>
                    <dt>Gemeinsame Zeit</dt>
                    <dd className="num">{coh.pairs ? `${duration(coh.seconds)} über ${num(coh.pairs)} Paare` : "–"}</dd>
                  </dl>
                </section>
              );
            })}
            {CLANS.length === 1 && CLANS[0].members.length <= 1 && (
              <p className="muted">Clans werden in der Datei lib/clans.ts gepflegt. Bisher ist nur GHG angelegt, die Mitglieder fehlen noch.</p>
            )}
          </div>
        </div>
      </section>

      <section className="block" data-tone="paper" aria-labelledby="groups-h" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <h2 className="t-2" id="groups-h">
              Erkannte Gruppen
            </h2>
            <p className="muted">Automatisch aus den gemeinsamen Online-Zeiten gefunden. Sortiert nach Größe.</p>
          </div>
          {groups.length === 0 ? (
            <p className="st-online__empty">Noch zu wenige Daten für Gruppen.</p>
          ) : (
            <div className="grid" style={{ "--min": "280px", "--gap": "16px" } as React.CSSProperties}>
              {groups.slice(0, 12).map((g, i) => {
                const coh = cohesion(g);
                const sortedMembers = [...g].sort((a, b) => player(b).seconds - player(a).seconds);
                return (
                  <section className="box clan clan--auto" data-tone="white" key={i} style={{ "--ring": GROUP_COLORS[i % GROUP_COLORS.length] } as React.CSSProperties}>
                    <header className="clan__head">
                      <h3 className="t-3">
                        <i className="clan__swatch" /> Gruppe {i + 1}
                      </h3>
                      <span className="muted num">{num(g.length)} Spieler</span>
                    </header>
                    <ul className="clan__members">
                      {sortedMembers.map((m) => (
                        <li key={m}>
                          <Person id={m} />
                          {CLAN_OF[m] && <span className="tag">{CLAN_OF[m].name}</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="muted num" style={{ fontSize: ".875rem" }}>
                      {num(coh.lift)}× häufiger zusammen als zufällig · {duration(coh.seconds)} gemeinsam
                    </p>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="block" data-tone="paper" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="grid" style={{ "--min": "320px" } as React.CSSProperties}>
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
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
            „Gleichzeitig online“ heißt nicht „zusammen gespielt“. Gezeigt werden Paare mit mindestens 20 Minuten gemeinsamer Zeit, die mindestens
            1,3× häufiger zusammen online waren als zufällig zu erwarten, oder mit über sechs Stunden gemeinsamer Zeit.
          </p>
        </div>
      </section>
    </>
  );
}
