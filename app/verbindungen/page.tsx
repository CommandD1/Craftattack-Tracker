import { Explain } from "@/components/Explain";
import { DataAge } from "@/components/DataAge";
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/Skeletons";
import { CommunityExplorer, type CommunityView } from "@/components/CommunityExplorer";
import { getDailyNetwork } from "@/lib/connections";
import { caModeOf } from "@/lib/onlineSpans";

export const metadata: Metadata = {
  title: "Verbindungen",
  description: "Wer auf CraftAttack 14 mit wem verbunden ist: Raids, geteilte Chats, Voicechat, Namen im Titel und Chat-Nachrichten als Netz, nach Nähe und in Gruppen.",
};



/** Netz, Nähe und Gruppen auf einer Seite. Öffnet sofort mit Überschrift und Platzhaltern; die Daten werden nachgestreamt. */
export default function Page(props: PageProps<"/verbindungen">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Community" title="Verbindungen" tone="amethyst" />}>
      <Community searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Community({ searchParams }: { searchParams: PageProps<"/verbindungen">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const [all, einer, beide] = await Promise.all([getDailyNetwork(), getDailyNetwork("einer"), getDailyNetwork("beide")]);
  // Frühere Ansichten: „naehe“ heißt jetzt Distanz, „gruppen“ ist das Netz mit eingeschalteten Gruppen
  const view: CommunityView = sp.ansicht === "distanz" || sp.ansicht === "naehe" ? "distanz" : "netz";
  const groups = sp.gruppen === "1" || sp.ansicht === "gruppen" ? true : sp.gruppen === "0" ? false : null;
  const focus = typeof sp.spieler === "string" && all.nodes.some((n) => n.id === sp.spieler) ? sp.spieler : "";

  return (
    <>
      <section className="block page-head" data-tone="amethyst">
        <div className="wrap">
          <p className="eyebrow">Community</p>
          <h1 className="t-1">Verbindungen</h1>
          <p>
            Wer wen raidet, gemeinsam im geteilten Chat oder im Voicechat ist, im Titel nennt oder im Chat des anderen schreibt: als Netz oder nach Distanz, für alle oder für
            einen ausgewählten Spieler, auf Wunsch mit Gruppen.{" "}
            <Explain>
              Alle Einstellungen gelten für beide Ansichten, ein ausgewählter Spieler bleibt beim Wechsel ausgewählt. <b>Verbindungen</b>: je enger die
              Verbindung, desto dicker die Linie und desto näher die Köpfe; mit Spieler seine Verbindungen. <b>Distanz</b>: wer allen am nächsten steht; mit Spieler
              alle nach dem kürzesten Weg zu ihm (Raids, Titel und Nachrichten zählen nur in ihre Richtung, geteilter Chat und Voicechat für beide). <b>Voicechat</b>: Zeit in derselben Gruppe, gelesen aus den Stream-Aufnahmen; die gibt es nur auf dem Server, sie zählt deshalb in jeder Auswahl unten. <b>Gruppen</b>: wer untereinander deutlich enger
              verbunden ist als mit dem Rest (Louvain), benannt nach dem Mitglied mit der meisten Aufmerksamkeit; das sagt nichts über echte Freundschaften.
              <b> Daten</b>: „CraftAttack“ (Standard) zählt nur, was geschah, während mindestens einer der beiden auf CraftAttack online war, „Beide auf CraftAttack“
              nur, während beide gleichzeitig dort waren, „Alles“ alle Twitch-Daten; in Lücken des Trackers gilt niemand als online. Die Auswahl gilt auch für Zuschauer und Raids. Kopf anklicken wählt den Spieler aus, Rechtsklick öffnet sein Profil.
            </Explain>{" "}
            <DataAge at={Math.min(all.at, einer.at, beide.at)} prefix="Auswertung" hint="wird alle 10 Minuten im Hintergrund neu berechnet" />
          </p>
        </div>
      </section>
      <section className="block" data-tone="paper">
        <div className="wrap">
          <CommunityExplorer nodes={all.nodes} daily={all.daily} dailyEiner={einer.daily} dailyBeide={beide.daily} initialView={view} initialCa={caModeOf(sp)} initialFocus={focus} initialGroups={groups} />
        </div>
      </section>
    </>
  );
}
