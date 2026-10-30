"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Head } from "./Head";
import { fuzzyFilter } from "@/lib/fuzzy";

export interface PickPlayer {
  id: string;
  name: string;
  uuid?: string;
  online?: boolean;
  /** Weitere Suchbegriffe (z. B. Twitch-Login) */
  alias?: string | null;
}

/**
 * Spielerauswahl als unscharfe Suche statt langer Liste: tippen, mit Pfeiltasten wählen, Enter übernimmt.
 * Gesteuert (`value` + `onChange`) oder als Formularfeld (`name` + `defaultValue`, optional sofort absenden).
 * `empty` ist der Eintrag für „keiner/alle“ mit eigenem Wert (Standard "").
 */
export function PlayerSearch({
  players,
  value,
  defaultValue,
  onChange,
  name,
  label,
  placeholder = "Spieler suchen …",
  empty,
  submitOnPick = false,
  limit = 12,
}: {
  players: PickPlayer[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  name?: string;
  label: string;
  placeholder?: string;
  empty?: { label: string; value?: string };
  submitOnPick?: boolean;
  limit?: number;
}) {
  const [own, setOwn] = useState(defaultValue ?? empty?.value ?? "");
  const current = value ?? own;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const emptyValue = empty?.value ?? "";
  const selected = byId.get(current);

  const results = useMemo(
    () =>
      fuzzyFilter(players, query, (p) => [p.name, p.id, p.alias], (a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || a.name.localeCompare(b.name, "de")).slice(0, limit),
    [players, query, limit],
  );
  const options: { id: string; label: string; p?: PickPlayer }[] = [...(empty && !query ? [{ id: emptyValue, label: empty.label }] : []), ...results.map((p) => ({ id: p.id, label: p.name, p }))];

  const pick = (id: string) => {
    if (value === undefined) setOwn(id);
    onChange?.(id);
    setQuery("");
    setOpen(false);
    input.current?.blur();
    if (submitOnPick) {
      const form = input.current?.form;
      // Erst nach dem Rendern, damit das versteckte Feld schon den neuen Wert hat
      if (form) setTimeout(() => form.requestSubmit(), 0);
    }
  };

  const shown = open ? query : selected ? selected.name : current === emptyValue && empty ? empty.label : current;

  return (
    <div className="psearch" data-open={open || undefined}>
      {name && <input type="hidden" name={name} value={current} />}
      <span className="psearch__field">
        {!open && selected && <Head id={selected.id} uuid={selected.uuid} name={selected.name} size={20} src={32} decorative />}
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={shown}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(0);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (options[active]) pick(options[active].id);
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
        />
      </span>
      {open && (
        <ul className="psearch__list" id={listId} role="listbox" aria-label={`${label}: Vorschläge`}>
          {options.map((o, i) => (
            <li
              key={o.id || "_empty"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-current={o.id === current || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.id)}
            >
              {o.p ? <Head id={o.p.id} uuid={o.p.uuid} name={o.p.name} size={20} src={32} decorative /> : <span className="psearch__none" aria-hidden="true" />}
              <span>{o.label}</span>
              {o.p?.online && <span className="dot" title="online" />}
            </li>
          ))}
          {options.length === 0 && <li className="muted psearch__empty">Niemand gefunden.</li>}
        </ul>
      )}
    </div>
  );
}
