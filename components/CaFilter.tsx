import Link from "next/link";
import { CA_HINT, CA_LABEL, CA_MODES, caParam, type CaMode } from "@/lib/onlineSpans";

/**
 * Auswahl „CraftAttack / Alles“ für Zuschauer und Raids (Verbindungen hat dieselbe Auswahl in der Seitenleiste). Steht
 * als `?ca=alle|beide` in der Adresse (ohne = CraftAttack); die Reiter der Community behalten sie beim Wechsel (components/NavLinks.tsx).
 */
export function CaFilter({ path, sp, mode }: { path: string; sp: Record<string, string | string[] | undefined>; mode: CaMode }) {
  const href = (m: CaMode) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "ca" && k !== "server") q.set(k, v);
    if (caParam(m)) q.set("ca", caParam(m));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return (
    <div className="ca-filter">
      <span className="ca-filter__label">Daten</span>
      <div className="gb__seg" role="group" aria-label="Daten">
        {CA_MODES.map((m) => (
          <Link key={m} href={href(m)} aria-current={m === mode ? "true" : undefined} title={CA_HINT[m]} scroll={false} replace>
            {CA_LABEL[m]}
          </Link>
        ))}
      </div>
    </div>
  );
}
