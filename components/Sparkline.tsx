export function Sparkline({
  values,
  width = 300,
  height = 64,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line x1="0" y1={height - 2} x2={width} y2={height - 2} className="spark__line" opacity=".3" />
      </svg>
    );
  }
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const pad = 4;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none">
      <path d={area} className="spark__area" />
      <path d={line} className="spark__line" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="4" className="spark__dot" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
