import Link from "next/link";
import { Icon } from "./Icons";
import { SOCIALS } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site-foot" data-tone="ender">
      <div className="wrap site-foot__in">
        <div>
          <img className="site-foot__logo" src="/img/ca14-logo-320.webp" alt="" width={320} height={320} loading="lazy" decoding="async" />
          <p className="site-foot__brand">
            Craft
            <wbr />
            Attack Tracker
          </p>
          <p>
            Inoffizielles Fan-Projekt. Zahlen kommen von{" "}
            <a href="https://craftattack.one/api/stats" target="_blank" rel="noopener">
              craftattack.one
            </a>
            , der Rest wird hier daraus abgeleitet.
          </p>
        </div>
        <ul className="site-foot__nav">
          <li>
            <Link href="/">Übersicht</Link>
          </li>
          <li>
            <Link href="/ereignisse">Ereignisse</Link>
          </li>
          <li>
            <Link href="/spieler">Spieler</Link>
          </li>
          <li>
            <Link href="/live">Live</Link>
          </li>
          <li>
            <a href="/api/tracker">JSON-API</a>
          </li>
          <li>
            <a href="https://craftattack.one/" target="_blank" rel="noopener">
              Offizielle Seite
            </a>
          </li>
        </ul>
        <div className="site-foot__legal">
          {SOCIALS.some((s) => s.href) && (
            <ul className="site-foot__social" aria-label="Links">
              {SOCIALS.filter((s) => s.href).map((s) => {
                const I = Icon[s.key];
                return (
                  <li key={s.key}>
                    <a href={s.href} target="_blank" rel="noopener" aria-label={s.label} title={s.label}>
                      <I aria-hidden="true" />
                      <span>{s.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          <p>
            Der Tracker fragt die API alle 30 Sekunden ab. Alles, was dazwischen passiert, bleibt ein
            Geheimnis.
          </p>
          <p>
            Gebaut von{" "}
            <a href="https://hiorcraft.dev" target="_blank" rel="noopener">
              HiorCraft
            </a>{" "}
            mit <span className="heart">♥</span> und Unterstützung durch KI (Claude). Nicht mit
            CraftAttack oder den Creatorn verbunden.
          </p>
        </div>
      </div>
    </footer>
  );
}
