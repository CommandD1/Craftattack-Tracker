import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { ConnectionGraph, type GraphEdge, type GraphNode } from "@/components/ConnectionGraph";
import { FigValue } from "@/components/FigValue";
import { Head } from "@/components/Head";
import { loadTracker } from "@/lib/data";
import { getConnections } from "@/lib/connections";
import { duration, num } from "@/lib/format";

export const metadata: Metadata = { title: "Verbindungen" };

const RANGES: { key: string; label: string; hours: number | null }[] = [
  { key: "24h", label: "24 Std", hours: 24 },
  { key: "7d", label: "7 Tage", hours: 7 * 24 },
  { key: "alle", label: "Staffel", hours: null },
];

/** Öffnet sofort mit Überschrift und Platzhaltern; die Daten werden nachgestreamt. */
export default function Page(props: PageProps<"/verbindungen">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Twitch" title="Verbindungen" tone="amethyst" />}>
      <Connections searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Connections({ searchParams }: { searchParams: PageProps<"/verbindungen">["searchParams"] }) {
  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === sp.zeit) ?? RANGES[2];
  const [{ state }, all] = await Promise.all([loadTracker(), getConnections(range.hours)]);
  // Nur erfasste Spieler als Knoten
  const edges: GraphEdge[] = all.filter((e) => state.players[e.a] && state.players[e.b]);
  const ids = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const nodes: GraphNode[] = ids.map((id) => {
    const p = state.players[id];
    return { id, name: p.name, uuid: p.uuid, online: p.online, live: Boolean(p.live) };
  });
  const name = (id: string) => state.players[id]?.name ?? id;

  const raids = edges.reduce((s, e) => s + e.raidsAB + e.raidsBA, 0);
  const chats = edges.reduce((s, e) => s + e.chats, 0);
  const top = [...edges].sort((a, b) => b.weight - a.weight || b.chatSeconds - a.chatSeconds).slice(0, 25);

  const Person = ({ id }: { id: string }) => (
    <Link href={`/spieler/${encodeURIComponent(id)}`} className="conn__person">
      <Head id={id} uuid={state.players[id]?.uuid} name={name(id)} size={22} decorative />
      <span>{name(id)}</span>
    </Link>
  );

  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Twitch</p>
          <h1 className="t-1">Verbindungen</h1>
          <p>
            Wer wen geraidet hat und wer gemeinsam im geteilten Chat war. Je mehr Raids und geteilte Chats, desto dicker die Linie und
            desto näher stehen die Köpfe zusammen.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <ul className="filters" aria-label="Zeitraum">
            {RANGES.map((r) => (
              <li key={r.key}>
                <Link className="tag" aria-current={range.key === r.key ? "true" : undefined} href={r.key === "alle" ? "/verbindungen" : `/verbindungen?zeit=${r.key}`}>
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
          <dl className="grid st-figs">
            <div className="box st-fig" data-tone="twitch">
              <dt>Raids</dt>
              <FigValue>{num(raids)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="diamond">
              <dt title="Je Paar von Spielern, die gemeinsam im geteilten Chat waren">Geteilte Chats</dt>
              <FigValue>{num(chats)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="gold">
              <dt>Verbindungen</dt>
              <FigValue>{num(edges.length)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="sky">
              <dt>Spieler im Netz</dt>
              <FigValue>{num(nodes.length)}</FigValue>
            </div>
          </dl>
        </div>
      </section>

      <section className="block" data-tone="paper">
        <div className="wrap">
          <div className="box conn__box" data-tone="white">
            <ConnectionGraph nodes={nodes} edges={edges} />
            <ul className="conn__legend muted">
              <li>
                <i style={{ background: "var(--twitch)" }} /> nur Raids
              </li>
              <li>
                <i style={{ background: "var(--diamond)" }} /> nur geteilter Chat
              </li>
              <li>
                <i style={{ background: "var(--gold)" }} /> Raids und geteilter Chat
              </li>
              <li>
                <i style={{ background: "var(--grass)" }} /> gerade im geteilten Chat
              </li>
              <li>Lila Rahmen: live · grünes Kästchen: auf dem Server · Kopf ziehen zum Verschieben, anklicken fürs Profil</li>
            </ul>
          </div>

          {top.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: 48 }}>
                <h2 className="t-2">Stärkste Verbindungen</h2>
                <p className="muted">Jeder Raid und jeder geteilte Chat zählt einen Punkt</p>
              </div>
              <div className="box" data-tone="white">
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Spieler</th>
                        <th />
                        <th className="num">Raids →</th>
                        <th className="num">← Raids</th>
                        <th className="num">Geteilte Chats</th>
                        <th className="num">Zeit im Chat</th>
                        <th className="num">Punkte</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top.map((e) => (
                        <tr key={`${e.a}|${e.b}`}>
                          <td>
                            <Person id={e.a} />
                          </td>
                          <td>
                            <Person id={e.b} />
                          </td>
                          <td className="num">{e.raidsAB ? num(e.raidsAB) : "–"}</td>
                          <td className="num">{e.raidsBA ? num(e.raidsBA) : "–"}</td>
                          <td className="num">
                            {e.now && (
                              <span className="tag" data-tone="grass" style={{ fontSize: ".75rem", padding: "1px 6px", marginRight: 6 }}>
                                jetzt
                              </span>
                            )}
                            {e.chats ? num(e.chats) : "–"}
                          </td>
                          <td className="num">{e.chatSeconds ? duration(e.chatSeconds) : "–"}</td>
                          <td className="num">
                            <b>{num(e.weight)}</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
