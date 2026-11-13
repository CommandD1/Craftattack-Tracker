import "server-only";
import { getDb } from "./db";
import { getState } from "./store";

/**
 * „Gemeinsam streamen“ (Twitch Stream Together, intern „Guest Star“): wer streamt gerade mit wem?
 *
 * Die offizielle API (`/helix/guest_star/session`) verlangt einen Token des Streamers oder eines Moderators, für
 * fremde Kanäle also nicht nutzbar. twitch.tv selbst liest die Anzeige „Gemeinsam streamen mit …“ über seine
 * GraphQL-Schnittstelle mit der öffentlichen Web-Client-ID, ohne Anmeldung und ohne Integrity-Token. Genau diese
 * Abfragen nutzen wir hier (inoffiziell: kann sich ohne Ankündigung ändern; dann fehlen nur diese Daten).
 *
 * - Live: jede Minute ein Batch für alle Spieler-Kanäle (`guestStarCollaborationStatuses`, wie die Seitenleiste
 *   von twitch.tv). Ergebnis in `costream_sessions` (Beginn, zuletzt gesehen, Ende, Host, alle Beteiligten) und
 *   `costream_presence` (je Beteiligtem: wann dazugekommen, wann gegangen – minutengenau).
 * - Rückwirkend: jeder Clip speichert, wer zur Zeit des Clip-INHALTS mitgestreamt hat (`clip.guestStarParticipants`;
 *   gilt für VOD-Start + vod_offset, nicht für die Erstellzeit – aus dem VOD nachträglich erstellte Clips tragen die
 *   damalige Session). Gäste ohne den Clip-Kanal selbst; Session ohne Gäste = allein; gar keine Session = unbekannt. Alle Clips
 *   in `twitch_clips` werden einmal nachgeschlagen (35 je Anfrage, 1 Anfrage/s) → Spalten `costream_*`.
 * Es werden nur beobachtete Daten gespeichert, nichts geschätzt.
 */

const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const LIVE_MS = 60_000;
const CLIP_BATCH = 35;
const CLIP_PAUSE_MS = 1_000;
const CLIP_CHECK_MS = 30 * 60_000;
const ID_CACHE_MS = 6 * 3600_000;
const CHANNELS_PER_QUERY = 100;
/** Länger nicht gesehen (Neustart, Abfragefehler) → neuer Anwesenheits-Zeitraum statt Überbrückung */
const PRESENCE_GAP_MS = 3 * 60_000;

type Gql = { data?: Record<string, unknown>; errors?: { message: string }[] };

async function gql(body: unknown): Promise<Gql | Gql[]> {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Twitch GQL HTTP ${res.status}`);
  return (await res.json()) as Gql | Gql[];
}

function one(r: Gql | Gql[]): Record<string, unknown> {
  const x = Array.isArray(r) ? r[0] : r;
  if (x?.errors?.length) throw new Error(`Twitch GQL: ${x.errors[0].message}`);
  return x?.data ?? {};
}

/* ---------- Kanal-IDs der Spieler ---------- */

type Globals = typeof globalThis & {
  __acCostream?: { ids: Map<string, string>; idsAt: number; started: boolean; clipsRunning: boolean };
};
function g() {
  const gl = globalThis as Globals;
  if (!gl.__acCostream) gl.__acCostream = { ids: new Map(), idsAt: 0, started: false, clipsRunning: false };
  return gl.__acCostream;
}

/** login (klein) → Twitch-Nutzer-ID, für alle Spieler mit Twitch-Kanal */
async function channelIds(logins: string[]): Promise<Map<string, string>> {
  const c = g();
  const missing = logins.some((l) => !c.ids.has(l));
  if (!missing && Date.now() - c.idsAt < ID_CACHE_MS) return c.ids;
  for (let i = 0; i < logins.length; i += CHANNELS_PER_QUERY) {
    const part = logins.slice(i, i + CHANNELS_PER_QUERY);
    const data = one(await gql({ query: `query($l:[String!]){ users(logins:$l){ id login } }`, variables: { l: part } }));
    for (const u of (data.users as ({ id: string; login: string } | null)[]) ?? []) if (u) c.ids.set(u.login.toLowerCase(), u.id);
  }
  c.idsAt = Date.now();
  return c.ids;
}

async function playerLogins(): Promise<Map<string, string>> {
  const out = new Map<string, string>(); // login → Spieler-ID
  for (const p of Object.values((await getState()).players)) if (p.twitchLogin) out.set(p.twitchLogin.toLowerCase(), p.id);
  return out;
}

/* ---------- Live ---------- */

interface LiveSession {
  key: string;
  host: string;
  logins: string[];
}

/** Laufende Sessions der Spieler-Kanäle; Schlüssel = Session-ID ohne den Kanal-Anhang */
export async function fetchCostreams(channelIdList: string[]): Promise<LiveSession[]> {
  const sessions = new Map<string, LiveSession>();
  for (let i = 0; i < channelIdList.length; i += CHANNELS_PER_QUERY) {
    const ids = channelIdList.slice(i, i + CHANNELS_PER_QUERY);
    const data = one(
      await gql({
        query: `query($ids:[ID!]!){ guestStarCollaborationStatuses(options:{channelIDs:$ids}){ channelCollabs { id session { id host { login } guests { slotID user { login } } } } } }`,
        variables: { ids },
      }),
    );
    const collabs =
      (data.guestStarCollaborationStatuses as { channelCollabs?: { session: { id: string; host: { login: string } | null; guests: { user: { login: string } | null }[] } | null }[] } | null)
        ?.channelCollabs ?? [];
    for (const c of collabs) {
      const s = c.session;
      if (!s?.id) continue;
      const key = s.id.split(":")[0];
      const logins = new Set((sessions.get(key)?.logins ?? []).concat(s.guests.map((x) => x.user?.login?.toLowerCase()).filter((x): x is string => Boolean(x))));
      const host = s.host?.login?.toLowerCase() ?? "";
      if (host) logins.add(host);
      sessions.set(key, { key, host, logins: [...logins].sort() });
    }
  }
  return [...sessions.values()];
}

async function syncLive() {
  const players = await playerLogins();
  if (players.size === 0) return;
  const ids = await channelIds([...players.keys()]);
  const channelIdList = [...players.keys()].map((l) => ids.get(l)).filter((x): x is string => Boolean(x));
  const live = await fetchCostreams(channelIdList);
  const db = await getDb();
  const now = new Date();
  for (const s of live) {
    const pids = [...new Set(s.logins.map((l) => players.get(l)).filter((x): x is string => Boolean(x)))].sort();
    await db.query(
      `INSERT INTO costream_sessions (key, host_login, logins, players, started_at, last_seen_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $5, NULL)
       ON CONFLICT (key) DO UPDATE SET
         logins = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(costream_sessions.logins || EXCLUDED.logins) x),
         players = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(costream_sessions.players || EXCLUDED.players) x),
         last_seen_at = EXCLUDED.last_seen_at, ended_at = NULL`,
      [s.key, s.host, s.logins, pids, now],
    );
  }
  // Nicht mehr gemeldet: beendet (Ende = zuletzt gesehen)
  await db.query(`UPDATE costream_sessions SET ended_at = last_seen_at WHERE ended_at IS NULL AND NOT (key = ANY($1))`, [live.map((s) => s.key)]);

  // Anwesenheit je Beteiligtem: offene Zeiträume verlängern, neue beginnen, nicht mehr gemeldete beenden.
  // Nach einer Lücke (z. B. Tracker-Neustart) länger als PRESENCE_GAP_MS beginnt ein neuer Zeitraum.
  await db.query(`UPDATE costream_presence SET ended_at = last_seen_at WHERE ended_at IS NULL AND last_seen_at < $1`, [new Date(now.getTime() - PRESENCE_GAP_MS)]);
  const keys: string[] = [];
  const logins: string[] = [];
  const pids: (string | null)[] = [];
  const hosts: string[] = [];
  for (const s of live)
    for (const l of s.logins) {
      keys.push(s.key);
      logins.push(l);
      pids.push(players.get(l) ?? null);
      hosts.push(s.host);
    }
  if (keys.length) {
    await db.query(
      `INSERT INTO costream_presence (session_key, login, player, host_login, started_at, last_seen_at)
       SELECT k, l, p, h, $5, $5 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS x(k, l, p, h)
       ON CONFLICT (session_key, login) WHERE ended_at IS NULL DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [keys, logins, pids, hosts, now],
    );
  }
  await db.query(
    `UPDATE costream_presence c SET ended_at = c.last_seen_at
      WHERE c.ended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM unnest($1::text[], $2::text[]) AS x(k, l) WHERE x.k = c.session_key AND x.l = c.login)`,
    [keys, logins],
  );
}

/* ---------- Rückwirkend aus Clips ---------- */

type ClipGuests = { sessionIdentifier: string | null; guests: ({ login: string } | null)[] } | null;

/** Clip-Slug → Gäste beim Clippen (ohne den Clip-Kanal selbst); null = keine Session, undefined = Clip unbekannt */
export async function fetchClipCostreams(slugs: string[]): Promise<Map<string, { session: string | null; guests: string[] } | null>> {
  const res = await gql(
    slugs.map((slug) => ({
      query: `query($s:ID!){ clip(slug:$s){ guestStarParticipants { sessionIdentifier guests { login } } } }`,
      variables: { s: slug },
    })),
  );
  const arr = Array.isArray(res) ? res : [res];
  const out = new Map<string, { session: string | null; guests: string[] } | null>();
  slugs.forEach((slug, i) => {
    const r = arr[i];
    if (!r || r.errors?.length) return;
    const clip = r.data?.clip as { guestStarParticipants: ClipGuests } | null | undefined;
    if (clip === undefined) return;
    const p = clip?.guestStarParticipants ?? null;
    const guests = (p?.guests ?? []).map((x) => x?.login?.toLowerCase()).filter((x): x is string => Boolean(x));
    out.set(slug, guests.length || p?.sessionIdentifier ? { session: p?.sessionIdentifier ?? null, guests: [...new Set(guests)].sort() } : null);
  });
  return out;
}

const slugOf = (url: string) => url.split("/clip/")[1]?.split(/[?#]/)[0] ?? "";

/** Prüft alle noch nicht nachgeschlagenen Clips; läuft, bis keine mehr offen sind. */
async function checkClips() {
  const c = g();
  if (c.clipsRunning) return;
  c.clipsRunning = true;
  const db = await getDb();
  let checked = 0;
  let withGuests = 0;
  const t0 = Date.now();
  try {
    for (;;) {
      const rows = (
        await db.query<{ id: string; url: string }>(
          `SELECT id, url FROM twitch_clips WHERE costream_checked_at IS NULL ORDER BY created_at LIMIT $1`,
          [CLIP_BATCH],
        )
      ).rows;
      if (rows.length === 0) break;
      const found = await fetchClipCostreams(rows.map((r) => slugOf(r.url)));
      const now = new Date();
      for (const r of rows) {
        const f = found.get(slugOf(r.url));
        if (f === undefined) {
          // Clip gelöscht oder Antwort fehlt: als geprüft markieren, ohne Daten
          await db.query(`UPDATE twitch_clips SET costream_checked_at = $2 WHERE id = $1`, [r.id, now]);
          continue;
        }
        if (f) withGuests++;
        await db.query(`UPDATE twitch_clips SET costream_session = $2, costream_guests = $3, costream_checked_at = $4 WHERE id = $1`, [
          r.id,
          f?.session ?? null,
          f?.guests ?? null,
          now,
        ]);
      }
      checked += rows.length;
      await new Promise((r) => setTimeout(r, CLIP_PAUSE_MS));
    }
    if (checked) console.log(`[costream] ${checked} Clips nachgeschlagen, ${withGuests} mit gemeinsamem Stream (${Math.round((Date.now() - t0) / 1000)} s)`);
  } finally {
    c.clipsRunning = false;
  }
}

/* ---------- Start ---------- */

export function startCostreamSync() {
  const c = g();
  if (c.started) return;
  c.started = true;
  let liveRunning = false;
  const live = async () => {
    if (liveRunning) return;
    liveRunning = true;
    try {
      await syncLive();
    } catch (err) {
      console.warn("[costream] Gemeinsam-streamen-Abfrage fehlgeschlagen:", err instanceof Error ? err.message : err);
    } finally {
      liveRunning = false;
    }
  };
  const clips = () =>
    checkClips().catch((err: unknown) => console.warn("[costream] Clip-Abgleich fehlgeschlagen:", err instanceof Error ? err.message : err));
  setTimeout(live, 20_000);
  setInterval(live, LIVE_MS);
  setTimeout(clips, 60_000);
  setInterval(clips, CLIP_CHECK_MS);
}
