import Link from "next/link";
import { CA_HINT, CA_LABEL, CA_MODES, type CaMode } from "@/lib/onlineSpans";

/**
 * Auswahl „nur CraftAttack“ für Zuschauer und Raids (Verbindungen hat dieselbe Auswahl in der Seitenleiste). Steht
 * als `?ca=einer|beide` in der Adresse; die Reiter der Community behalten sie beim Wechsel (components/NavLinks.tsx).
 */
export function CaFilter({ path, sp, mode }: { path: string; sp: Record<string, string | string[] | undefined>; mode: CaMode }) {
  const href = (m: CaMode) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "ca" && k !== "server") q.set(k, v);
    if (m !== "alle") q.set("ca", m);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return (
    <div className="ca-filter">
      <span className="ca-filter__label">Nur CraftAttack</span>
      <div className="gb__seg" role="group" aria-label="Nur CraftAttack">
        {CA_MODES.map((m) => (
          <Link key={m} href={href(m)} aria-current={m === mode ? "true" : undefined} title={CA_HINT[m]} scroll={false} replace>
            {CA_LABEL[m]}
          </Link>
        ))}
      </div>
    </div>
  );
}
