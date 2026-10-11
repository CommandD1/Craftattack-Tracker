import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ThemeScript } from "@/components/ThemeToggle";

const monocraft = localFont({
  src: "../public/fonts/monocraft-bold.woff2",
  variable: "--font-monocraft",
  weight: "400 700",
  display: "swap",
  declarations: [{ prop: "size-adjust", value: "80%" }],
});

const bricolage = localFont({
  src: "../public/fonts/bricolage-grotesque.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CraftAttack 14 Tracker",
    template: "%s · CraftAttack 14 Tracker",
  },
  description:
    "Inoffizieller Tracker für CraftAttack 14: Wer ist online, wer streamt, wer stirbt – und wann genau es passiert ist.",
  icons: { icon: "/img/favicon.png", apple: "/img/favicon.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // suppressHydrationWarning: Browser-Erweiterungen (z. B. Night Eye) hängen Attribute ans <html>
  return (
    <html
      lang="de"
      data-scroll-behavior="smooth"
      className={`${monocraft.variable} ${bricolage.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeScript />
        <a className="skip" href="#inhalt">
          Zum Inhalt
        </a>
        <SiteHeader />
        <main id="inhalt">{children}</main>
        <SiteFooter />
        <AutoRefresh intervalMs={30_000} />
      </body>
    </html>
  );
}
