import type { Metadata } from "next";
import "../vorschau.css";

// Versteckte Vorschau neuer Funktionen: nicht verlinkt, nicht in Suchmaschinen, kein Referrer nach außen
export const metadata: Metadata = {
  title: { default: "Vorschau", template: "%s · Vorschau" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function VorschauLayout({ children }: LayoutProps<"/vorschau/[key]">) {
  return <div className="vs">{children}</div>;
}
