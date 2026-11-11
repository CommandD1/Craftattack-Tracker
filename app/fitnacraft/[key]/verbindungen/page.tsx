import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { Head } from "@/components/Head";
import { fcBase, fcData, fcGate, who } from "@/lib/fitnacraft";
import { dateTime, duration, num } from "@/lib/format";
import { FcHead, fcPlayerHref } from "../../_components/FcNav";
import { FcGraph } from "../../_components/FcGraph";

export const metadata: Metadata = { title: "Verbindungen" };

async function Connections(props: PageProps<"/fitnacraft/[key]/verbindungen">) {
  const key = await fcGate(props.params);
  const d = await fcData();
  const fcIds = new Set(d.players.map((p) => p.id));
  // Netz: nur Paare, bei denen beide auf FitnaCraft waren
  const links = d.links.filter((l) => fcIds.has(l.a) && fcIds.has(l.b));
  const nodes = d.players.map((p) => ({ id: p.id, name: p.name, uuid: p.uuid, online: false, live: false }));
  const together = [...links].filter((l) => l.together > 0).sort((a, b) => b.together - a.together);
  const raids = [...d.raids].reverse();
  const shared = [...d.shared].filter((s) => s.ps.length > 1).sort((a, b) => b.b - b.a - (a.b - a.a));
  const P = ({ id }: { id: string | null }) => {
    const w = who(d, id);
    if (!w) return <span>?</span>;
    const inner = (
      <>
        <Head id={w.id} uuid={w.uuid} name={w.name} size={20} decorative /> {w.name}
      </>
    );
    return fcIds.has(w.id) ? (
      <Link className="fc-who" href={fcPlayerHref(key, w.id)}>
        {inner}
      </Link>
    ) : (
      <span className="fc-who">{inner}</span>
    );
  };
  return (
    <>
      <FcHead k={key} d={d} tab="/verbindungen" title="Verbindungen">
        <p>Wer auf FitnaCraft mit wem unterwegs war: gleichzeitig live, Raids, geteilte Chats (Stream Together), Chat-Nachrichten und Namen im Titel.</p>
      </FcHead>
      <section className="block block--tight" data-tone="paper">
        <div className="wrap stack">
          <div className="box" data-tone="white">
            <h3 className="t-3">Netz</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              Linien: Raids, geteilter Chat, Titel-Erwähnungen und Chat-Nachrichten zwischen FitnaCraft-Spielern (gleich gewichtet wie auf der Hauptseite). Klick öffnet das Profil.
            </p>
            <FcGraph nodes={nodes} links={links} base={fcBase(key)} />
          </div>
          <div className="fc-two">
            <div className="box" data-tone="white">
              <h3 className="t-3">Am häufigsten zusammen</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Zeit, in der beide gleichzeitig live auf FitnaCraft waren.
              </p>
              <div className="tbl-wrap">
                <table className="tbl">
                  <tbody>
                    {together.slice(0, 30).map((l) => (
                      <tr key={`${l.a}|${l.b}`}>
                        <td>
                          <P id={l.a} />
                        </td>
                        <td>
                          <P id={l.b} />
                        </td>
                        <td className="num">{duration(l.together)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="box" data-tone="white">
              <h3 className="t-3">Geteilte Chats</h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Stream Together mit mindestens zwei erfassten Spielern, längste zuerst.
              </p>
              {shared.length === 0 ? (
                <p className="muted">Keine.</p>
              ) : (
                <ul className="fc-feed fc-feed--wide">
                  {shared.slice(0, 30).map((s) => (
                    <li key={`${s.a}-${s.ps.join()}`}>
                      <span className="num muted">{duration((s.b - s.a) / 1000)}</span>
                      <span>
                        {s.ps.map((id, i) => (
                          <span key={id}>
                            {i > 0 && " · "}
                            <P id={id} />
                          </span>
                        ))}
                        {s.others > 0 && <span className="muted"> + {s.others} weitere</span>} <span className="muted">· {dateTime(new Date(s.a).toISOString())}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="box" data-tone="white">
            <h3 className="t-3">Raids</h3>
            <p className="muted" style={{ marginBottom: 8 }}>
              {num(raids.length)} Raids aus FitnaCraft-Streams heraus oder in sie hinein.
            </p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Von</th>
                    <th>Nach</th>
                    <th className="num">Zuschauer</th>
                  </tr>
                </thead>
                <tbody>
                  {raids.map((r) => (
                    <tr key={`${r.at}-${r.from}`}>
                      <td>{dateTime(new Date(r.at).toISOString())}</td>
                      <td>
                        <P id={r.from} />
                      </td>
                      <td>{r.to && d.names[r.to] ? <P id={r.to} /> : (r.toName ?? "?")}</td>
                      <td className="num">{r.viewers ? num(r.viewers) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/fitnacraft/[key]/verbindungen">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="FitnaCraft-Rückblick" title="Verbindungen" />}>
      <Connections {...props} />
    </Suspense>
  );
}
