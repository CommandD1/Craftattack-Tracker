import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/Skeletons";
import { GroupView } from "@/components/GroupViews";
import { getNetwork } from "@/lib/connections";
import { internAllowed } from "@/lib/intern";

export const metadata: Metadata = { title: "Gruppe (Versuch)", robots: { index: false, follow: false } };

/**
 * Eine Gruppe (intern, Versuch). Adressiert über einen Spieler (`/intern/gruppen/<id>`): die Gruppe, in der er gerade
 * ist. So bleiben Links gültig, auch wenn sich Gruppen mit neuen Daten oder anderer Feinheit verschieben.
 */
export default function Page(props: PageProps<"/intern/gruppen/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Intern · Gruppe" title="Gruppe" tone="amethyst" />}>
      <Group params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Group({ params, searchParams }: { params: PageProps<"/intern/gruppen/[id]">["params"]; searchParams: PageProps<"/intern/gruppen/[id]">["searchParams"] }) {
  await connection();
  const [{ id: raw }, sp] = await Promise.all([params, searchParams]);
  const key = sp.key;
  if (!internAllowed(key)) notFound();
  const id = decodeURIComponent(raw);
  const { nodes, edges } = await getNetwork(null);
  if (!nodes.some((n) => n.id === id)) notFound();
  return (
    <>
      <section className="block block--tight" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">
            <Link href={`/intern/gruppen?key=${encodeURIComponent(key)}`}>← Alle Gruppen</Link>
          </p>
        </div>
      </section>
      <section className="block" data-tone="paper">
        <div className="wrap">
          <GroupView nodes={nodes} edges={edges} member={id} base={{ path: "/intern/gruppen", key }} />
        </div>
      </section>
    </>
  );
}
