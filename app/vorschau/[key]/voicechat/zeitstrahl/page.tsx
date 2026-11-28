import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/Skeletons";
import { VoiceTimeline } from "@/components/VoiceTimeline";
import { previewGate } from "@/lib/preview";
import { isDay, loadVoiceIndex } from "@/lib/voiceDays";
import "../voicechat.css";
import "./zeitstrahl.css";

export const metadata: Metadata = { title: "Voicechat-Zeitstrahl" };

// Minuten ab 06:00 → Uhrzeit
const hm = (m: number) => `${String(Math.floor((m + 360) / 60) % 24).padStart(2, "0")}:${String((m + 360) % 60).padStart(2, "0")}`;
const dayLabel = (d: string) => new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

async function Inner(props: PageProps<"/vorschau/[key]/voicechat/zeitstrahl">) {
  const root = await previewGate(props.params);
  const sp = await props.searchParams;
  const index = await loadVoiceIndex();
  const base = `${root}/voicechat/zeitstrahl`;
  const days = index?.days ?? [];
  const wanted = typeof sp.tag === "string" && isDay(sp.tag) ? sp.tag : null;
  // Spieler-ID wie in face-review.json, "alle" = alles auf einmal
  const player = typeof sp.spieler === "string" && /^[\w-]{1,64}$/.test(sp.spieler) ? sp.spieler : null;
  const day = days.find((d) => d.day === wanted)?.day ?? [...days].sort((a, b) => b.withGroup - a.withGroup)[0]?.day ?? null;
  const long = days.flatMap((d) => (d.long ?? []).map((c) => ({ ...c, day: d.day }))).sort((x, y) => y.b - y.a - (x.b - x.a));
  const name = (id: string) => index?.players[id]?.name ?? id;
  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">
            Vorschau · Rückblick-Video · <Link href={`${root}/voicechat`}>Voicechat</Link> · <Link href={`${root}/gesichter`}>Gesichter zuordnen</Link>
          </p>
          <h1 className="t-1">Voicechat-Zeitstrahl</h1>
          <p className="lead">
            Wer wann mit wem im Voicechat war, je Spieltag (06:00 bis 06:00) und Spieler. Konflikte (rot umrandet) zeigen, wo die Listen verschiedener Streamer derselben Gruppe nicht
            zusammenpassen – meist ein falsch erkannter Kopf. Dort anklicken, in den Listen den falschen Kopf ändern; das gilt sofort hier und zur
            nächsten vollen Stunde im Scan.
          </p>
        </div>
      </section>
      <section className="block block--tight">
        <div className="wrap">
          {!index || !day ? (
            <p>Noch keine Tagesdaten (scripts/chat/export-voice-days.mjs im Videoprojekt).</p>
          ) : (
            <>
              <nav className="vt-days" aria-label="Tag">
                {days.map((d) => (
                  <Link
                    key={d.day}
                    href={`${base}?tag=${d.day}${player ? `&spieler=${encodeURIComponent(player)}` : ""}`}
                    aria-current={d.day === day ? "page" : undefined}
                    title={`${d.withGroup.toLocaleString("de-DE")} Bilder mit Gruppe${d.open != null ? ` · ${d.open.toLocaleString("de-DE")} offene Köpfe` : ""}`}
                  >
                    {dayLabel(d.day)}
                  </Link>
                ))}
              </nav>
              {long.length > 0 && (
                <details className="vt-long" open={!wanted}>
                  <summary>
                    <b>{long.length}</b> lange Konflikte (ab 15 Min, alle Tage) – nur diese lohnen das Nachsehen
                  </summary>
                  <p className="muted">
                    Kürzere sind meist Gruppenwechsel oder kurz falsch gelesene Köpfe. Die Liste wird stündlich neu berechnet; gelöste Konflikte verschwinden zur nächsten vollen Stunde.
                  </p>
                  <ol>
                    {long.map((c) => (
                      <li key={`${c.day}-${c.p.join()}-${c.a}`}>
                        <Link href={`${base}?tag=${c.day}&spieler=${encodeURIComponent(c.p[0])}`}>
                          {dayLabel(c.day)} {hm(c.a)}–{hm(c.b + 1)}
                        </Link>{" "}
                        · {c.b - c.a + 1} Min · <b>{c.p.map(name).join(" ↔ ")}</b>
                        {c.with.length > 0 && <span className="muted"> · auch strittig: {c.with.map(name).join(", ")}</span>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <VoiceTimeline key={day} day={day} players={index.players} endpoint={`${base}/daten`} fileBase={`${base}/tag`} base={base} player={player} />
            </>
          )}
        </div>
      </section>
    </>
  );
}

export default function Page(props: PageProps<"/vorschau/[key]/voicechat/zeitstrahl">) {
  return (
    <Suspense fallback={<PageSkeleton eyebrow="Vorschau" title="Voicechat-Zeitstrahl" figs={0} />}>
      <Inner {...props} />
    </Suspense>
  );
}
