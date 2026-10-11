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
        <li key={i} className="feed__min">
          <span className="st-sk st-sk--text" style={{ width: 40 }} />
          <ul className="tiles">
            {Array.from({ length: 1 + (i % 3) }).map((_, j) => (
              <li key={j} className="tile" data-tone="paper">
                <span className="st-sk st-sk--head" style={{ width: 32, height: 32, margin: 2 }} />
                <span className="st-sk st-sk--text" style={{ width: 40 }} />
              </li>
            ))}
          </ul>
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
