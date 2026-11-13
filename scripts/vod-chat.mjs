#!/usr/bin/env node
/**
 * Twitch-Chat aus VODs nachtragen (Dauerdienst, langsam im Hintergrund).
 *
 *   DATABASE_URL=… node scripts/vod-chat.mjs [--deadline 2026-11-30T00:00:00Z] [--once]
 *
 * Liest die Chat-Wiedergabe der Archiv-VODs (twitch_vods, siehe lib/twitchHistory.ts) über die GQL-Schnittstelle der
 * Twitch-Website, die der Tracker auch für Follower-Zahlen nutzt. Nur Seiten nach Zeitpunkt (Seiten per Cursor
 * verlangen eine Integritätsprüfung, die wird nicht umgangen). Ältestes zuerst, alle Kanäle zeitlich gleichauf.
 *
 * Gelesen wird nur, was der Live-Chat (lib/twitchIrc.ts) nicht hat: alles vor CHAT_START (Chat zwischen Spielern
 * erst ab da, Abos ab dem 14.10.) und danach Zeitfenster, in denen der Live-Chat nichts aufgezeichnet hat.
 *
 * Aus den Zeilen der Wiedergabe:
 * - „X subscribed at Tier 1 / with Prime. They've subscribed for N months!“ → twitch_subs (sub/resub)
 * - „X is gifting N Tier 1 Subs to …'s community!“ und „X gifted a Tier 1 sub to Y!“ → twitch_subs (Geschenke)
 * - Cheermotes („Cheer100“) → twitch_cheers
 * - „N raiders from X have joined!“ → Raid-Ereignis mit Zuschauerzahl (nur Raids zwischen Spielern, wie live)
 * - Nachrichten von Spielern im Chat eines anderen Spielers → twitch_chat_messages und Chat-Ereignis
 * Auf dem Server (Zuschauer-Abo-Minuten, Cheer-Ereignisse) gilt, wenn der Streamer laut Verlauf online war.
 * Doppelte gegenüber dem Live-Chat werden über Inhalt und Zeitnähe erkannt und übersprungen.
 *
 * Tempo: so schnell wie vertretbar (MIN_DELAY_MS zwischen zwei Anfragen), damit nichts verloren geht, bevor Twitch
 * oder der Streamer das VOD löscht. Bei Fehlern lange Pausen, bei 429 wird der Abstand größer. Fortschritt in
 * vod_chat_progress. Die Frist dient nur noch der Anzeige.
 *
 * Reihenfolge nach Ablaufrisiko: zuerst Kanäle, die VODs schon vorzeitig gelöscht haben (verschwinden oft nach einem
 * Tag), dann Kanäle mit kurzer Aufbewahrung (7 Tage), dann alle übrigen nach Ablaufdatum (Partner: 60 Tage).
 */
import pg from "pg";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const DEADLINE = Date.parse(opt("deadline", process.env.VOD_CHAT_DEADLINE ?? "2026-11-30T00:00:00Z"));
const ONCE = args.includes("--once");
/** Zum Ausprobieren: nach so vielen Anfragen aufhören */
const MAX_REQUESTS = Number(opt("max", "0"));
const SEASON_START = Date.parse(process.env.CA_SEASON_START ?? "2026-10-10T10:00:00Z");
/** Ab hier zeichnet der Live-Chat Nachrichten zwischen Spielern auf (vorher alles aus der Wiedergabe) */
const CHAT_START = Date.parse(process.env.VOD_CHAT_FULL_UNTIL ?? "2026-10-19T10:06:00Z");
/** Ohne Live-Aufzeichnung so lange (global, über alle Kanäle) gilt der Live-Chat als aus */
const IRC_GAP_MS = 30 * 60_000;
/** Neueste Stunden noch nicht lesen (Live-Chat ist dort zuständig, VODs wachsen noch) */
const RECENT_MS = 3 * 3600_000;
const MIN_DELAY_MS = Number(process.env.VOD_CHAT_MIN_DELAY_MS ?? 1_000);
/** Aufbewahrung von VODs bei Twitch: Partner (und Turbo/Prime) 60 Tage, sonst 7 */
const DAY_MS = 86400_000;
const LONG_KEEP_MS = 60 * DAY_MS;
const SHORT_KEEP_MS = 7 * DAY_MS;
/** VOD gilt als nicht mehr gelistet, wenn die VOD-Liste (alle 30 Min) es so lange nicht mehr gesehen hat */
const UNLISTED_MS = 3 * 3600_000;
const MAX_DELAY_MS = 60_000;
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const CHEER_EVENT_MIN_BITS = Number(process.env.CA_CHEER_EVENT_MIN ?? 1000);
const CHAT_EVENT_MAX_LENGTH = 300;
/** Bekannte Cheermote-Präfixe (Twitch); Wort = Präfix + Zahl */
const CHEERMOTE = /^(cheer|doodlecheer|biblethump|cheerwhal|corgo|scoops|uni|showlove|party|seemsgood|pride|kappa|frankerz|heyguys|dansgame|elegiggle|trihard|kreygasm|4head|swiftrage|notlikethis|failfish|vohiyo|pjsalt|mrdestructoid|bday|ripcheer|shamrock|bitboss|streamlabs|muxy|holidaycheer|goal|anon|charity|hypecheer)(\d+)$/i;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL fehlt");
const ssl = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false };
const db = new pg.Pool({ connectionString: url, ssl, max: 2, application_name: "actracker-vod-chat" });
const q = (sql, params) => db.query(sql, params);
const log = (...a) => console.log(`[vod-chat]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);

await q(`ALTER TABLE IF EXISTS vod_chat_progress ADD COLUMN IF NOT EXISTS read_s integer NOT NULL DEFAULT 0`);
await q(`
  CREATE TABLE IF NOT EXISTS vod_chat_progress (
    vod_id     text PRIMARY KEY,
    player     text NOT NULL,
    position_s integer NOT NULL DEFAULT 0,
    done       boolean NOT NULL DEFAULT false,
    requests   integer NOT NULL DEFAULT 0,
    read_s     integer NOT NULL DEFAULT 0,
    comments   integer NOT NULL DEFAULT 0,
    found      jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);

/* ---------- Was gelesen werden muss ---------- */

/** Zeitfenster ohne Live-Chat nach CHAT_START (keine Abo-, Chat- oder Raid-Zeile aus dem Live-Chat) */
async function ircOutages() {
  // Seit der Tracker die Mitschrift festhält (irc_uptime), übernimmt fillGaps(); die Schätzung gilt nur davor
  const first = (await q(`SELECT min(minute) AS m FROM irc_uptime`).catch(() => ({ rows: [] }))).rows[0]?.m;
  const cap = first == null ? Infinity : Number(first) * 60_000;
  // Ereignisse aus dem Live-Chat (Abo-Minuten gibt es seit dem 14.10., die Einzel-Abos erst seit dem 29.10.)
  const rows = (
    await q(
      `SELECT at AS t FROM events
        WHERE type IN ('subscription', 'subscription_gift', 'cheer', 'raid', 'chat') AND at >= $1
          AND coalesce(meta->>'source', '') <> 'vod' AND coalesce(meta->>'estimated', '') <> 'true'
        ORDER BY at`,
      [new Date(CHAT_START)],
    )
  ).rows.map((r) => r.t.getTime());
  const out = [];
  let prev = CHAT_START;
  for (const t of [...rows.filter((x) => x < cap), Math.min(Date.now() - RECENT_MS, cap)]) {
    if (t - prev > IRC_GAP_MS) out.push([prev, t]);
    prev = Math.max(prev, t);
  }
  return out;
}

/** Je VOD die Abschnitte (Sekunden ab VOD-Beginn), die gelesen werden müssen */
async function plan() {
  const outages = await ircOutages();
  // Je Kanal: Aufbewahrung (ältestes noch gelistetes VOD) und ob schon VODs vorzeitig verschwunden sind
  const channels = new Map(
    (
      await q(
        `SELECT player,
                max(extract(epoch FROM now() - created_at)) FILTER (WHERE fetched_at > now() - make_interval(secs => $1)) AS oldest_listed_s,
                bool_or(fetched_at <= now() - make_interval(secs => $1) AND created_at > now() - interval '50 days') AS deletes
           FROM twitch_vods GROUP BY player`,
        [UNLISTED_MS / 1000],
      )
    ).rows.map((r) => [r.player, { long: Number(r.oldest_listed_s ?? 0) >= 8 * 86400, deletes: r.deletes === true }]),
  );
  const vods = (
    await q(
      `SELECT v.id, v.player, v.login, v.created_at, v.duration_s, coalesce(p.position_s, 0) AS position_s, coalesce(p.done, false) AS done
         FROM twitch_vods v LEFT JOIN vod_chat_progress p ON p.vod_id = v.id
        WHERE v.created_at + make_interval(secs => v.duration_s) >= $1
        ORDER BY v.created_at`,
      [new Date(SEASON_START)],
    )
  ).rows;
  const limit = Date.now() - RECENT_MS;
  const work = [];
  for (const v of vods) {
    if (v.done) continue;
    const start = v.created_at.getTime();
    const end = Math.min(start + v.duration_s * 1000, limit);
    const ranges = [];
    // Chat vor dem Staffelbeginn (Stunden vor 12 Uhr) ist uninteressant
    if (start < CHAT_START) ranges.push([Math.max(start, SEASON_START - 2 * 3600_000), Math.min(end, CHAT_START)]);
    for (const [a, b] of outages) if (b > start && a < end) ranges.push([Math.max(a, start, CHAT_START), Math.min(b, end)]);
    const sec = ranges
      .filter(([a, b]) => b > a)
      .map(([a, b]) => [Math.floor((a - start) / 1000), Math.ceil((b - start) / 1000)])
      .map(([a, b]) => [Math.max(a, v.position_s), b])
      .filter(([a, b]) => b > a);
    const finished = start + v.duration_s * 1000 < limit;
    const ch = channels.get(v.player) ?? { long: false, deletes: false };
    // Spätester sicherer Zeitpunkt: löschfreudige Kanäle sofort nach dem Ende, sonst nach Aufbewahrung
    const expires = ch.deletes ? start + v.duration_s * 1000 + DAY_MS / 2 : start + (ch.long ? LONG_KEEP_MS : SHORT_KEEP_MS);
    work.push({ ...v, start, ranges: sec, finished, expires, risk: ch.deletes ? 0 : ch.long ? 2 : 1 });
  }
  return work;
}

/* ---------- Spieler und Zustand ---------- */

let players = new Map();
let byLogin = new Map();
async function loadPlayers() {
  const rows = (await q(`SELECT id, name, uuid, twitch_login FROM players`)).rows;
  players = new Map(rows.map((r) => [r.id, r]));
  byLogin = new Map(rows.filter((r) => r.twitch_login).map((r) => [r.twitch_login.toLowerCase(), r]));
  for (const r of rows) if (!byLogin.has(r.id.toLowerCase())) byLogin.set(r.id.toLowerCase(), r);
}

/** War der Streamer zu dem Zeitpunkt auf dem Server? (letzter Verlaufspunkt davor, höchstens 3 Min alt) */
const onlineCache = new Map();
async function onServer(player, t) {
  const key = `${player}|${Math.floor(t / 60_000)}`;
  if (onlineCache.has(key)) return onlineCache.get(key);
  const r = (await q(`SELECT at, online FROM player_history WHERE player = $1 AND at <= $2 ORDER BY at DESC LIMIT 1`, [player, new Date(t)])).rows[0];
  const v = Boolean(r && r.online && t - r.at.getTime() <= 3 * 60_000);
  if (onlineCache.size > 50_000) onlineCache.clear();
  onlineCache.set(key, v);
  return v;
}

/** Laufender Stream laut VOD (für streamStartedAt der Abo-Minuten) */
async function streamStart(player, t) {
  const r = (await q(`SELECT created_at FROM twitch_vods WHERE player = $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 1`, [player, new Date(t)])).rows[0];
  return r ? r.created_at.toISOString() : null;
}

/* ---------- Twitch ---------- */

class Blocked extends Error {}

async function fetchComments(vodId, offset) {
  const body = {
    query: `query { video(id: "${vodId}") { comments(contentOffsetSeconds: ${Math.max(0, Math.floor(offset))}) { edges { node { id createdAt contentOffsetSeconds commenter { login displayName } message { fragments { text } } } } } } }`,
  };
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
  if (!res.ok) throw new Blocked(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.errors?.length) {
    const msg = j.errors.map((e) => e.message).join("; ");
    if (/integrity|forbidden|unauthori/i.test(msg)) throw new Blocked(msg);
    throw Object.assign(new Error(msg), { retry: true });
  }
  if (!j.data?.video) return null; // VOD gelöscht
  return j.data.video.comments?.edges?.map((e) => e.node) ?? [];
}

/* ---------- Auswertung einer Zeile ---------- */

const SUB_RE = /^(\S+) subscribed (?:at Tier (\d)|with Prime)\.(?: They've subscribed for (\d+) months?)?/;
const MYSTERY_RE = /^(\S+) is gifting (\d+) Tier (\d) Subs? to /;
const GIFT_RE = /^(\S+) gifted a Tier (\d) sub to (\S+?)!/;
const RAID_RE = /^(\d+) raiders? from (\S+) have joined/;

/** Gruppe des letzten Community-Geschenks je Kanal und Schenker (für die Einzelmeldungen danach) */
const giftGroups = new Map();

async function exists(sql, params) {
  return (await q(sql, params)).rows.length > 0;
}

async function addSubMinute(owner, at, count, extraMeta = {}) {
  const minute = Math.floor(at / 60_000) * 60_000;
  // Hat der Live-Chat in dieser Minute Abos im Kanal gezählt, lief er und hat dieses Abo schon mitgezählt
  if (await exists(`SELECT 1 FROM events WHERE player = $1 AND type IN ('subscription', 'subscription_gift') AND id NOT LIKE 'vod-%' AND at BETWEEN $2 AND $3 LIMIT 1`, [owner.id, new Date(minute - 60_000), new Date(minute + 120_000)])) return;
  const started = await streamStart(owner.id, at);
  await q(
    `INSERT INTO events (id, at, type, player, player_name, uuid, "where", delta, value, meta)
     VALUES ($1, $2, 'subscription', $3, $4, $5, 'twitch', $6, $6, $7)
     ON CONFLICT (id) DO UPDATE SET delta = COALESCE(events.delta, 0) + EXCLUDED.delta, value = COALESCE(events.value, 0) + EXCLUDED.value`,
    [`vod-subs-${owner.id}-${minute}`, new Date(minute), owner.id, owner.name, owner.uuid, count, JSON.stringify({ channel: owner.twitch_login ?? owner.id, bucket: "minute", streamStartedAt: started, serverOnline: true, source: "vod", ...extraMeta })],
  );
}

/** `only`: nur diese Arten auswerten (subs, bits, raids, chat); ohne Angabe alle */
async function handle(owner, n, found, only = null) {
  const want = (k) => !only || only.has(k);
  const text = (n.message?.fragments ?? []).map((f) => f.text).join("").trim();
  const login = n.commenter?.login?.toLowerCase() ?? "";
  const at = Date.parse(n.createdAt);
  if (!text || !Number.isFinite(at)) return;
  const near = (ms) => [new Date(at - ms), new Date(at + ms)];
  let m;

  if ((m = text.match(MYSTERY_RE))) {
    if (!want("subs")) return;
    const gifter = login || m[1].toLowerCase();
    const count = Number(m[2]);
    if (await exists(`SELECT 1 FROM twitch_subs WHERE channel_id = $1 AND kind LIKE '%submysterygift' AND coalesce(from_login, '') = $2 AND at BETWEEN $3 AND $4 LIMIT 1`, [owner.id, gifter, ...near(5 * 60_000)])) return;
    const group = `vod-${n.id}`;
    giftGroups.set(`${owner.id}|${gifter}`, { group, at, left: count });
    const on = await onServer(owner.id, at);
    await q(`INSERT INTO twitch_subs (id, at, channel_id, kind, plan, months, gift_count, gift_group, from_login, on_server) VALUES ($1, $2, $3, 'submysterygift', $4, NULL, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`, [
      `vod-${n.id}`, new Date(at), owner.id, `${m[3]}000`, count, group, gifter, on,
    ]);
    if (on) {
      const giver = byLogin.get(gifter);
      const liveCounted = await exists(`SELECT 1 FROM events WHERE player = $1 AND type IN ('subscription', 'subscription_gift') AND id NOT LIKE 'vod-%' AND at BETWEEN $2 AND $3 LIMIT 1`, [owner.id, new Date(at - 120_000), new Date(at + 120_000)]);
      if (liveCounted) {
        /* Live-Chat hat das Geschenk schon gezählt */
      } else if (giver && giver.id !== owner.id)
        await q(
          `INSERT INTO events (id, at, type, player, player_name, uuid, "where", delta, value, meta) VALUES ($1, $2, 'subscription_gift', $3, $4, $5, 'twitch', $6, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [`vod-gift-${n.id}`, new Date(at), owner.id, owner.name, owner.uuid, count, JSON.stringify({ channel: owner.twitch_login ?? owner.id, bucket: "minute", serverOnline: true, giftGiverPlayerId: giver.id, giftGiverName: giver.name, giftGiverUuid: giver.uuid, giftCount: count, source: "vod" })],
        );
      else await addSubMinute(owner, at, count);
    }
    found.gifts = (found.gifts ?? 0) + count;
    return;
  }
  if ((m = text.match(GIFT_RE))) {
    if (!want("subs")) return;
    const gifter = login || m[1].toLowerCase();
    const g = giftGroups.get(`${owner.id}|${gifter}`);
    const inGroup = g && at - g.at < 5 * 60_000 && g.left > 0;
    if (inGroup) g.left--;
    if (!inGroup && (await exists(`SELECT 1 FROM twitch_subs WHERE channel_id = $1 AND kind LIKE '%subgift' AND coalesce(from_login, '') = $2 AND id NOT LIKE 'vod-%' AND at BETWEEN $3 AND $4 LIMIT 1`, [owner.id, gifter, ...near(5 * 60_000)]))) return;
    const on = await onServer(owner.id, at);
    await q(`INSERT INTO twitch_subs (id, at, channel_id, kind, plan, months, gift_count, gift_group, from_login, on_server) VALUES ($1, $2, $3, 'subgift', $4, NULL, NULL, $5, $6, $7) ON CONFLICT (id) DO NOTHING`, [
      `vod-${n.id}`, new Date(at), owner.id, `${m[2]}000`, inGroup ? g.group : null, gifter, on,
    ]);
    // Einzelmeldungen eines Community-Geschenks zählen nicht noch einmal
    if (!inGroup && on) await addSubMinute(owner, at, 1);
    if (!inGroup) found.gifts = (found.gifts ?? 0) + 1;
    return;
  }
  if ((m = text.match(SUB_RE))) {
    if (!want("subs")) return;
    const months = m[3] ? Number(m[3]) : 1;
    const kind = months > 1 ? "resub" : "sub";
    if (await exists(`SELECT 1 FROM twitch_subs WHERE channel_id = $1 AND kind IN ('sub', 'resub') AND from_login = $2 AND at BETWEEN $3 AND $4 LIMIT 1`, [owner.id, login, ...near(3 * 60_000)])) return;
    const on = await onServer(owner.id, at);
    await q(`INSERT INTO twitch_subs (id, at, channel_id, kind, plan, months, gift_count, gift_group, from_login, on_server) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8) ON CONFLICT (id) DO NOTHING`, [
      `vod-${n.id}`, new Date(at), owner.id, kind, m[2] ? `${m[2]}000` : "Prime", months, login, on,
    ]);
    if (on) await addSubMinute(owner, at, 1);
    found.subs = (found.subs ?? 0) + 1;
    return;
  }
  if ((m = text.match(RAID_RE))) {
    if (!want("raids")) return;
    const raider = byLogin.get(m[2].toLowerCase());
    if (!raider || raider.id === owner.id) return;
    if (await exists(`SELECT 1 FROM events WHERE type = 'raid' AND player = $1 AND meta->>'raidTargetPlayerId' = $2 AND at BETWEEN $3 AND $4 LIMIT 1`, [raider.id, owner.id, ...near(30 * 60_000)])) return;
    await q(`INSERT INTO events (id, at, type, player, player_name, uuid, "where", delta, value, meta) VALUES ($1, $2, 'raid', $3, $4, $5, 'twitch', NULL, $6, $7) ON CONFLICT (id) DO NOTHING`, [
      `vod-raid-${n.id}`, new Date(at), raider.id, raider.name, raider.uuid, Number(m[1]),
      JSON.stringify({ raidLogin: raider.twitch_login ?? raider.id, raidTargetPlayerId: owner.id, raidTargetName: owner.name, raidTargetUuid: owner.uuid, raidTargetLogin: owner.twitch_login ?? owner.id, source: "vod" }),
    ]);
    found.raids = (found.raids ?? 0) + 1;
    return;
  }
  // Cheers: Cheermotes im Text
  const bits = text.split(/\s+/).reduce((s, w) => {
    const c = w.match(CHEERMOTE);
    return s + (c ? Number(c[2]) : 0);
  }, 0);
  if (bits > 0 && login && want("bits")) {
    if (!(await exists(`SELECT 1 FROM twitch_cheers WHERE channel_id = $1 AND from_login = $2 AND bits = $3 AND at BETWEEN $4 AND $5 LIMIT 1`, [owner.id, login, bits, ...near(3 * 60_000)]))) {
      const on = await onServer(owner.id, at);
      const id = `vod-cheer-${n.id}`;
      const fromName = n.commenter?.displayName || login;
      await q(`INSERT INTO twitch_cheers (id, at, channel_id, from_login, from_name, bits, on_server) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`, [id, new Date(at), owner.id, login, fromName, bits, on]);
      if (on && bits >= CHEER_EVENT_MIN_BITS) {
        const cheerer = byLogin.get(login);
        await q(`INSERT INTO events (id, at, type, player, player_name, uuid, "where", delta, value, meta) VALUES ($1, $2, 'cheer', $3, $4, $5, 'twitch', $6, $6, $7) ON CONFLICT (id) DO NOTHING`, [
          id, new Date(at), owner.id, owner.name, owner.uuid, bits,
          JSON.stringify({ bits, fromName, fromLogin: login, channel: owner.twitch_login ?? owner.id, source: "vod", ...(cheerer && cheerer.id !== owner.id ? { fromPlayerId: cheerer.id, fromPlayerName: cheerer.name, fromPlayerUuid: cheerer.uuid } : {}) }),
        ]);
      }
      found.bits = (found.bits ?? 0) + bits;
    }
  }
  // Nachricht eines Spielers im Chat eines anderen Spielers
  if (!want("chat")) return;
  const sender = byLogin.get(login);
  if (!sender || sender.id === owner.id) return;
  if (await exists(`SELECT 1 FROM twitch_chat_messages WHERE sender_id = $1 AND channel_id = $2 AND message = $3 AND at BETWEEN $4 AND $5 LIMIT 1`, [sender.id, owner.id, text, ...near(2 * 60_000)])) return;
  const id = `twitch-chat-vod-${hash(n.id)}`;
  const r = await q(
    `INSERT INTO twitch_chat_messages (id, at, sender_id, sender_name, channel_id, channel_name, message, shared_with) VALUES ($1, $2, $3, $4, $5, $6, $7, '{}') ON CONFLICT (id) DO NOTHING RETURNING id`,
    [id, new Date(at), sender.id, sender.name, owner.id, owner.name, text],
  );
  if (r.rows.length) {
    const short = text.length > CHAT_EVENT_MAX_LENGTH ? `${text.slice(0, CHAT_EVENT_MAX_LENGTH - 1)}…` : text;
    await q(`INSERT INTO events (id, at, type, player, player_name, uuid, "where", delta, value, meta) VALUES ($1, $2, 'chat', $3, $4, $5, 'twitch', NULL, NULL, $6) ON CONFLICT (id) DO NOTHING`, [
      `chat-${id}`, new Date(at), sender.id, sender.name, sender.uuid,
      JSON.stringify({ channelId: owner.id, channelName: owner.name, channelUuid: owner.uuid, channelLogin: owner.twitch_login ?? owner.id, message: short, source: "vod" }),
    ]);
    found.chat = (found.chat ?? 0) + 1;
  }
}

/* ---------- Ablauf ---------- */

/** Anfragen je VOD-Stunde (gemessen, Startwert grob) für die Tempo-Rechnung */
async function density() {
  const r = (await q(`SELECT sum(requests) AS req, sum(read_s) AS sec FROM vod_chat_progress WHERE requests > 0`)).rows[0];
  const sec = Number(r?.sec ?? 0);
  return sec > 3 * 3600 ? (Number(r.req) / sec) * 3600 : 80;
}

async function main() {
  await loadPlayers();
  let delay = MIN_DELAY_MS;
  let lastPlan = 0;
  let work = [];
  let errors = 0;
  let requestsDone = 0;
  for (;;) {
    if (Date.now() - lastPlan > 30 * 60_000 || !work.length) {
      await loadPlayers();
      // Genau bekannte Lücken des Live-Chats zuerst (alle Kanäle gleichauf, mit Zuschauerwanderung)
      await fillGaps().catch((e) => log("[lücken] Fehler:", e.message));
      await fillRejoins().catch((e) => log("[wiedereinstieg] Fehler:", e.message));
      work =(await plan()).filter((w) => w.ranges.length || w.finished);
      // VODs ohne Abschnitte (alles vom Live-Chat abgedeckt, fertig gesendet) gleich als erledigt markieren
      for (const w of work.filter((x) => !x.ranges.length && x.finished))
        await q(`INSERT INTO vod_chat_progress (vod_id, player, position_s, done) VALUES ($1, $2, $3, true) ON CONFLICT (vod_id) DO UPDATE SET done = true, updated_at = now()`, [w.id, w.player, w.duration_s]);
      work = work.filter((x) => x.ranges.length);
      const remainingSec = work.reduce((s, w) => s + w.ranges.reduce((t, [a, b]) => t + (b - a), 0), 0);
      const dens = await density();
      const remainingReq = (remainingSec / 3600) * dens;
      // So schnell wie vertretbar; nach 429 langsamer, mit der Zeit wieder schneller
      delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, delay * 0.8));
      lastPlan = Date.now();
      const etaH = (remainingReq * (delay + 400)) / 3600_000;
      const atRisk = work.filter((w) => w.risk < 2).length;
      log(`${work.length} VODs offen (${atRisk} gefährdet), ${Math.round(remainingSec / 3600)} VOD-Stunden, ~${Math.round(remainingReq)} Anfragen (${dens.toFixed(0)}/h), ${(delay / 1000).toFixed(1)} s Abstand, fertig in ~${etaH < 48 ? `${Math.round(etaH)} Std` : `${Math.round(etaH / 24)} Tagen`}${Date.now() + etaH * 3600_000 > DEADLINE ? ` (nach der Frist ${new Date(DEADLINE).toISOString().slice(0, 10)})` : ""}`);
      if (!work.length) {
        if (ONCE) break;
        await sleep(30 * 60_000);
        continue;
      }
    }
    // Zuerst, was am ehesten verschwindet; bei gleichem Risiko zeitlich gleichauf (frühester offener Zeitpunkt)
    work.sort((a, b) => a.risk - b.risk || a.expires - b.expires || a.start + a.ranges[0][0] * 1000 - (b.start + b.ranges[0][0] * 1000));
    const w = work[0];
    const owner = players.get(w.player);
    const [from, to] = w.ranges[0];
    let comments;
    try {
      comments = await fetchComments(w.id, from);
      errors = 0;
    } catch (err) {
      errors++;
      // Zu schnell (429): Abstand dauerhaft vergrößern, damit es nicht wieder passiert
      if (/HTTP 429/.test(err.message)) delay = Math.min(MAX_DELAY_MS, delay * 2);
      const wait = err instanceof Blocked ? 6 * 3600_000 : Math.min(3600_000, 60_000 * 2 ** Math.min(6, errors));
      log(`Fehler (${err.message}), Pause ${Math.round(wait / 60_000)} Min`);
      await sleep(wait);
      continue;
    }
    const found = {};
    let next;
    if (comments === null) {
      log(`VOD ${w.id} (${w.player}) nicht mehr verfügbar`);
      next = Infinity;
    } else {
      for (const n of comments) if (owner && n.contentOffsetSeconds >= from && n.contentOffsetSeconds <= to) await handle(owner, n, found).catch((e) => log("Zeile übersprungen:", e.message));
      const last = comments[comments.length - 1];
      // Weiter ab dem letzten Zeitpunkt; lauter Kommentare in derselben Sekunde oder keine neuen: eine Sekunde weiter
      next = !last || last.contentOffsetSeconds <= from ? from + (comments.length ? 1 : 60) : last.contentOffsetSeconds;
      if (comments.length && comments[0].contentOffsetSeconds === last.contentOffsetSeconds) next = last.contentOffsetSeconds + 1;
    }
    if (next >= to) w.ranges.shift();
    else w.ranges[0] = [next, to];
    const position = w.ranges.length ? w.ranges[0][0] : w.duration_s;
    const done = comments === null || (!w.ranges.length && w.finished);
    await q(
      `INSERT INTO vod_chat_progress (vod_id, player, position_s, done, requests, read_s, comments, found) VALUES ($1, $2, $3, $4, 1, $7, $5, $6)
       ON CONFLICT (vod_id) DO UPDATE SET position_s = GREATEST(vod_chat_progress.position_s, EXCLUDED.position_s), done = EXCLUDED.done,
         requests = vod_chat_progress.requests + 1, read_s = vod_chat_progress.read_s + EXCLUDED.read_s, comments = vod_chat_progress.comments + EXCLUDED.comments,
         found = COALESCE((SELECT jsonb_object_agg(k, coalesce((vod_chat_progress.found->>k)::int, 0) + coalesce((EXCLUDED.found->>k)::int, 0))
                    FROM (SELECT jsonb_object_keys(vod_chat_progress.found || EXCLUDED.found) AS k) keys), '{}'::jsonb),
         updated_at = now()`,
      [w.id, w.player, Math.min(position, w.duration_s), done, comments?.length ?? 0, JSON.stringify(found), Math.max(0, Math.min(next, to) - from)],
    );
    if (!w.ranges.length) work.shift();
    if (MAX_REQUESTS && ++requestsDone >= MAX_REQUESTS) break;
    await sleep(MAX_REQUESTS ? 300 : delay * (0.8 + Math.random() * 0.4));
  }
  await db.end();
}

/* ---------- Alle Kanäle zeitlich gleichauf lesen (Nachlese ganzer Zeiträume und Lücken) ---------- */

const SLICE_MS = 5 * 60_000;
const MOVE_WINDOW_MS = 45 * 60_000;
const STAY_AFTER_MS = 20 * 60_000;
const FOLLOW_MS = 90 * 60_000;
/** Geteilter Chat: dieselbe Nachricht derselben Person kurz nacheinander in zwei Kanälen ist eine Kopie */
const COPY_MS = 5_000;

/**
 * Zuschauerwanderung wie lib/chatMoves.ts: schreibt jemand bei A und bis 45 Min später bei B, zählt das als Wechsel.
 * Nutzernamen liegen nur im Arbeitsspeicher (höchstens 90 Min Wiedergabezeit) und werden nie geschrieben oder geloggt.
 * `count(at, from, to)` entscheidet, ob ein Wechsel gezählt wird (Lücken: nur, was der Live-Chat verpasst hat).
 */
class Flow {
  constructor(count = () => true) {
    this.count = count;
    this.seen = new Map();
    this.moved = new Map();
    this.pending = new Map();
  }
  bump(key, field) {
    const p = this.pending.get(key) ?? { n: 0, stay: 0, back: 0 };
    p[field]++;
    this.pending.set(key, p);
  }
  note(chan, user, at) {
    const mv = this.moved.get(user);
    if (mv) {
      if (!mv.stay && chan === mv.to && at - mv.at >= STAY_AFTER_MS && at - mv.at <= FOLLOW_MS) {
        mv.stay = true;
        this.bump(mv.key, "stay");
      }
      if (!mv.back && chan === mv.from && at - mv.at <= FOLLOW_MS) {
        mv.back = true;
        this.bump(mv.key, "back");
      }
    }
    const prev = this.seen.get(user);
    if (prev && prev.chan !== chan && at - prev.at <= MOVE_WINDOW_MS && at >= prev.at && this.count(at, prev.chan, chan)) {
      const key = `${Math.floor(at / 60_000 / 5)}|${prev.chan}|${chan}`;
      this.bump(key, "n");
      this.moved.set(user, { from: prev.chan, to: chan, key, at, stay: false, back: false });
    }
    this.seen.set(user, { chan, at });
  }
  forget(now) {
    for (const [u, s] of this.seen) if (now - s.at > MOVE_WINDOW_MS) this.seen.delete(u);
    for (const [u, s] of this.moved) if (now - s.at > FOLLOW_MS) this.moved.delete(u);
  }
  /** Gesammelte Wechsel (mit `client` in einer laufenden Transaktion) schreiben; Zahl der Wechsel */
  async flush(client) {
    const rows = [...this.pending];
    this.pending.clear();
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      const values = [];
      const ph = part.map(([key, c], j) => {
        const [bin, a, b] = key.split("|");
        values.push(Number(bin), a, b, c.n, c.stay, c.back);
        const o = j * 6;
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`;
      });
      await client.query(
        `INSERT INTO viewer_chat_moves (bin, from_id, to_id, n, stay, back) VALUES ${ph.join(", ")}
         ON CONFLICT (bin, from_id, to_id) DO UPDATE SET n = viewer_chat_moves.n + EXCLUDED.n, stay = viewer_chat_moves.stay + EXCLUDED.stay, back = viewer_chat_moves.back + EXCLUDED.back`,
        values,
      );
    }
    return rows.reduce((s, [, c]) => s + c.n, 0);
  }
}

/** Abstand zwischen Anfragen (geteilt von Nachlese und Lücken; 429 macht ihn größer) */
let sliceDelay = MIN_DELAY_MS;
let sliceErrors = 0;
/** Eine Seite holen; bei Fehlern warten und erneut (wie im Normalbetrieb). null = VOD gelöscht */
async function fetchPage(vodId, offset) {
  for (;;) {
    await sleep(sliceDelay * (0.8 + Math.random() * 0.4));
    try {
      const r = await fetchComments(vodId, offset);
      sliceErrors = 0;
      sliceDelay = Math.max(MIN_DELAY_MS, sliceDelay * 0.99);
      return r;
    } catch (err) {
      sliceErrors++;
      if (/HTTP 429/.test(err.message)) sliceDelay = Math.min(MAX_DELAY_MS, sliceDelay * 2);
      const wait = err instanceof Blocked ? 6 * 3600_000 : Math.min(3600_000, 60_000 * 2 ** Math.min(6, sliceErrors));
      log(`[nachlese] Fehler (${err.message}), Pause ${Math.round(wait / 60_000)} Min`);
      await sleep(wait);
    }
  }
}

/** VODs, die [from, to) berühren, als Lesezustand */
async function vodsBetween(from, to, onlyPlayers = null) {
  return (
    await q(
      `SELECT id, player, created_at, duration_s FROM twitch_vods
        WHERE created_at < $2 AND created_at + make_interval(secs => duration_s) > $1 ${onlyPlayers ? "AND player = ANY($3)" : ""} ORDER BY created_at`,
      onlyPlayers ? [new Date(from), new Date(to), onlyPlayers] : [new Date(from), new Date(to)],
    )
  ).rows.map((v) => ({ id: v.id, player: v.player, start: v.created_at.getTime(), end: v.created_at.getTime() + v.duration_s * 1000, duration: v.duration_s, offset: null, carry: [], lastIds: new Set(), gone: false }));
}

/**
 * Alle `vods` von `from` bis `to` in 5-Minuten-Abschnitten lesen, zeitlich geordnet, Kopien aus dem geteilten Chat
 * ausgelassen. `onSlice(items, start, end, requests)` bekommt je Abschnitt die Zeilen { t, chan, login, node }.
 */
async function readSlices(vods, from, to, onSlice) {
  let pos = from;
  let requests = 0;
  while (pos < to) {
    const end = Math.min(pos + SLICE_MS, to);
    const batch = [];
    let sliceRequests = 0;
    for (const v of vods) {
      if (v.gone || v.start >= end || v.end <= pos) continue;
      if (v.offset === null) v.offset = Math.max(0, Math.floor((pos - v.start) / 1000));
      const keep = [];
      for (const n of v.carry) (n.t < end ? batch : keep).push(n);
      v.carry = keep;
      while (v.start + v.offset * 1000 < end && v.offset < v.duration) {
        const page = await fetchPage(v.id, v.offset);
        requests++;
        sliceRequests++;
        if (page === null) {
          log(`[nachlese] VOD ${v.id} (${v.player}) nicht mehr verfügbar`);
          v.gone = true;
          v.carry = [];
          break;
        }
        const ids = new Set();
        for (const n of page) {
          ids.add(n.id);
          if (v.lastIds.has(n.id)) continue;
          const t = Date.parse(n.createdAt);
          if (!Number.isFinite(t) || t < pos) continue;
          (t < end ? batch : v.carry).push({ t, chan: v.player, node: n });
        }
        v.lastIds = ids;
        const last = page[page.length - 1];
        let next = !last || last.contentOffsetSeconds <= v.offset ? v.offset + (page.length ? 1 : 60) : last.contentOffsetSeconds;
        if (page.length && page[0].contentOffsetSeconds === last.contentOffsetSeconds) next = last.contentOffsetSeconds + 1;
        v.offset = next;
      }
    }
    batch.sort((a, b) => a.t - b.t);
    const recent = new Map();
    const items = [];
    for (const it of batch) {
      const login = it.node.commenter?.login?.toLowerCase();
      if (!login) continue;
      const text = (it.node.message?.fragments ?? []).map((f) => f.text).join("").trim();
      const key = `${login}|${text}`;
      const r = recent.get(key);
      if (r && r.chan !== it.chan && it.t - r.t <= COPY_MS) continue;
      recent.set(key, { chan: it.chan, t: it.t });
      items.push({ ...it, login });
    }
    await onSlice(items, pos, end, sliceRequests, batch.length);
    pos = end;
  }
  return requests;
}

async function inTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- Nachlese ganzer Zeiträume (--backfill) ---------- */

/**
 * Liest die Chat-Wiedergabe ALLER VODs eines Zeitraums vollständig. Nachgetragen wird, was der Live-Chat damals noch
 * nicht erfasst hat:
 * - A (19.10.–29.10.): einzelne Abos mit Schenker/Stufe/Monaten (live erst ab 29.10., vorher nur Summen je Minute)
 *   und Cheers (live erst ab 25.10.), dazu die Zuschauerwanderung
 * - B (29.10.–03.11.): nur Zuschauerwanderung (live ab 03.11. 10:10 UTC, erster Abschnitt in viewer_chat_moves)
 * - C (10.10.–19.10.): nur Zuschauerwanderung (Abos/Cheers/Raids/Chat dort schon aus dem Normalbetrieb)
 * Fortschritt je Zeitraum in vod_backfill_progress; nach einem Neustart geht es am letzten Abschnitt weiter.
 */
const BACKFILL_PASSES = [
  { name: "A", from: "2026-10-19T10:06:00Z", to: "2026-10-29T07:10:00Z", only: ["subs", "bits"] },
  { name: "B", from: "2026-10-29T07:10:00Z", to: "2026-11-03T10:10:00Z", only: [] },
  { name: "C", from: "2026-10-10T08:00:00Z", to: "2026-10-19T10:06:00Z", only: [] },
];

async function backfill() {
  await q(`
    CREATE TABLE IF NOT EXISTS vod_backfill_progress (
      pass       text PRIMARY KEY,
      pos        timestamptz NOT NULL,
      done       boolean NOT NULL DEFAULT false,
      requests   integer NOT NULL DEFAULT 0,
      comments   bigint NOT NULL DEFAULT 0,
      found      jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await loadPlayers();
  /** Zustand der Zuschauerwanderung; bleibt über aneinandergrenzende Zeiträume (A → B) erhalten */
  let flow = null;
  let flowEnd = 0;
  for (const pass of BACKFILL_PASSES) {
    const from = Date.parse(pass.from);
    const to = Date.parse(pass.to);
    const saved = (await q(`SELECT pos, done FROM vod_backfill_progress WHERE pass = $1`, [pass.name])).rows[0];
    if (saved?.done) continue;
    const pos = saved ? saved.pos.getTime() : from;
    if (!saved) await q(`INSERT INTO vod_backfill_progress (pass, pos) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [pass.name, new Date(pos)]);
    if (!flow || flowEnd !== pos) flow = new Flow();
    const only = new Set(pass.only);
    const vods = await vodsBetween(pos, to);
    const remaining = (at) => vods.reduce((s, v) => s + (v.gone ? 0 : Math.max(0, Math.min(v.end, to) - Math.max(v.start, at))), 0) / 3600_000;
    const totalH = remaining(pos);
    log(`[nachlese] Zeitraum ${pass.name} ab ${new Date(pos).toISOString()}: ${vods.length} VODs, ${Math.round(totalH)} VOD-Stunden${only.size ? `, dazu ${[...only].join("/")}` : ""}`);
    let requests = 0;
    let comments = 0;
    let lastLog = Date.now();
    const startedAt = Date.now();
    let stop = false;
    await readSlices(vods, pos, to, async (items, start, end, sliceRequests, lines) => {
      if (stop) return;
      requests += sliceRequests;
      comments += lines;
      const found = {};
      for (const { t, chan, login, node } of items) {
        if (only.size) {
          const owner = players.get(chan);
          if (owner) await handle(owner, node, found, only).catch((e) => log("[nachlese] Zeile übersprungen:", e.message));
        }
        flow.note(chan, login, t);
      }
      flow.forget(end);
      await inTransaction(async (client) => {
        found.moves = await flow.flush(client);
        await client.query(
          `UPDATE vod_backfill_progress SET pos = $2, done = $3, requests = requests + $4, comments = comments + $5,
             found = COALESCE((SELECT jsonb_object_agg(k, coalesce((found->>k)::bigint, 0) + coalesce(($6::jsonb->>k)::bigint, 0))
                        FROM (SELECT jsonb_object_keys(found || $6::jsonb) AS k) keys), '{}'::jsonb),
             updated_at = now()
           WHERE pass = $1`,
          [pass.name, new Date(end), end >= to, sliceRequests, lines, JSON.stringify(found)],
        );
      });
      flowEnd = end;
      if (Date.now() - lastLog > 30 * 60_000 || end >= to) {
        const left = remaining(end);
        const done = totalH - left;
        const etaH = done > 0 ? ((Date.now() - startedAt) / 3600_000) * (left / done) : NaN;
        const mem = Math.round(process.memoryUsage().rss / 1048576);
        log(`[nachlese] ${pass.name}: bei ${new Date(end).toISOString().slice(0, 16)}, ${requests} Anfragen, ${comments} Zeilen, noch ${Math.round(left)} VOD-Stunden${Number.isFinite(etaH) ? `, fertig in ~${etaH < 48 ? `${Math.round(etaH)} Std` : `${Math.round(etaH / 24)} Tagen`}` : ""}, ${flow.seen.size} Schreiber im Speicher, ${mem} MB`);
        lastLog = Date.now();
      }
      if (MAX_REQUESTS && requests >= MAX_REQUESTS) stop = true;
    });
    if (stop) {
      await db.end();
      return;
    }
    log(`[nachlese] Zeitraum ${pass.name} fertig`);
  }
  log("[nachlese] alles fertig");
  await db.end();
}

/* ---------- Lücken des Live-Chats seit Beginn der Mitschrift (lib/ircCoverage.ts) ---------- */

/**
 * Seit der Tracker irc_uptime/irc_joined schreibt, sind Lücken genau bekannt:
 * - Minute ohne irc_uptime (oder ok = false): Verbindung weg oder Nachricht verloren → alle Kanäle
 * - 5-Minuten-Abschnitt ohne irc_joined für einen Kanal, dessen VOD da lief → nur dieser Kanal
 * Gleichzeitige Lücken werden zu einem Fenster zusammengefasst. Je Fenster werden die VODs der betroffenen Kanäle
 * ganz ausgewertet (Abos, Geschenke, Cheers, Raids, Chat zwischen Spielern; Doppelte erkennt handle()) und für die
 * Zuschauerwanderung alle laufenden VODs ab 10–45 Min vorher gelesen, gezählt werden nur Wechsel von/zu betroffenen
 * Kanälen innerhalb der Lücke. Erledigte Abschnitte in vod_gap_bins.
 */
/** Vorlauf für die Wanderung: so lang wie die Lücke, mindestens 10, höchstens 45 Min (kurze Lücken, z. B. ein Neustart
 * des Trackers, sollen nicht jedes Mal 45 Min aller Kanäle kosten) */
const gapWarmup = (len) => Math.min(MOVE_WINDOW_MS, Math.max(10 * 60_000, len));
/** Höchstens so lange lesen wir für die Wanderung alle Kanäle mit (sonst nur die betroffenen) */
const GAP_FLOW_MAX_MS = 3 * 3600_000;

async function gapWindows() {
  await q(`CREATE TABLE IF NOT EXISTS vod_gap_bins (bin integer PRIMARY KEY, players text[] NOT NULL, done_at timestamptz NOT NULL DEFAULT now())`);
  // Bis hier ist alles geprüft (ältere Abschnitte ändern sich nicht mehr)
  await q(`CREATE TABLE IF NOT EXISTS vod_gap_state (id integer PRIMARY KEY, checked_bin integer NOT NULL)`);
  const first = (await q(`SELECT min(minute) AS m FROM irc_uptime`).catch(() => ({ rows: [] }))).rows[0]?.m;
  if (first == null) return [];
  // Ab dem ersten vollen Abschnitt nach Beginn der Mitschrift, bis vor RECENT_MS (VODs wachsen dort noch)
  const checked = (await q(`SELECT checked_bin FROM vod_gap_state WHERE id = 1`)).rows[0]?.checked_bin;
  const fromBin = Math.max(Math.ceil((Number(first) + 1) / 5), checked ?? 0);
  const toBin = Math.floor((Date.now() - RECENT_MS) / SLICE_MS);
  if (toBin <= fromBin) return [];
  gapCheckedTo = toBin;
  const rows = (
    await q(
      `WITH bins AS (SELECT generate_series($1::int, $2::int - 1) AS bin),
            down AS (
              SELECT b.bin FROM bins b
               WHERE (SELECT count(*) FROM irc_uptime u WHERE u.minute BETWEEN b.bin * 5 AND b.bin * 5 + 4 AND u.ok) < 5
            ),
            live AS (
              SELECT b.bin, v.player FROM bins b JOIN twitch_vods v
                ON v.created_at < to_timestamp((b.bin + 1) * 300) AND v.created_at + make_interval(secs => v.duration_s) > to_timestamp(b.bin * 300)
            )
       SELECT l.bin, array_agg(DISTINCT l.player) AS players, bool_or(d.bin IS NOT NULL) AS down
         FROM live l LEFT JOIN down d ON d.bin = l.bin
        WHERE (d.bin IS NOT NULL OR NOT EXISTS (SELECT 1 FROM irc_joined j WHERE j.player = l.player AND j.bin = l.bin))
          AND NOT EXISTS (SELECT 1 FROM vod_gap_bins g WHERE g.bin = l.bin)
        GROUP BY l.bin ORDER BY l.bin`,
      [fromBin, toBin],
    )
  ).rows;
  // Aufeinanderfolgende Abschnitte zu Fenstern
  const out = [];
  for (const r of rows) {
    const w = out[out.length - 1];
    if (w && w.toBin === r.bin) {
      w.toBin = r.bin + 1;
      for (const p of r.players) w.players.add(p);
      w.bins.push(r.bin);
    } else out.push({ fromBin: r.bin, toBin: r.bin + 1, players: new Set(r.players), bins: [r.bin] });
  }
  return out;
}

let gapCheckedTo = null;
const markChecked = () =>
  gapCheckedTo == null ? null : q(`INSERT INTO vod_gap_state (id, checked_bin) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET checked_bin = EXCLUDED.checked_bin`, [gapCheckedTo]);

/** Alle offenen Lücken füllen; gibt die Zahl der Anfragen zurück */
async function fillGaps() {
  gapCheckedTo = null;
  const windows = await gapWindows();
  if (!windows.length) {
    await markChecked();
    return 0;
  }
  const bins = windows.reduce((s, w) => s + w.bins.length, 0);
  log(`[lücken] ${windows.length} Fenster offen (${bins} Abschnitte à 5 Min)`);
  let total = 0;
  for (const w of windows) {
    const a = w.fromBin * SLICE_MS;
    const b = w.toBin * SLICE_MS;
    const G = w.players;
    const withFlow = b - a <= GAP_FLOW_MAX_MS;
    const warm = withFlow ? gapWarmup(b - a) : 0;
    const vods = withFlow ? await vodsBetween(a - warm, b) : await vodsBetween(a, b, [...G]);
    const flow = new Flow((at, from, to) => at >= a && (G.has(from) || G.has(to)));
    const found = {};
    const gapBins = new Set(w.bins);
    const requests = await readSlices(vods, a - warm, b, async (items, _start, end) => {
      for (const { t, chan, login, node } of items) {
        // Nur Zeilen der betroffenen Kanäle in betroffenen Abschnitten auswerten (Doppelte erkennt handle())
        if (t >= a && G.has(chan) && gapBins.has(Math.floor(t / SLICE_MS))) {
          const owner = players.get(chan);
          if (owner) await handle(owner, node, found).catch((e) => log("[lücken] Zeile übersprungen:", e.message));
        }
        if (withFlow) flow.note(chan, login, t);
      }
      if (withFlow) flow.forget(end);
    });
    await inTransaction(async (client) => {
      found.moves = withFlow ? await flow.flush(client) : 0;
      await client.query(`INSERT INTO vod_gap_bins (bin, players) SELECT unnest($1::int[]), $2::text[] ON CONFLICT (bin) DO NOTHING`, [w.bins, [...G]]);
    });
    total += requests;
    const what = Object.entries(found).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ") || "nichts Neues";
    log(`[lücken] ${new Date(a).toISOString().slice(0, 16)}–${new Date(b).toISOString().slice(11, 16)} (${G.size} Kanäle${withFlow ? "" : ", ohne Wanderung"}): ${requests} Anfragen, ${what}`);
  }
  await markChecked();
  return total;
}

/**
 * Wiedereinstiege des Live-Chats (irc_rejoin, lib/ircCoverage.ts): nach einem Neustart des Trackers oder einem
 * Verbindungsabbruch fehlen je Kanal bis zu ~1 Min, bis alle Kanäle wieder beigetreten sind. Das Fenster wird aus den
 * VODs der dann live gewesenen Kanäle gelesen; was der Live-Chat schon hatte, erkennt handle(). OHNE
 * Zuschauerwanderung: viewer_chat_moves wird aufaddiert, und der Live-Chat hat das Fenster zum Teil schon gezählt.
 */
async function fillRejoins() {
  await q(`CREATE TABLE IF NOT EXISTS irc_rejoin (from_ms bigint PRIMARY KEY, to_ms bigint NOT NULL, done boolean NOT NULL DEFAULT false)`);
  const rows = (await q(`SELECT from_ms, to_ms FROM irc_rejoin WHERE NOT done AND to_ms < $1 ORDER BY from_ms`, [Date.now() - RECENT_MS])).rows;
  if (!rows.length) return 0;
  log(`[wiedereinstieg] ${rows.length} Fenster offen`);
  let total = 0;
  for (const r of rows) {
    // Etwas Rand: Zeitstempel im VOD-Chat und Prozessstart weichen um Sekunden ab
    const a = Number(r.from_ms) - 15_000;
    const b = Number(r.to_ms) + 15_000;
    const vods = await vodsBetween(a, b);
    const found = {};
    const requests = await readSlices(vods, a, b, async (items) => {
      for (const { chan, node } of items) {
        const owner = players.get(chan);
        if (owner) await handle(owner, node, found).catch((e) => log("[wiedereinstieg] Zeile übersprungen:", e.message));
      }
    });
    await q(`UPDATE irc_rejoin SET done = true WHERE from_ms = $1`, [r.from_ms]);
    total += requests;
    const what = Object.entries(found).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ") || "nichts Neues";
    log(`[wiedereinstieg] ${new Date(a).toISOString().slice(0, 19)} (${Math.round((b - a) / 1000)} s, ${vods.length} VODs): ${requests} Anfragen, ${what}`);
  }
  return total;
}

process.on("SIGTERM", () => {
  log("beendet");
  process.exit(0);
});
if (args.includes("--backfill")) await backfill();
else await main();
