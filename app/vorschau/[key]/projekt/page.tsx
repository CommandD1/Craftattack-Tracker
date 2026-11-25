import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { previewGate } from "@/lib/preview";
import { getProjectNumbers } from "@/lib/projectMap";
import { PROJECT_MILESTONES, PROJECT_PRS } from "@/lib/projectTimeline";
import { ProjectExplorer } from "./ProjectExplorer";
import "./projekt.css";

export const metadata: Metadata = { title: "Das Projekt" };

async function Inner(props: PageProps<"/vorschau/[key]/projekt">) {
  const root = await previewGate(props.params);
  const x = await getProjectNumbers();
  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Vorschau · Das Projekt</p>
          <h1 className="t-1">Hinter dem Tracker</h1>
          <p>
            Woher die Daten kommen, was mit ihnen passiert und wo sie landen: vom Abruf auf craftattack.one über den Scan der Twitch-Aufzeichnungen bis zum
            Rückblick-Video. Alle Zahlen sind live.
          </p>
        </div>
      </section>
      <ProjectExplorer x={x} prs={PROJECT_PRS} milestones={PROJECT_MILESTONES} root={root} />
    </>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/projekt">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Das Projekt" />}>
      <Inner {...props} />
    </Suspense>
  );
}
