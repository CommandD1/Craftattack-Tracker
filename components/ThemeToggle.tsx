"use client";

import { useSyncExternalStore } from "react";

const KEY = "ac-theme";
type Theme = "light" | "dark";

/** Liest das Thema, das `ThemeScript` schon vor dem ersten Paint ans <html> gehängt hat. */
function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Änderungen am data-theme-Attribut beobachten, damit der Button immer den echten Zustand zeigt */
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, current, () => "light");

  const toggle = () => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  };

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-btn"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln"}
      title={dark ? "Helles Design" : "Dunkles Design"}
    >
      {dark ? (
        // Sonne
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
        </svg>
      ) : (
        // Mond
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M14 3a9 9 0 1 0 7 14.5A8 8 0 0 1 14 3z" />
        </svg>
      )}
    </button>
  );
}

/**
 * Setzt das gespeicherte Thema vor dem ersten Paint, damit es beim Laden nicht hell aufblitzt.
 * Standard ist hell; dunkel nur, wenn der Nutzer es gewählt hat.
 */
export function ThemeScript() {
  const js = `try{if(localStorage.getItem(${JSON.stringify(KEY)})==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
