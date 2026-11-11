import { NextResponse, type NextRequest } from "next/server";
import { servesWeb } from "@/lib/mode";
import { fitnacraftKeyOk } from "@/lib/fitnacraftKey";

/** Im Modus `tracker` bleiben nur Status- und Poll-Endpunkte erreichbar. */
const TRACKER_ONLY_PATHS = new Set(["/api/tracker", "/api/tracker/poll", "/api/cron/poll"]);

/** FitnaCraft-Rückblick (versteckt): falscher oder fehlender Schlüssel → normale 404, bevor irgendetwas gerendert wird */
function fitnacraftDenied(path: string) {
  if (path !== "/fitnacraft" && !path.startsWith("/fitnacraft/")) return false;
  try {
    return !fitnacraftKeyOk(decodeURIComponent(path.split("/")[2] ?? ""));
  } catch {
    return true;
  }
}

export function proxy(request: NextRequest) {
  if (fitnacraftDenied(request.nextUrl.pathname)) return NextResponse.rewrite(new URL("/_fitnacraft-404", request.url));
  if (servesWeb() || TRACKER_ONLY_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  return NextResponse.json(
    { ok: false, error: "Dieser Prozess läuft mit TRACKER_MODE=tracker und liefert keine Website aus." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
