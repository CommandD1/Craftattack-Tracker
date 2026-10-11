import { notFound } from "next/navigation";

/** Die Netzwerk-Seite wurde entfernt; alte Links laufen auf 404. */
export default function Page() {
  notFound();
}
