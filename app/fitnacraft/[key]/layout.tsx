import type { Metadata } from "next";
import "../fitnacraft.css";

// Versteckt: nicht verlinkt, nicht in Suchmaschinen, kein Referrer nach außen
export const metadata: Metadata = {
  title: { default: "FitnaCraft-Rückblick", template: "%s · FitnaCraft-Rückblick" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function FitnacraftLayout({ children }: LayoutProps<"/fitnacraft/[key]">) {
  return <div className="fc">{children}</div>;
}
