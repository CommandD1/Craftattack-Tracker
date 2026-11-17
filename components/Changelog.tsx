import Link from "next/link";
import { CHANGELOG } from "@/lib/changelog";

const SHOWN = 6;

function Item({ e }: { e: (typeof CHANGELOG)[number] }) {
  return (
    <li className="changelog__item">
      <time className="changelog__date num">{e.date}</time>
      <div>
        <Link className="changelog__title" href={e.href}>
          {e.title}
        </Link>
        <p className="changelog__text">{e.text}</p>
      </div>
    </li>
  );
}

/** „Neu auf der Seite“: neue Auswertungen und Ansichten, neueste zuerst, jeweils mit Link */
export function Changelog() {
  const older = CHANGELOG.slice(SHOWN);
  return (
    <div className="box spark-card" data-tone="white">
      <div className="spark-card__head">
        <h3 className="eyebrow">Neu auf der Seite</h3>
      </div>
      <ol className="changelog">
        {CHANGELOG.slice(0, SHOWN).map((e) => (
          <Item key={e.date + e.title} e={e} />
        ))}
      </ol>
      {older.length > 0 && (
        <details className="changelog__more">
          <summary>Ältere ({older.length})</summary>
          <ol className="changelog">
            {older.map((e) => (
              <Item key={e.date + e.title} e={e} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
