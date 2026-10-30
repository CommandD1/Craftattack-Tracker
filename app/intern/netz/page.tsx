import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/Skeletons";
import { NetworkLab } from "@/components/NetworkLab";
import { NETWORK_RANGES, getNetwork } from "@/lib/connections";
import { internAllowed } from "@/lib/intern";

export const metadata: Metadata = { title: "Netz (Versuch)", robots: { index: false, follow: false } };

/** Versuchsfläche für neue Netz-Ansichten (Nähe-Ringe, Gruppen), bevor sie auf /verbindungen kommen. */
export default function Page(props: PageProps<"/intern/netz">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Intern" title="Netz (Versuch)" tone="amethyst" />}>
      <Lab searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Lab({ searchParams }: { searchParams: PageProps<"/intern/netz">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const key = sp.key;
  if (!internAllowed(key)) notFound();
  const range = NETWORK_RANGES.find((r) => r.key === sp.zeit) ?? NETWORK_RANGES[2];
  const { nodes, edges } = await getNetwork(range.hours);
  const href = (zeit: string) => `/intern/netz?${new URLSearchParams({ key, ...(zeit === "alle" ? {} : { zeit }) })}`;
  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Intern · Versuch</p>
          <h1 className="t-1">Netz: Nähe und Gruppen</h1>
          <p>
            Zwei Ideen zum Ausprobieren, bevor sie auf <Link href="/verbindungen">Verbindungen</Link> kommen: ein Spieler in der Mitte und alle anderen
            nach ihrer Nähe zu ihm, und automatisch erkannte Gruppen. Raids und Chat-Nachrichten zählen nur in ihre Richtung.
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
          <div className="box netlab__feedback" data-tone="gold">
            <b>Feedback gesucht:</b> Ist „Ringe nach Nähe“ oder „nach Schritten“ verständlicher? Sollen die Gruppen als eigene Ansicht bleiben oder
            als Farben im normalen Netz auf /verbindungen? Passen die erkannten Gruppen zu dem, was du aus den Streams kennst?
          </div>
          <NetworkLab nodes={nodes} edges={edges} />
        </div>
      </section>
    </>
  );
}
