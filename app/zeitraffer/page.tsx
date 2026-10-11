import Link from "next/link";
import type { Metadata } from "next";
import { loadTracker } from "@/lib/data";
import { dayKey, getTimelapse } from "@/lib/analytics";
import { num } from "@/lib/format";
import { DateNav } from "@/components/DateNav";
import { Timelapse } from "@/components/Timelapse";

export const instant = false;
export const metadata: Metadata = { title: "Zeitraffer" };

const dayLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

export default async function Page(props: PageProps<"/zeitraffer">) {
  const sp = await props.searchParams;
  const { now } = await loadTracker();
  const tag = typeof sp.tag === "string" ? sp.tag : undefined;
  const data = await getTimelapse(tag);
  const peak = data.frames.reduce((m, f) => Math.max(m, f.online.length), 0);

  return (
    <>
      <section className="block page-head" data-tone="lava">
        <div className="wrap">
          <p className="eyebrow">Ein Tag im Schnelldurchlauf</p>
          <h1 className="t-1">Zeitraffer</h1>
          <p>
            Alle fünf Minuten ein Bild: Wer gerade auf dem Server ist, leuchtet grün, wer streamt, lila. Dazu laufen die Tode, Zuschauer und
            die Meldungen des Tages mit.
          </p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="section-head">
            <div>
              <h2 className="t-2">{dayLong.format(data.nav.from + 12 * 3600_000)}</h2>
              <p className="muted num" style={{ marginTop: 8 }}>
                {num(data.frames.length)} Bilder · {num(data.players.length)} Spieler · Spitze {num(peak)} gleichzeitig
              </p>
            </div>
            <DateNav base="/zeitraffer" day={data.nav.day} prev={data.nav.prev} next={data.nav.next} max={dayKey(now)} />
          </div>
          <div className="box" data-tone="white">
            <Timelapse data={data} />
          </div>
          <p className="muted" style={{ marginTop: 16, fontSize: ".9375rem" }}>
            Zum Vergleich als Balken: der <Link href={`/zeitstrahl?tag=${data.nav.day}`}>Zeitstrahl</Link> desselben Tages.
          </p>
        </div>
      </section>
    </>
  );
}
