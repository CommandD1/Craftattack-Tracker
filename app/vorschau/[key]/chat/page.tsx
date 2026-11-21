import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { ChatReview } from "@/components/ChatReview";
import { bundleHead, loadChatReview } from "@/lib/chatReview";
import { previewGate } from "@/lib/preview";

export const metadata: Metadata = { title: "Ingame-Chat aufräumen" };

async function Inner(props: PageProps<"/vorschau/[key]/chat">) {
  const root = await previewGate(props.params);
  const data = await loadChatReview();
  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Vorschau · Rückblick-Video</p>
          <h1>Ingame-Chat aufräumen</h1>
          <p className="lead">
            Der VOD-Scan liest den Ingame-Chat per Texterkennung. Der Chat ist serverweit gleich, deshalb steht dieselbe Zeile
            in vielen Streams gleichzeitig – jede Lesung mit anderen Fehlern. Lesungen eines Ereignisses sind hier
            zusammengefasst. Übrig sind Ereignisse, bei denen der Spieler nicht sicher ist, gebündelt nach dem gelesenen
            Namen: eine Wahl gilt für alle Ereignisse mit diesem Namen, auch für künftige Scans. Einzelne Ereignisse lassen
            sich darunter abweichend zuordnen.
          </p>
        </div>
      </section>
      <section className="block">
        <div className="wrap">
          {data ? (
            <ChatReview
              made={data.made}
              stats={data.stats}
              players={data.players}
              bundles={data.bundles.map(bundleHead)}
              endpoint={`${root}/chat/daten`}
            />
          ) : (
            <p>Noch keine Daten vom Scan.</p>
          )}
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/chat">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Ingame-Chat aufräumen" figs={0} />}>
      <Inner {...props} />
    </Suspense>
  );
}
