import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { Head } from "@/components/Head";
import { fcData, fcGate } from "@/lib/fitnacraft";
import { num } from "@/lib/format";
import { FcHead, change, fcPlayerHref, hours } from "../../_components/FcNav";

export const metadata: Metadata = { title: "Spieler" };

async function Players(props: PageProps<"/fitnacraft/[key]/spieler">) {
  const key = await fcGate(props.params);
  const d = await fcData();
  return (
    <>
      <FcHead k={key} d={d} tab="/spieler" title="Spieler">
        <p>Alle {d.players.length} CraftAttack-Mitglieder, die auf FitnaCraft gestreamt haben, nach Stream-Zeit.</p>
      </FcHead>
      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <ul className="grid" style={{ "--min": "240px", "--gap": "16px", listStyle: "none", padding: 0, margin: 0 } as React.CSSProperties}>
            {d.players.map((p) => (
              <li key={p.id}>
                <Link className="box player-card" data-tone="white" href={fcPlayerHref(key, p.id)}>
                  <div className="player-card__top">
                    <Head id={p.id} uuid={p.uuid} name={p.name} size={44} src={64} decorative />
                    <div>
                      <p className="player-card__name">{p.name}</p>
                      <div className="player-card__tags">
                        <span className="tag" data-tone="twitch" title="⌀ Zuschauer auf FitnaCraft">
                          ⌀ {num(p.avgViewers)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <dl className="player-card__stats">
                      <dt>FitnaCraft</dt>
                      <dd className="num">{hours(p.seconds)}</dd>
                      <dt>vs. CA ⌀</dt>
                      <dd className="num">{change(p.avgViewers, p.caAvgViewers)}</dd>
                      <dt>Follower</dt>
                      <dd className="num">+{num(p.followerGain)}</dd>
                      <dt>Abos</dt>
                      <dd className="num">{num(p.paidSubs + p.giftSubs)}</dd>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/fitnacraft/[key]/spieler">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="FitnaCraft-Rückblick" title="Spieler" />}>
      <Players {...props} />
    </Suspense>
  );
}
