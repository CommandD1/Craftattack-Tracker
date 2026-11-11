import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { ClipGrid } from "@/components/ClipGrid";
import type { Clip } from "@/lib/clips";
import { fcBase, fcData, fcGate } from "@/lib/fitnacraft";
import { num } from "@/lib/format";
import { FcHead } from "../../_components/FcNav";

export const metadata: Metadata = { title: "Clips" };

async function Clips(props: PageProps<"/fitnacraft/[key]/clips">) {
  const key = await fcGate(props.params);
  const sp = await props.searchParams;
  const d = await fcData();
  const base = fcBase(key);
  const spieler = typeof sp.spieler === "string" && d.players.some((p) => p.id === sp.spieler) ? sp.spieler : null;
  const clips: Clip[] = d.clips
    .filter((c) => !spieler || c.player === spieler)
    .slice(0, 60)
    .map((c) => ({ ...c, name: d.names[c.player]?.[0] ?? c.player, uuid: d.names[c.player]?.[1] ?? "", at: new Date(c.at).toISOString() }));
  const total = d.players.reduce((s, p) => s + p.clips, 0);
  return (
    <>
      <FcHead k={key} d={d} tab="/clips" title="Clips">
        <p>Die meistgesehenen der {num(total)} Clips aus FitnaCraft-Streams.</p>
      </FcHead>
      <section className="block block--tight" data-tone="paper">
        <div className="wrap stack">
          <ul className="filters" aria-label="Spieler">
            <li>
              <Link className="tag" href={`${base}/clips`} aria-current={!spieler ? "true" : undefined}>
                Alle
              </Link>
            </li>
            {d.players
              .filter((p) => p.clips > 0)
              .map((p) => (
                <li key={p.id}>
                  <Link className="tag" href={`${base}/clips?spieler=${encodeURIComponent(p.id)}`} aria-current={spieler === p.id ? "true" : undefined}>
                    {p.name} <span className="num">({num(p.clips)})</span>
                  </Link>
                </li>
              ))}
          </ul>
          <ClipGrid clips={clips} showPlayer={!spieler} />
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/fitnacraft/[key]/clips">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="FitnaCraft-Rückblick" title="Clips" />}>
      <Clips {...props} />
    </Suspense>
  );
}
