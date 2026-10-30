import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/Skeletons";
import { GroupsOverview } from "@/components/GroupViews";
import { NETWORK_RANGES, getNetwork } from "@/lib/connections";
import { internAllowed } from "@/lib/intern";

export const metadata: Metadata = { title: "Gruppen (Versuch)", robots: { index: false, follow: false } };

/** Alle erkannten Gruppen (intern, Versuch): Karte der Gruppen und eine Karte je Gruppe */
export default function Page(props: PageProps<"/intern/gruppen">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Intern" title="Gruppen" tone="amethyst" />}>
      <Groups searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Groups({ searchParams }: { searchParams: PageProps<"/intern/gruppen">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const key = sp.key;
  if (!internAllowed(key)) notFound();
  const range = NETWORK_RANGES.find((r) => r.key === sp.zeit) ?? NETWORK_RANGES[2];
  const { nodes, edges } = await getNetwork(range.hours);
  const href = (zeit: string) => `/intern/gruppen?${new URLSearchParams({ key, ...(zeit === "alle" ? {} : { zeit }) })}`;
  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Intern · Versuch</p>
          <h1 className="t-1">Gruppen</h1>
          <p>
            Spieler, die untereinander deutlich mehr Raids, Chat-Nachrichten und geteilte Chats haben als mit dem Rest. Jede Gruppe ist nach ihrem Anführer
            benannt: dem Mitglied, das in der Gruppe die meiste Aufmerksamkeit bekommt. Siehe auch das <Link href={`/intern/netz?key=${encodeURIComponent(key)}`}>Netz</Link>.
          </p>
        </div>
      </section>
      <section className="block" data-tone="paper">
        <div className="wrap">
          <ul className="filters" aria-label="Zeitraum">
            {NETWORK_RANGES.map((r) => (
              <li key={r.key}>
                <Link className="tag" aria-current={range.key === r.key ? "true" : undefined} href={href(r.key)}>
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
          <GroupsOverview nodes={nodes} edges={edges} base={{ path: "/intern/gruppen", key }} />
        </div>
      </section>
    </>
  );
}
