import { permanentRedirect } from "next/navigation";

/** Der Zeitraffer ist Teil des Zeitstrahls geworden; alte Links bleiben gültig. */
export default async function Page(props: PageProps<"/zeitraffer">) {
  const sp = await props.searchParams;
  const tag = typeof sp.tag === "string" ? `?tag=${encodeURIComponent(sp.tag)}` : "";
  permanentRedirect(`/zeitstrahl${tag}#zeitraffer`);
}
