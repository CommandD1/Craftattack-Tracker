import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { FaceReview } from "@/components/FaceReview";
import { loadFaceReview } from "@/lib/faceReview";
import { previewGate } from "@/lib/preview";

export const metadata: Metadata = { title: "Gesichter zuordnen" };

async function Inner(props: PageProps<"/vorschau/[key]/gesichter">) {
  const root = await previewGate(props.params);
  const data = await loadFaceReview();
  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Vorschau · Rückblick-Video</p>
          <h1>Gesichter zuordnen</h1>
          <p className="lead">
            Köpfe aus der Voicechat-Liste, die der VOD-Scan keinem Skin zuordnen konnte, nach Ähnlichkeit gruppiert. Wähle den
            Spieler oder sortiere die Gruppe aus. Kandidaten waren laut Tracker bei mindestens der Hälfte der Sichtungen online.
            Eine Zuordnung gilt für alle Sichtungen der Gruppe und für künftige Scans.
          </p>
        </div>
      </section>
      <section className="block">
        <div className="wrap">
          {data ? <FaceReview data={data} endpoint={`${root}/gesichter/daten`} /> : <p>Noch keine Daten vom Scan.</p>}
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/gesichter">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Gesichter zuordnen" figs={0} />}>
      <Inner {...props} />
    </Suspense>
  );
}
