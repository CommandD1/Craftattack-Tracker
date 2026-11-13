import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/Skeletons";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { previewGate } from "@/lib/preview";
import { getAdvancementBoard } from "@/lib/playerAdvancements";
import { AdvancementBoard } from "@/components/AdvancementBoard";

export const metadata: Metadata = { title: "Fortschritte mit Ereignissen" };

/**
 * Test: Fortschritte eines Spielers wie im Profil, aber gemeldete Fortschritte führen auf ihre Ereignis-Seite in der
 * Vorschau. Öffentlich wird das über EVENT_DETAIL_BASE in lib/events.ts eingeschaltet.
 */
async function VorschauSpieler({ params }: PageProps<"/vorschau/[key]/spieler/[id]">) {
  const base = await previewGate(params);
  const id = decodeURIComponent((await params).id).toLowerCase();
  const { state } = await loadTracker();
  const p = state.players[id];
  if (!p) notFound();
  const board = await getAdvancementBoard(id, state.players);
  return (
    <section className="block block--tight" data-tone="paper">
      <div className="wrap">
        <div className="section-head">
          <h1 className="t-2">Fortschritte von {p.name ?? id}</h1>
          <p className="muted">
            Wie auf dem <Link href={`/spieler/${encodeURIComponent(id)}`}>Spielerprofil</Link>, aber ein Klick auf einen gemeldeten Fortschritt
            öffnet sein Ereignis. Vermutete Fortschritte haben kein Ereignis.
          </p>
        </div>
        <AdvancementBoard mine={board.mine} others={board.others} players={board.players} eventBase={`${base}/ereignis`} />
      </div>
    </section>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/spieler/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Fortschritte" />}>
      <VorschauSpieler {...props} />
    </Suspense>
  );
}
