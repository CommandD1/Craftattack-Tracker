"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Head } from "./Head";
import { fuzzyFilter } from "@/lib/fuzzy";

export interface FilterPlayer {
  id: string;
  name: string;
  uuid: string;
  online: boolean;
}

/**
 * Spielerauswahl für Filterseiten: gewählte Spieler als Köpfe (× entfernt), daneben eine Suche mit Vorschlägen
 * (online zuerst). Mehrere Spieler sind möglich; die Auswahl landet als `spieler=a,b` in der URL.
 */
export function PlayerFilter({ players, selected, path, query }: { players: FilterPlayer[]; selected: string[]; path: string; query: Record<string, string | undefined> }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const href = (ids: string[]) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
    if (ids.length) p.set("spieler", ids.join(","));
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };
  const suggestions = useMemo(() => {
    return fuzzyFilter(
      players.filter((p) => !selected.includes(p.id)),
      search,
      (p) => [p.name, p.id],
      (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "de"),
    ).slice(0, 12);
  }, [players, selected, search]);
  const add = (id: string) => {
    setSearch("");
    router.push(href([...selected, id]), { scroll: false });
  };

  return (
    <div className="pfilter">
      {selected.length > 0 && (
        <ul className="pfilter__chips" aria-label="Gewählte Spieler">
          {selected.map((id) => {
            const p = byId.get(id);
            return (
              <li key={id}>
                <Link className="tag tag--head" data-tone="white" href={href(selected.filter((x) => x !== id))} scroll={false} aria-label={`${p?.name ?? id} entfernen`}>
                  <Head id={id} uuid={p?.uuid} name={p?.name ?? id} size={20} src={32} decorative /> {p?.name ?? id} <span aria-hidden="true">×</span>
                </Link>
              </li>
            );
          })}
          {selected.length > 1 && (
            <li>
              <Link className="tag" data-tone="white" href={href([])} scroll={false}>
                Alle entfernen
              </Link>
            </li>
          )}
        </ul>
      )}
      <div className="pfilter__search">
        <input
          type="search"
          placeholder={selected.length ? "+ weiterer Spieler" : "Spieler suchen …"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions[0]) {
              e.preventDefault();
              add(suggestions[0].id);
            }
          }}
          aria-label="Spieler suchen"
        />
        {(open || search) && (
          <ul className="pfilter__suggest" aria-label="Vorschläge">
            {suggestions.map((p) => (
              <li key={p.id}>
                <button type="button" className="tag tag--head" data-tone="white" onMouseDown={(e) => e.preventDefault()} onClick={() => add(p.id)}>
                  <Head id={p.id} uuid={p.uuid} name={p.name} size={20} src={32} decorative /> {p.name}
                  {p.online && <span className="dot" title="online" />}
                </button>
              </li>
            ))}
            {suggestions.length === 0 && <li className="muted">Niemand gefunden.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
