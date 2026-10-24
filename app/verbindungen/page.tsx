import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import type { GraphNode } from "@/components/ConnectionGraph";
import { ConnectionExplorer } from "@/components/ConnectionExplorer";
import { FigValue } from "@/components/FigValue";
import { loadTracker } from "@/lib/data";
import { getConnections } from "@/lib/connections";
import type { LinkCounts } from "@/lib/connectionWeights";
import { num } from "@/lib/format";

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
  // Nur erfasste Spieler; an den Browser gehen nur die Zählwerte, gewichtet wird dort
  const edges: LinkCounts[] = all
    .filter((e) => state.players[e.a] && state.players[e.b])
    .map(({ a, b, raidsAB, raidsBA, chats, chatSeconds, msgsAB, msgsBA, now }) => ({ a, b, raidsAB, raidsBA, chats, chatSeconds, msgsAB, msgsBA, now }));
  const ids = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const nodes: GraphNode[] = ids.map((id) => {
    const p = state.players[id];
    return { id, name: p.name, uuid: p.uuid, online: p.online, live: Boolean(p.live) };
  });

  const raids = edges.reduce((s, e) => s + e.raidsAB + e.raidsBA, 0);
  const chats = edges.reduce((s, e) => s + e.chats, 0);
  const msgs = edges.reduce((s, e) => s + e.msgsAB + e.msgsBA, 0);

  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Twitch</p>
          <h1 className="t-1">Verbindungen</h1>
          <p>
            Wer wen geraidet hat, wer gemeinsam im geteilten Chat war und wer im Twitch-Chat des anderen schreibt. Je enger die
            Verbindung, desto dicker die Linie und desto näher stehen die Köpfe zusammen. Wie viel jede Art zählt, stellst du
            selbst ein.
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
              <dt title="Nachrichten von Spielern im Twitch-Chat eines anderen Spielers">Chat-Nachrichten</dt>
              <FigValue>{num(msgs)}</FigValue>
            </div>
            <div className="box st-fig" data-tone="pink">
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
          <ConnectionExplorer nodes={nodes} edges={edges} />
        </div>
      </section>
    </>
  );
}
