import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Datenschutz", robots: { index: false } };

/** Abschnitte der Seite; der Schlüssel ist der Anker (/datenschutz#…) */
const SECTIONS = [
  { id: "ueberblick", title: "Auf einen Blick" },
  { id: "hosting", title: "Hosting" },
  { id: "pflichtinfos", title: "Pflichtinformationen" },
  { id: "website", title: "Diese Website" },
  { id: "twitch", title: "Twitch-Einbettung" },
  { id: "tracker", title: "Daten über Spieler" },
] as const;

/** Datenschutzerklärung, aufgebaut nach dem Muster von eRecht24 und auf das angepasst, was die Seite tatsächlich tut. */
export default function Datenschutz() {
  return (
    <>
      <section className="block page-head" data-tone="ender">
        <div className="wrap">
          <p className="eyebrow">Rechtliches</p>
          <h1 className="t-1">Datenschutzerklärung</h1>
          <p>Welche Daten beim Besuch dieser Seite anfallen, welche der Tracker selbst sammelt und welche Rechte du hast.</p>
        </div>
      </section>

      <section className="block block--tight" data-tone="paper">
        <div className="wrap">
          <div className="how">
            <nav aria-label="Inhalt">
              <ul className="filters">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a className="tag" data-tone="white" href={`#${s.id}`}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <section className="box how__section" data-tone="white" id="ueberblick" aria-labelledby="ueberblick-h">
              <h2 className="t-3" id="ueberblick-h">
                1. Datenschutz auf einen Blick
              </h2>
              <h3>Allgemeine Hinweise</h3>
              <p>
                Die folgenden Hinweise geben einen Überblick darüber, was mit deinen personenbezogenen Daten passiert, wenn du diese
                Website besuchst. Personenbezogene Daten sind alle Daten, mit denen du persönlich identifiziert werden kannst.
              </p>
              <h3>Wer ist verantwortlich?</h3>
              <p>
                Verantwortlich für die Datenverarbeitung auf dieser Website ist der Betreiber. Seine Kontaktdaten stehen im{" "}
                <Link href="/impressum">Impressum</Link> und unten unter „Verantwortliche Stelle“.
              </p>
              <h3>Wie werden Daten erfasst?</h3>
              <p>
                Beim Besuch der Seite erfasst der Server automatisch technische Daten, etwa Browser, Betriebssystem und Uhrzeit des
                Abrufs. Darüber hinaus fallen Daten nur an, wenn du sie uns selbst mitteilst (z. B. per E-Mail) oder wenn du der
                Einbettung eines Twitch-Streams zustimmst. Es gibt kein Benutzerkonto, kein Kontaktformular, keine Analyse- oder
                Werbe-Tools und keine Cookies dieser Website. Die Seite wird über Cloudflare ausgeliefert (siehe „Hosting“).
              </p>
              <h3>Welche Rechte hast du?</h3>
              <p>
                Du kannst jederzeit unentgeltlich Auskunft über Herkunft, Empfänger und Zweck deiner gespeicherten personenbezogenen
                Daten verlangen und ihre Berichtigung oder Löschung fordern. Eine erteilte Einwilligung kannst du jederzeit für die
                Zukunft widerrufen. Außerdem steht dir ein Beschwerderecht bei der zuständigen Aufsichtsbehörde zu. Details stehen
                unter „Pflichtinformationen“.
              </p>
            </section>

            <section className="box how__section" data-tone="white" id="hosting" aria-labelledby="hosting-h">
              <h2 className="t-3" id="hosting-h">
                2. Hosting
              </h2>
              <p>Diese Website wird bei einem externen Dienstleister gehostet:</p>
              <address style={{ fontStyle: "normal" }}>
                Hetzner Online GmbH
                <br />
                Industriestr. 25
                <br />
                91710 Gunzenhausen
              </address>
              <p>
                Auf den Servern des Hosters werden die Website selbst, die Datenbank des Trackers und die beim Aufruf anfallenden
                Zugriffsdaten (siehe „Server-Log-Dateien“) verarbeitet. Die Server stehen in Deutschland bzw. der EU. Details stehen in
                der{" "}
                <a href="https://www.hetzner.com/de/legal/privacy-policy/" target="_blank" rel="noopener">
                  Datenschutzerklärung von Hetzner
                </a>
                .
              </p>
              <p>
                Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO: Wir haben ein berechtigtes Interesse an einer zuverlässigen und
                sicheren Bereitstellung der Website.
              </p>
              <h3>Auftragsverarbeitung</h3>
              <p>
                Mit Hetzner besteht ein Vertrag über Auftragsverarbeitung (AVV) nach Art. 28 DSGVO. Hetzner verarbeitet die Daten
                nur nach unseren Weisungen und unter Einhaltung der DSGVO.
              </p>

              <h3 id="cloudflare">Cloudflare</h3>
              <p>
                Vor der Website steht das Content-Delivery-Netzwerk von Cloudflare. Anbieter ist die Cloudflare, Inc., 101
                Townsend St., San Francisco, CA 94107, USA. Jeder Aufruf der Seite läuft über die Server von Cloudflare; Cloudflare
                verarbeitet dabei deine IP-Adresse, die aufgerufene Adresse, Browser-Angaben und Uhrzeit, um die Seite schnell
                auszuliefern und vor Angriffen und missbräuchlichen Zugriffen zu schützen.
              </p>
              <p>
                Bei normalen Aufrufen setzt Cloudflare keine Cookies. Stuft der Schutzdienst einen Zugriff als verdächtig ein,
                können technisch notwendige Cookies gesetzt werden: <code>__cf_bm</code> (unterscheidet Menschen von Bots, 30
                Minuten) und <code>cf_clearance</code> (merkt, dass eine Sicherheitsabfrage bestanden wurde). Dafür ist keine
                Einwilligung nötig (§ 25 Abs. 2 Nr. 2 TDDDG).
              </p>
              <p>
                Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO: Wir haben ein berechtigtes Interesse an einer schnellen und
                sicheren Bereitstellung der Website. Cloudflare ist Auftragsverarbeiter; es gilt das Data Processing Addendum von
                Cloudflare nach Art. 28 DSGVO. Dabei können Daten in die USA übertragen werden. Cloudflare ist nach dem
                EU-US Data Privacy Framework zertifiziert, auf dessen Grundlage die Übermittlung zulässig ist (Art. 45 DSGVO);
                ergänzend gelten die Standardvertragsklauseln der EU-Kommission. Details stehen in der{" "}
                <a href="https://www.cloudflare.com/de-de/privacypolicy/" target="_blank" rel="noopener">
                  Datenschutzerklärung von Cloudflare
                </a>
                .
              </p>
            </section>

            <section className="box how__section" data-tone="white" id="pflichtinfos" aria-labelledby="pflichtinfos-h">
              <h2 className="t-3" id="pflichtinfos-h">
                3. Allgemeine Hinweise und Pflichtinformationen
              </h2>
              <h3>Datenschutz</h3>
              <p>
                Wir behandeln personenbezogene Daten vertraulich und nach den gesetzlichen Datenschutzvorschriften. Die
                Datenübertragung im Internet kann Sicherheitslücken aufweisen; ein lückenloser Schutz vor dem Zugriff Dritter ist
                nicht möglich.
              </p>

              <h3>Verantwortliche Stelle</h3>
              <address style={{ fontStyle: "normal" }}>
                HiorCraft — Liam Fanenbruck
                <br />
                c/o Online-Impressum 12139
                <br />
                Europaring 90
                <br />
                53757 Sankt Augustin
                <br />
                E-Mail: <a href="mailto:contact@hiorcraft.dev">contact@hiorcraft.dev</a>
              </address>
              <p>
                Verantwortlich ist die natürliche Person, die allein über Zwecke und Mittel der Verarbeitung personenbezogener
                Daten entscheidet.
              </p>

              <h3>Speicherdauer</h3>
              <p>
                Sofern hier keine speziellere Dauer genannt ist, bleiben deine Daten nur so lange gespeichert, wie es für den
                jeweiligen Zweck nötig ist. Machst du ein berechtigtes Löschersuchen geltend oder widerrufst du eine Einwilligung,
                werden die Daten gelöscht, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
              </p>

              <h3>Rechtsgrundlagen</h3>
              <p>
                Mit deiner Einwilligung verarbeiten wir Daten auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO; betrifft die
                Einwilligung den Zugriff auf Informationen in deinem Endgerät, zusätzlich auf Grundlage von § 25 Abs. 1 TDDDG.
                Ohne Einwilligung stützen wir die Verarbeitung auf unser berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) oder
                auf eine rechtliche Verpflichtung (Art. 6 Abs. 1 lit. c DSGVO). Welche Grundlage im Einzelfall gilt, steht in den
                folgenden Abschnitten.
              </p>

              <h3>Empfänger</h3>
              <p>
                Daten geben wir nur weiter, wenn das für die Bereitstellung der Website nötig ist (Hetzner und Cloudflare, siehe
                oben), wenn wir
                gesetzlich dazu verpflichtet sind oder wenn du eingewilligt hast.
              </p>

              <h3>Widerruf deiner Einwilligung</h3>
              <p>
                Viele Verarbeitungen sind nur mit deiner ausdrücklichen Einwilligung möglich. Du kannst eine erteilte Einwilligung
                jederzeit widerrufen. Die Rechtmäßigkeit der bis dahin erfolgten Verarbeitung bleibt unberührt.
              </p>

              <h3>Widerspruchsrecht (Art. 21 DSGVO)</h3>
              <p>
                <strong>
                  Beruht eine Verarbeitung auf Art. 6 Abs. 1 lit. e oder f DSGVO, kannst du aus Gründen, die sich aus deiner
                  besonderen Situation ergeben, jederzeit widersprechen. Wir verarbeiten die betroffenen Daten dann nicht mehr, es
                  sei denn, wir können zwingende schutzwürdige Gründe nachweisen, die deine Interessen, Rechte und Freiheiten
                  überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.
                </strong>
              </p>

              <h3>Beschwerderecht bei der Aufsichtsbehörde</h3>
              <p>
                Bei Verstößen gegen die DSGVO kannst du dich bei einer Aufsichtsbehörde beschweren, insbesondere in dem
                Mitgliedstaat deines gewöhnlichen Aufenthalts, deines Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.
              </p>

              <h3>Recht auf Datenübertragbarkeit</h3>
              <p>
                Daten, die wir auf Grundlage deiner Einwilligung oder zur Erfüllung eines Vertrags automatisiert verarbeiten,
                händigen wir dir oder einem Dritten auf Wunsch in einem gängigen, maschinenlesbaren Format aus, soweit das
                technisch machbar ist.
              </p>

              <h3>Auskunft, Berichtigung und Löschung</h3>
              <p>
                Du hast im Rahmen der gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche Auskunft über deine
                gespeicherten personenbezogenen Daten, ihre Herkunft, Empfänger und den Zweck der Verarbeitung sowie ein Recht auf
                Berichtigung oder Löschung. Dafür und für weitere Fragen genügt eine E-Mail an die oben genannte Adresse.
              </p>

              <h3>Recht auf Einschränkung der Verarbeitung</h3>
              <p>
                Du kannst die Einschränkung der Verarbeitung verlangen, wenn du die Richtigkeit der Daten bestreitest (für die
                Dauer der Prüfung), wenn die Verarbeitung unrechtmäßig war, wir die Daten nicht mehr brauchen, du sie aber zur
                Geltendmachung von Rechtsansprüchen benötigst, oder wenn du Widerspruch eingelegt hast und die Abwägung noch
                aussteht. Eingeschränkte Daten werden dann, abgesehen von ihrer Speicherung, nur noch mit deiner Einwilligung, zur
                Rechtsverfolgung, zum Schutz der Rechte anderer oder aus wichtigem öffentlichem Interesse verarbeitet.
              </p>

              <h3>SSL- bzw. TLS-Verschlüsselung</h3>
              <p>
                Die Seite nutzt eine TLS-Verschlüsselung. Du erkennst sie an „https://“ in der Adresszeile und am Schloss-Symbol.
                Daten, die du an uns überträgst, können dann nicht von Dritten mitgelesen werden.
              </p>
            </section>

            <section className="box how__section" data-tone="white" id="website" aria-labelledby="website-h">
              <h2 className="t-3" id="website-h">
                4. Datenerfassung auf dieser Website
              </h2>
              <h3>Keine Cookies, aber lokaler Speicher</h3>
              <p>
                Diese Website setzt keine eigenen Cookies (zu den Ausnahmefällen bei Cloudflare siehe „Hosting“) und bindet keine
                Analyse- oder Werbedienste ein. Damit sie sich deine
                Einstellungen merkt, legt sie einige wenige Einträge im lokalen Speicher deines Browsers ab (Local Storage bzw.
                Session Storage):
              </p>
              <ul>
                <li>
                  <code>ac-theme</code>: helles oder dunkles Design
                </li>
                <li>
                  <code>ac.fold.v1</code>: welche Bereiche du eingeklappt hast
                </li>
                <li>
                  <code>ac.verbindungen.v2</code>, <code>ac.verbindungen.offen</code>: deine Einstellungen auf der
                  Verbindungen-Seite und welche Abschnitte der Seitenleiste offen sind
                </li>
                <li>
                  <code>ac-twitch-consent</code>: ob Twitch-Streams ohne Rückfrage geladen werden sollen (nur wenn du das angehakt
                  hast)
                </li>
                <li>
                  <code>ac.scroll.v1</code>, <code>ac.adv.tab</code>: Scrollposition beim automatischen Aktualisieren und
                  gewählter Reiter, nur bis zum Schließen des Tabs
                </li>
              </ul>
              <p>
                Diese Einträge verlassen deinen Browser nicht und werden nicht an uns übertragen. Sie sind für die von dir
                gewünschten Funktionen unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Du kannst sie jederzeit über die
                Einstellungen deines Browsers löschen.
              </p>

              <h3>Server-Log-Dateien</h3>
              <p>Beim Aufruf der Seite erfasst der Server automatisch Informationen, die dein Browser übermittelt:</p>
              <ul>
                <li>Browsertyp und -version, verwendetes Betriebssystem</li>
                <li>Referrer-URL und aufgerufene Seite</li>
                <li>Uhrzeit der Anfrage</li>
              </ul>
              <p>
                Deine IP-Adresse wird nur kurz verarbeitet, um die Seite an deinen Browser auszuliefern. In unseren Log-Dateien
                wird sie nicht gespeichert; was Cloudflare dabei verarbeitet, steht unter „Hosting“. Diese Daten werden nicht mit anderen Datenquellen zusammengeführt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f
                DSGVO: Wir haben ein berechtigtes Interesse an einer technisch fehlerfreien und sicheren Bereitstellung der
                Website, wofür die Log-Dateien nötig sind.
              </p>

              <h3>Spielerköpfe, Skins und Clip-Vorschaubilder</h3>
              <p>
                Minecraft-Köpfe und -Skins der Spieler lädt unser Server selbst von craftattack.one, mc-heads.net, minotar.net
                bzw. visage.surgeplay.com, die Vorschaubilder von Twitch-Clips von Twitch, und liefert sie von hier aus. Dein
                Browser verbindet sich dafür nicht mit diesen Diensten; deine IP-Adresse wird ihnen nicht übermittelt. Gleiches
                gilt für die Schriftarten, die direkt von diesem Server kommen.
              </p>

              <h3>Anfrage per E-Mail</h3>
              <p>
                Schreibst du uns eine E-Mail, speichern wir deine Anfrage samt der darin enthaltenen Daten (Name, E-Mail-Adresse,
                Inhalt), um sie zu bearbeiten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der
                Beantwortung) bzw. lit. b, wenn deine Anfrage mit einem Vertrag zusammenhängt. Wir geben diese Daten nicht weiter
                und löschen sie, sobald deine Anfrage erledigt ist, du die Löschung verlangst oder deine Einwilligung widerrufst,
                soweit keine gesetzlichen Aufbewahrungsfristen entgegenstehen.
              </p>

              <h3>Externe Links</h3>
              <p>
                Die Seite verlinkt auf andere Angebote, etwa craftattack.one, Twitch oder GitHub. Erst wenn du einen solchen Link
                anklickst, verbindet sich dein Browser mit dem jeweiligen Anbieter; dort gilt dessen Datenschutzerklärung.
              </p>
            </section>

            <section className="box how__section" data-tone="white" id="twitch" aria-labelledby="twitch-h">
              <h2 className="t-3" id="twitch-h">
                5. Eingebettete Twitch-Streams
              </h2>
              <p>
                Auf einigen Seiten können Streams und Chats von Twitch eingebettet werden. Anbieter ist die Twitch Interactive,
                Inc., 350 Bush Street, 2nd Floor, San Francisco, CA 94104, USA.
              </p>
              <p>
                Wir nutzen dafür eine Zwei-Klick-Lösung: Solange du nicht auf „Stream und Chat laden“ klickst, wird nichts von
                Twitch geladen, auch kein Vorschaubild. Erst nach deinem Klick verbindet sich dein Browser mit den Servern von
                Twitch. Twitch erhält dabei unter anderem deine IP-Adresse und die aufgerufene Seite, kann Cookies setzen und dich,
                wenn du bei Twitch angemeldet bist, deinem Konto zuordnen. Dabei können Daten in die USA übertragen werden.
              </p>
              <p>
                Rechtsgrundlage ist deine Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG. Hakst du „Twitch
                künftig immer laden“ an, merkt sich dein Browser das (siehe oben). Widerrufen kannst du jederzeit über den Link
                „Zustimmung widerrufen“ unter einem geladenen Stream oder indem du den lokalen Speicher deines Browsers löschst.
              </p>
              <p>
                Mehr dazu in der{" "}
                <a href="https://www.twitch.tv/p/de-de/legal/privacy-notice/" target="_blank" rel="noopener">
                  Datenschutzerklärung von Twitch
                </a>
                .
              </p>
            </section>

            <section className="box how__section" data-tone="white" id="tracker" aria-labelledby="tracker-h">
              <h2 className="t-3" id="tracker-h">
                6. Daten über CraftAttack-Spieler und Twitch-Kanäle
              </h2>
              <p>
                Unabhängig von deinem Besuch sammelt der Tracker Daten über die Teilnehmer von CraftAttack und deren Twitch-Kanäle,
                um Statistiken, Bestenlisten und Verläufe darzustellen. Wie das im Detail funktioniert, steht unter{" "}
                <Link href="/so-funktionierts">So funktioniert’s</Link>.
              </p>
              <h3>Welche Daten?</h3>
              <ul>
                <li>
                  Von <strong>craftattack.one</strong>: Spielername, Minecraft-UUID, Online-Status, Spielzeit und weitere
                  Spielstatistiken der Teilnehmer
                </li>
                <li>
                  Von <strong>Twitch</strong> zu den Kanälen der Teilnehmer: Live-Status, Titel, Zuschauer- und Followerzahlen,
                  VODs und Clips
                </li>
                <li>
                  Aus den öffentlichen <strong>Twitch-Chats</strong> der Teilnehmer: Nachrichten, die ein Teilnehmer im Chat eines
                  anderen Teilnehmers schreibt; bei Cheers (Bits) und Abo-Meldungen der Twitch-Name des Absenders und der Umfang
                  der Unterstützung; bei Clips der Name des Erstellers
                </li>
                <li>
                  Für die Zuschauerwanderung werden Twitch-Kennungen anderer Chat-Schreiber nur im Arbeitsspeicher und höchstens
                  90 Minuten gehalten; gespeichert werden nur anonyme Summen
                </li>
              </ul>
              <h3>Zweck und Rechtsgrundlage</h3>
              <p>
                Die Daten stammen aus öffentlich zugänglichen Quellen. Wir verarbeiten sie auf Grundlage unseres berechtigten
                Interesses (Art. 6 Abs. 1 lit. f DSGVO), das öffentliche Geschehen rund um CraftAttack als Fan-Projekt
                auszuwerten und darzustellen. Die Daten werden in der Datenbank beim Hoster gespeichert, solange das Projekt
                läuft.
              </p>
              <p>
                Bist du betroffen, kannst du der Verarbeitung jederzeit widersprechen sowie Auskunft, Berichtigung oder Löschung
                verlangen (siehe „Pflichtinformationen“). Eine E-Mail an{" "}
                <a href="mailto:contact@hiorcraft.dev">contact@hiorcraft.dev</a> genügt.
              </p>
            </section>

            <p className="muted">Stand: November 2026</p>
          </div>
        </div>
      </section>
    </>
  );
}
