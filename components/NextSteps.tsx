"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOUR, nextFor, type Step } from "@/lib/tour";

function Card({ s, kind }: { s: Step; kind: "primary" | "secondary" }) {
  return (
    <Link className="box next-card" data-kind={kind} data-tone={kind === "primary" ? "diamond" : "white"} href={s.href}>
      <span className="eyebrow">{kind === "primary" ? "Nächste Station" : "Passt dazu"}</span>
      <span className="next-card__title t-3">{s.title} →</span>
      {s.why && <span className="next-card__why">{s.why}</span>}
    </Link>
  );
}

/** „Weiter“ am Ende jeder Seite: nächste Station des Rundgangs (lib/tour.ts) und eine passende Seite */
export function NextSteps() {
  const path = usePathname();
  const plan = path ? nextFor(path) : null;
  if (!plan || (!plan.primary && !plan.secondary && !plan.done)) return null;
  return (
    <section className="block next-steps" data-tone="paper" aria-labelledby="weiter-h">
      <div className="wrap">
        <div className="next-steps__head">
          <h2 className="t-2" id="weiter-h">
            {plan.done ? "Geschafft" : "Weiter"}
          </h2>
          {plan.step !== null && (
            <nav className="tour" aria-label={`Rundgang, Station ${plan.step} von ${TOUR.length}`}>
              <span className="eyebrow">
                Rundgang {plan.step}/{TOUR.length}
              </span>
              <ol className="tour__dots">
                {TOUR.map((s, i) => (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      title={s.title}
                      data-state={i + 1 < plan.step! ? "past" : i + 1 === plan.step ? "here" : "next"}
                      aria-current={i + 1 === plan.step ? "step" : undefined}
                    >
                      <span className="sr-only">{s.title}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>
        <div className="next-steps__grid">
          {plan.done && (
            <div className="box next-card next-card--done" data-tone="gold">
              <span className="eyebrow">Rundgang komplett</span>
              <span className="next-card__title t-3">Du hast alles Wichtige gesehen.</span>
              <span className="next-card__why">
                Was danach passiert, steht auf der Übersicht unter „Zuletzt passiert“. Beim nächsten Besuch zeigt dir die Zahl an „Verlauf“, wie viel
                dazugekommen ist. Was sich an der Seite selbst ändert, steht im <Link href="/changelog">Changelog</Link>.
              </span>
            </div>
          )}
          {plan.primary && <Card s={plan.primary} kind="primary" />}
          {plan.secondary && <Card s={plan.secondary} kind="secondary" />}
        </div>
      </div>
    </section>
  );
}
