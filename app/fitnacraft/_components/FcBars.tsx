/**
 * Einfache Säulen (z. B. Stream-Zeit je Uhrzeit oder je Tag), ohne Client-Code: Tooltip über `.tip`/`data-tip`.
 * Eine Reihe, eine Farbe (`--fc-bar`, Standard: Präsenz-Ton der Seite).
 */
export function FcBars({ values, labels, tips, label, tickEvery = 1, color }: { values: number[]; labels: string[]; tips: string[]; label: string; tickEvery?: number; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="fc-bars" role="img" aria-label={label} style={color ? ({ "--fc-bar": color } as React.CSSProperties) : undefined}>
      <div className="fc-bars__plot">
        {values.map((v, i) => (
          <span key={i} className="fc-bars__col tip" data-tip={tips[i]} data-edge={i < values.length * 0.15 ? "left" : i > values.length * 0.85 ? "right" : undefined} tabIndex={0}>
            <span className="fc-bars__bar" style={{ height: `${(v / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="fc-bars__axis num" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={i}>{i % tickEvery === 0 ? l : ""}</span>
        ))}
      </div>
    </div>
  );
}
