"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Übersicht" },
  { href: "/ereignisse", label: "Ereignisse" },
  { href: "/spieler", label: "Spieler" },
  { href: "/bestenlisten", label: "Bestenlisten" },
  { href: "/statistik", label: "Statistik" },
  { href: "/zeitstrahl", label: "Zeitstrahl" },
  { href: "/live", label: "Live" },
  { href: "/events", label: "Events" },
  { href: "/konto", label: "Mein Konto" },
] as const;

function List({ path }: { path: string | null }) {
  return (
    <ul className="nav">
      {LINKS.map((l) => {
        const active = path !== null && (l.href === "/" ? path === "/" : path.startsWith(l.href));
        return (
          <li key={l.href}>
            <Link href={l.href} aria-current={active ? "page" : undefined}>
              {l.label}
            </Link>
          </li>
        );
      })}
      <li>
        <a className="nav__ext" href="https://craftattack.one/stats/" target="_blank" rel="noopener">
          Original
        </a>
      </li>
      <li className="nav__theme">
        <ThemeToggle />
      </li>
    </ul>
  );
}

/** `static` rendert die Liste ohne aktiven Zustand (Suspense-Fallback fürs Prerendering). */
export function NavLinks({ static: isStatic = false }: { static?: boolean }) {
  if (isStatic) return <List path={null} />;
  return <ActiveList />;
}

function ActiveList() {
  const path = usePathname();
  return <List path={path} />;
}
