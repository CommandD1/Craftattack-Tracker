import Link from "next/link";
import { SCOPE_HINT, SCOPE_LABEL, type Scope } from "@/lib/craftScope";

/**
 * Auswahl „CraftAttack / Alles“ (lib/craftScope.ts) als zwei Links; steht als `?wo=alles` in der Adresse,
 * CraftAttack ist der Standard. `hash` springt zurück zum Abschnitt.
 */
export function ScopeToggle({ path, scope, hash, keep }: { path: string; scope: Scope; hash?: string; keep?: Record<string, string | undefined> }) {
  const href = (sc: Scope) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep ?? {})) if (v && k !== "wo") q.set(k, v);
    if (sc === "alles") q.set("wo", "alles");
    const s = q.toString();
    return `${path}${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
  };
  return (
    <span className="gb__seg scope-toggle" role="group" aria-label="Daten">
      {(["ca", "alles"] as const).map((sc) => (
        <Link key={sc} href={href(sc)} aria-current={sc === scope ? "true" : undefined} title={SCOPE_HINT[sc]} scroll={false} replace>
          {SCOPE_LABEL[sc]}
        </Link>
      ))}
    </span>
  );
}
