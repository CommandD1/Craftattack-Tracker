import type { Metadata } from "next";
import { AccountFiles } from "@/components/AccountFiles";

export const metadata: Metadata = { title: "Mein Konto" };

export default function AccountPage() {
  return (
    <section className="block page-head" data-tone="paper">
      <div className="wrap wrap--narrow">
        <p className="eyebrow">Persönlicher Bereich</p>
        <h1 className="t-2">Mein Konto</h1>
        <p className="lead">Melde dich an, um deine privaten Dateien abzulegen und herunterzuladen.</p>
        <AccountFiles />
      </div>
    </section>
  );
}
