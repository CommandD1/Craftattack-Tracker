export function FigsSkeleton({ n = 4 }: { n?: number }) {
  return (
    <dl className={`grid st-figs${n === 6 ? " st-figs--6" : ""}`} aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="box st-fig st-fig--sk" data-tone="white">
          <dt>…</dt>
          <dd className="num">00</dd>
        </div>
      ))}
    </dl>
  );
}

export function RowsSkeleton({ n = 6 }: { n?: number }) {
  return (
    <ul className="feed" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="ev">
          <span className="st-sk st-sk--head" style={{ width: 44, height: 44 }} />
          <span className="st-sk st-sk--text" />
          <span className="st-sk st-sk--text" style={{ width: 48 }} />
        </li>
      ))}
    </ul>
  );
}

export function PageSkeleton() {
  return (
    <>
      <section className="block page-head" data-tone="diamond">
        <div className="wrap">
          <p className="eyebrow">Lädt</p>
          <h1 className="t-1">…</h1>
        </div>
      </section>
      <section className="block block--tight" data-tone="ink">
        <div className="wrap">
          <FigsSkeleton />
        </div>
      </section>
    </>
  );
}
