/** Kennzahl in einer Kachel; `data-len` steuert per CSS die Schriftgröße, damit lange Zahlen reinpassen. */
export function FigValue({ children, unit }: { children: string; unit?: string | null }) {
  // Die Einheit wird kleiner gesetzt und zählt nur halb zur Länge
  const len = Math.min(10, Math.max(1, children.length + Math.ceil((unit?.length ?? 0) / 2)));
  return (
    <dd className="num" data-len={len >= 6 ? String(len) : undefined}>
      {children}
      {unit && <span className="unit"> {unit}</span>}
    </dd>
  );
}
