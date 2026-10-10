/** Kennzahl in einer Kachel; `data-len` steuert per CSS die Schriftgröße, damit lange Zahlen reinpassen. */
export function FigValue({ children }: { children: string }) {
  const len = Math.min(10, Math.max(1, children.length));
  return (
    <dd className="num" data-len={len >= 6 ? String(len) : undefined}>
      {children}
    </dd>
  );
}
