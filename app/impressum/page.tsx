import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Impressum", robots: { index: false } };

/** Anbieterkennzeichnung nach § 5 DDG. */
export default function Impressum() {
  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Rechtliches</p>
          <h1 className="t-1">Impressum</h1>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="how">
            <section className="box how__section" data-tone="white" aria-labelledby="anbieter-h">
              <h2 className="t-3" id="anbieter-h">
                Angaben gemäß § 5 DDG
              </h2>
              <address style={{ fontStyle: "normal" }}>
                HiorCraft — Liam Fanenbruck
                <br />
                c/o Online-Impressum 12139
                <br />
                Europaring 90
                <br />
                53757 Sankt Augustin
              </address>
            </section>

            <section className="box how__section" data-tone="white" aria-labelledby="kontakt-h">
              <h2 className="t-3" id="kontakt-h">
                Kontakt
              </h2>
              <p>
                E-Mail: <a href="mailto:contact@hiorcraft.dev">contact@hiorcraft.dev</a>
              </p>
            </section>

            <p>
              Wie wir mit deinen Daten umgehen, steht in der <Link href="/datenschutz">Datenschutzerklärung</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
