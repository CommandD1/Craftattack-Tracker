#!/usr/bin/env node
/**
 * FitnaCraft-Rückblick (einmalig): FitnaCraft war ein anderer Minecraft-Server, auf den viele CraftAttack-Spieler
 * nach dem 31.10. gewechselt sind. Der Tracker kennt nur CraftAttack, hat aber die Twitch-Daten aller Mitglieder
 * jede Minute mitgeschrieben – auch wenn sie nicht auf CraftAttack waren. Dieses Skript erkennt daraus, wann jemand
 * auf FitnaCraft gestreamt hat, und legt eine fertige Auswertung in `snapshots` unter dem Schlüssel `fitnacraft` ab.
 * Die versteckte Seite /fitnacraft/<FITNACRAFT_KEY> liest nur diese eine Zeile.
 *
 * Regel für eine FitnaCraft-Minute: live auf Twitch, Kategorie Minecraft (oder leer), NICHT online auf CraftAttack und
 * der Stream-Titel nennt „FitnaCraft“ (auch „Fitna Craft“, „Fitnacwaft“), aber keine VOD-Wiederholung und kein
 * „FitnaCraft vorbei“; nur bis zum Finale (10.11.). Nichts wird erfunden: alles stammt aus den
 * Minutenwerten (`player_history`), den Titel-Ereignissen, VODs, Clips, Abos, Cheers, Raids und Chats in der DB.
 *
 *   DATABASE_URL=… node scripts/fitnacraft.mjs [--dry]   (--dry: nur Kennzahlen ausgeben, nichts schreiben)
 *
 * Rückbau: `DELETE FROM snapshots WHERE key = 'fitnacraft'`.
 */
import pg from "pg";

const DRY = process.argv.includes("--dry");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL fehlt");
const ssl = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false };
const db = new pg.Pool({ connectionString: url, ssl, max: 2, application_name: "actracker-fitnacraft" });

const FITNA = /fitna\s*-?\s*c[rw]aft/i;
/** Kein Spielen: Wiederholungen („💥 VOD 💥“, nicht der Chatbefehl „!VOD“) und „FITNACRAFT VORBEI“ */
const NOT_PLAYING = /(^|[^!\w])VOD(?!\w)|vorbei/i;
/** Server-Ende: Finale am 10.11. abends, danach zählt nichts mehr (11.11. 00:00 Berlin) */
const END = Date.parse("2026-11-10T23:00:00Z");
const SEASON = Date.parse("2026-10-09T22:00:00Z"); // 10.10. 00:00 Berlin
const STEP = 5 * 60_000;
const GAP = 10 * 60_000; // Lücke, ab der eine neue Session beginnt
const MAX_ROW = 2 * 60_000; // eine Zeile zählt höchstens 2 Minuten

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" });
const berlinDay = (ms) => dayFmt.format(ms);
// formatToParts: „de-DE“ formatiert eine reine Stunde als „14 Uhr“
const berlinHour = (ms) => Number(hourFmt.formatToParts(ms).find((p) => p.type === "hour")?.value ?? 0);

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s]`, ...a);

// ---------------------------------------------------------------- Stammdaten
const players = (await db.query(`SELECT id, name, uuid, twitch_login, followers FROM players`)).rows;
const byId = new Map(players.map((p) => [p.id, p]));
const titleRows = (
  await db.query(
    `SELECT player, at, type, meta->>'title' AS title FROM events
      WHERE type IN ('stream_start','stream_title') AND player IS NOT NULL AND at >= $1 ORDER BY player, at`,
    [new Date(SEASON)],
  )
).rows;
const titlesOf = new Map();
for (const r of titleRows) {
  if (!r.title) continue;
  if (!titlesOf.has(r.player)) titlesOf.set(r.player, []);
  titlesOf.get(r.player).push({ at: r.at.getTime(), title: r.title });
}
const vodRows = (await db.query(`SELECT id, player, created_at, duration_s, title FROM twitch_vods WHERE created_at >= $1 ORDER BY player, created_at`, [new Date(SEASON - 86400_000)])).rows;
const vodsOf = new Map();
for (const v of vodRows) {
  if (!vodsOf.has(v.player)) vodsOf.set(v.player, []);
  vodsOf.get(v.player).push({ id: v.id, a: v.created_at.getTime(), b: v.created_at.getTime() + v.duration_s * 1000, title: v.title });
}
const vodAt = (player, t) => (vodsOf.get(player) ?? []).find((v) => v.a <= t && t <= v.b) ?? null;
const vodLink = (v, t) => {
  const s = Math.max(0, Math.floor((t - v.a) / 1000) - 30);
  return `https://www.twitch.tv/videos/${v.id}?t=${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
};
log(`${players.length} Spieler, ${titleRows.length} Titel, ${vodRows.length} VODs`);

// ---------------------------------------------------------------- Minutenwerte je Spieler
const lastRow = (await db.query(`SELECT max(at) AS m FROM player_history`)).rows[0].m.getTime();
const NB = Math.ceil((lastRow - SEASON) / STEP) + 1;
/** Zustand je 5-Minuten-Abschnitt: 0 = nicht live, 1 = FitnaCraft, 2 = CraftAttack, 3 = woanders live */
const tracks = new Map();
const binView = new Map();
const perPlayer = new Map();
const sessions = [];
const fcTitleSeconds = new Map(); // player → Map(title → Sekunden)

for (const p of players) {
  const rows = (
    await db.query(
      `SELECT at, online, viewers, stream_game_name AS g, followers_total AS f FROM player_history
        WHERE player = $1 AND at >= $2 AND viewers IS NOT NULL ORDER BY at`,
      [p.id, new Date(SEASON)],
    )
  ).rows;
  if (!rows.length) continue;
  const titles = titlesOf.get(p.id) ?? [];
  let ti = -1;
  const st = new Uint8Array(NB);
  const vw = new Float64Array(NB);
  const acc = { fc: [0, 0], ca: [0, 0], other: [0, 0] }; // [Sekunden, Zuschauer·Sekunden]
  let cur = null;
  const closeSession = () => {
    if (!cur) return;
    sessions.push(cur);
    cur = null;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const at = r.at.getTime();
    const next = rows[i + 1]?.at.getTime();
    const dur = next !== undefined ? Math.min(MAX_ROW, next - at) : 60_000;
    while (ti + 1 < titles.length && titles[ti + 1].at <= at + 30_000) ti++;
    let title = ti >= 0 && at - titles[ti].at < 36 * 3600_000 ? titles[ti].title : null;
    if (!title) title = vodAt(p.id, at)?.title ?? "";
    const game = r.g ?? "";
    const fc = at < END && !r.online && FITNA.test(title) && !NOT_PLAYING.test(title) && (game === "Minecraft" || game === "");
    const kind = fc ? "fc" : r.online ? "ca" : "other";
    acc[kind][0] += dur / 1000;
    acc[kind][1] += (r.viewers * dur) / 1000;
    const bin = Math.floor((at - SEASON) / STEP);
    if (bin >= 0 && bin < NB) {
      st[bin] = fc ? 1 : r.online ? 2 : 3;
      vw[bin] = r.viewers;
    }
    if (!fc) {
      if (cur && at - cur.b > GAP) closeSession();
      continue;
    }
    if (cur && at - cur.b > GAP) closeSession();
    if (!cur) cur = { p: p.id, a: at, b: at, sec: 0, vs: 0, peak: 0, peakAt: at, f0: null, f1: null, title, titles: [], samples: [] };
    cur.b = at + dur;
    cur.sec += dur / 1000;
    cur.vs += (r.viewers * dur) / 1000;
    if (r.viewers > cur.peak) {
      cur.peak = r.viewers;
      cur.peakAt = at;
    }
    if (r.f != null) {
      if (cur.f0 === null) cur.f0 = r.f;
      cur.f1 = r.f;
    }
    if (cur.titles[cur.titles.length - 1] !== title) cur.titles.push(title);
    cur.samples.push([at, r.viewers]);
    if (!fcTitleSeconds.has(p.id)) fcTitleSeconds.set(p.id, new Map());
    const m = fcTitleSeconds.get(p.id);
    m.set(title, (m.get(title) ?? 0) + dur / 1000);
  }
  closeSession();
  tracks.set(p.id, st);
  binView.set(p.id, vw);
  perPlayer.set(p.id, acc);
}
log(`Minutenwerte gelesen, ${sessions.length} FitnaCraft-Sessions`);

// Sehr kurze Schnipsel (< 3 Min, z. B. ein Titelwechsel) sind keine Session
const fcSessions = sessions.filter((s) => s.sec >= 180).sort((a, b) => a.a - b.a);
const fcIds = [...new Set(fcSessions.map((s) => s.p))];
const FROM = fcSessions[0].a;
const TO = Math.max(...fcSessions.map((s) => s.b));
const inSession = (player, t, lead = 0, tail = 0) => fcSessions.find((s) => s.p === player && s.a - lead <= t && t <= s.b + tail) ?? null;
log(`${fcSessions.length} Sessions von ${fcIds.length} Spielern, ${new Date(FROM).toISOString()} – ${new Date(TO).toISOString()}`);

// ---------------------------------------------------------------- Abos, Cheers, Clips, Raids, Chats, geteilte Chats
const subRows = (
  await db.query(
    `SELECT at, channel_id, kind, gift_count, gift_group, from_login FROM twitch_subs WHERE channel_id = ANY($1) AND at BETWEEN $2 AND $3`,
    [fcIds, new Date(FROM - 3600_000), new Date(TO + 3600_000)],
  )
).rows;
const subUnits = []; // {p, at, paid, gift}
const groups = new Map();
for (const r of subRows) {
  if (r.gift_group) {
    const k = `${r.channel_id}|${r.gift_group}`;
    const g = groups.get(k) ?? { p: r.channel_id, at: r.at.getTime(), mystery: 0, n: 0, by: null };
    if (r.kind.endsWith("submysterygift")) {
      g.mystery = Math.max(g.mystery, r.gift_count ?? 0);
      g.by = r.from_login ?? g.by;
    } else g.n++;
    g.at = Math.min(g.at, r.at.getTime());
    groups.set(k, g);
    continue;
  }
  const gift = r.kind === "subgift" || r.kind.endsWith("submysterygift");
  const n = r.kind.endsWith("submysterygift") ? (r.gift_count ?? 0) : 1;
  subUnits.push({ p: r.channel_id, at: r.at.getTime(), paid: gift ? 0 : n, gift: gift ? n : 0, by: gift ? r.from_login : null });
}
for (const g of groups.values()) subUnits.push({ p: g.p, at: g.at, paid: 0, gift: Math.max(g.mystery, g.n), by: g.by });

const cheerRows = (
  await db.query(`SELECT at, channel_id, bits, from_name FROM twitch_cheers WHERE channel_id = ANY($1) AND at BETWEEN $2 AND $3`, [fcIds, new Date(FROM - 3600_000), new Date(TO + 3600_000)])
).rows;
const clipRows = (
  await db.query(
    `SELECT id, player, created_at, title, view_count, creator_name, duration, url, thumbnail FROM twitch_clips
      WHERE player = ANY($1) AND created_at BETWEEN $2 AND $3`,
    [fcIds, new Date(FROM - 3600_000), new Date(TO + 3600_000)],
  )
).rows;
const evRows = (
  await db.query(
    `SELECT id, at, type, player, value, meta FROM events
      WHERE type IN ('raid','chat','stream_title') AND at BETWEEN $1 AND $2`,
    [new Date(FROM - 3600_000), new Date(TO + 3600_000)],
  )
).rows;
const sharedRows = (
  await db.query(`SELECT started_at, coalesce(ended_at, last_seen_at) AS ended_at, participants, other_count FROM shared_chat_sessions WHERE started_at BETWEEN $1 AND $2`, [
    new Date(FROM - 3600_000),
    new Date(TO + 3600_000),
  ])
).rows;
log(`${subRows.length} Abo-Zeilen, ${cheerRows.length} Cheers, ${clipRows.length} Clips, ${evRows.length} Ereignisse, ${sharedRows.length} geteilte Chats`);

const feed = [];
for (const s of fcSessions) {
  s.paid = 0;
  s.gift = 0;
  s.bits = 0;
  s.clips = 0;
}
for (const u of subUnits) {
  const s = inSession(u.p, u.at);
  if (!s) continue;
  s.paid += u.paid;
  s.gift += u.gift;
  // Feed aus den Rohdaten: die Ereignisse „Geschenk“/„Cheer“/„Follower-Schub“ legt der Tracker nur auf CraftAttack an
  if (u.gift >= 10) feed.push({ at: u.at, t: "gift", p: u.p, n: u.gift, by: u.by ?? null });
}
for (const c of cheerRows) {
  const s = inSession(c.channel_id, c.at.getTime());
  if (!s) continue;
  s.bits += c.bits;
  if (c.bits >= 1000) feed.push({ at: c.at.getTime(), t: "cheer", p: c.channel_id, n: c.bits, by: c.from_name });
}
const clips = [];
for (const c of clipRows) {
  const at = c.created_at.getTime();
  const s = inSession(c.player, at, 60_000, 120_000);
  if (!s) continue;
  s.clips++;
  clips.push({ id: c.id, player: c.player, at, title: c.title, views: c.view_count, seconds: Math.round(c.duration ?? 0), url: c.url, thumbnail: c.thumbnail, creator: c.creator_name });
}
clips.sort((a, b) => b.views - a.views);

// Verbindungen (gleiche Felder wie LinkCounts in lib/connectionWeights.ts) plus gemeinsame Zeit auf FitnaCraft
const links = new Map();
const link = (x, y) => {
  const [a, b] = x < y ? [x, y] : [y, x];
  const k = `${a}|${b}`;
  if (!links.has(k)) links.set(k, { a, b, raidsAB: 0, raidsBA: 0, chats: 0, chatSeconds: 0, msgsAB: 0, msgsBA: 0, titleAB: 0, titleBA: 0, now: false, together: 0 });
  return links.get(k);
};
const raids = [];
const chats = [];
for (const e of evRows) {
  const at = e.at.getTime();
  const m = e.meta ?? {};
  if (e.type === "raid") {
    const to = m.raidTargetPlayerId ?? null;
    const from = inSession(e.player, at, 0, 20 * 60_000);
    if (!from && !(to && fcIds.includes(to) && inSession(to, at, 0, 0))) continue;
    raids.push({ at, from: e.player, to, toName: m.raidTargetName ?? m.raidTargetLogin ?? to, viewers: e.value ?? null, fc: Boolean(from) });
    if (to && byId.has(to) && e.player !== to) {
      const l = link(e.player, to);
      if (e.player < to) l.raidsAB++;
      else l.raidsBA++;
    }
    feed.push({ at, t: "raid", p: e.player, to, toName: m.raidTargetName ?? to, n: e.value ?? null });
  } else if (e.type === "chat") {
    const ch = m.channelId;
    if (!ch || !inSession(ch, at)) continue;
    chats.push({ at, from: e.player, to: ch, text: m.message ?? "", url: m.vodUrl ?? null });
    if (byId.has(ch) && e.player && e.player !== ch) {
      const l = link(e.player, ch);
      if (e.player < ch) l.msgsAB++;
      else l.msgsBA++;
    }
  } else if (e.type === "stream_title") {
    const s = inSession(e.player, at);
    if (!s || !m.title) continue;
    feed.push({ at, t: "title", p: e.player, v: m.title });
  }
}
const shared = [];
for (const r of sharedRows) {
  const a = r.started_at.getTime();
  const b = r.ended_at.getTime();
  const ps = r.participants.filter((id) => fcSessions.some((s) => s.p === id && s.a <= b && a <= s.b));
  if (!ps.length) continue;
  shared.push({ a, b, ps: r.participants, others: r.other_count });
  if (r.participants.length > 1) feed.push({ at: a, t: "shared", p: r.participants[0], ps: r.participants });
  for (let i = 0; i < r.participants.length; i++)
    for (let j = i + 1; j < r.participants.length; j++) {
      const l = link(r.participants[i], r.participants[j]);
      l.chats++;
      l.chatSeconds += Math.max(0, (b - a) / 1000);
    }
}
// Titel-Erwähnungen („mit @trymacs“) während FitnaCraft-Sessions
const handle = new Map();
for (const p of players) {
  for (const h of [p.id, p.name, p.twitch_login]) if (h && h.length >= 3) handle.set(h.toLowerCase(), p.id);
}
for (const [pid, m] of fcTitleSeconds) {
  for (const [title, sec] of m) {
    const named = new Set();
    for (const x of title.matchAll(/@([A-Za-z0-9_]{3,25})/g)) {
      const id = handle.get(x[1].toLowerCase());
      if (id && id !== pid) named.add(id);
    }
    for (const id of named) {
      const l = link(pid, id);
      if (pid < id) l.titleAB += sec;
      else l.titleBA += sec;
    }
  }
}

// ---------------------------------------------------------------- Abschnitte, Tage, gemeinsame Zeit
const b0 = Math.floor((FROM - SEASON) / STEP) - 12;
const b1 = Math.min(NB - 1, Math.ceil((TO - SEASON) / STEP) + 12);
const fcTrack = {};
for (const id of fcIds) {
  let s = "";
  const st = tracks.get(id);
  for (let b = b0; b <= b1; b++) s += st[b];
  fcTrack[id] = s;
}
// Zuschauer je Abschnitt aller erfassten Spieler (Staffel), nach Ort
const series = { fc: new Array(NB).fill(0), ca: new Array(NB).fill(0), other: new Array(NB).fill(0), fcN: new Array(NB).fill(0), caN: new Array(NB).fill(0), otherN: new Array(NB).fill(0) };
for (const [id, st] of tracks) {
  const vw = binView.get(id);
  for (let b = 0; b < NB; b++) {
    if (!st[b]) continue;
    const k = st[b] === 1 ? "fc" : st[b] === 2 ? "ca" : "other";
    series[k][b] += vw[b];
    series[`${k}N`][b]++;
  }
}
for (let b = b0; b <= b1; b++) {
  const on = fcIds.filter((id) => tracks.get(id)[b] === 1);
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) link(on[i], on[j]).together += STEP / 1000;
}
const days = new Map();
for (let b = 0; b < NB; b++) {
  const day = berlinDay(SEASON + b * STEP + 1);
  if (!days.has(day)) days.set(day, { day, fcVh: 0, caVh: 0, otherVh: 0, fcPeakN: 0, fcPeakV: 0, caPeakV: 0, fcIds: new Set(), caIds: new Set() });
  const d = days.get(day);
  d.fcVh += (series.fc[b] * STEP) / 3600_000;
  d.caVh += (series.ca[b] * STEP) / 3600_000;
  d.otherVh += (series.other[b] * STEP) / 3600_000;
  d.fcPeakN = Math.max(d.fcPeakN, series.fcN[b]);
  d.fcPeakV = Math.max(d.fcPeakV, series.fc[b]);
  d.caPeakV = Math.max(d.caPeakV, series.ca[b]);
}
for (const [id, st] of tracks)
  for (let b = 0; b < NB; b++) {
    if (st[b] !== 1 && st[b] !== 2) continue;
    days.get(berlinDay(SEASON + b * STEP + 1))[st[b] === 1 ? "fcIds" : "caIds"].add(id);
  }

// ---------------------------------------------------------------- Spieler-Kennzahlen
const out = [];
for (const id of fcIds) {
  const p = byId.get(id);
  const ss = fcSessions.filter((s) => s.p === id);
  const acc = perPlayer.get(id);
  const daily = {};
  const hours = new Array(24).fill(0);
  for (const s of ss) {
    for (let i = 0; i < s.samples.length; i++) {
      const [at] = s.samples[i];
      const dur = Math.min(MAX_ROW, (s.samples[i + 1]?.[0] ?? at + 60_000) - at) / 1000;
      const d = berlinDay(at);
      daily[d] = (daily[d] ?? 0) + dur;
      hours[berlinHour(at)] += dur;
    }
  }
  const sec = ss.reduce((x, s) => x + s.sec, 0);
  const peak = ss.reduce((m, s) => (s.peak > m.peak ? s : m), ss[0]);
  const titles = [...(fcTitleSeconds.get(id) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([title, seconds]) => ({ title, seconds: Math.round(seconds) }));
  const withF = ss.filter((s) => s.f0 !== null);
  out.push({
    id,
    name: p.name,
    uuid: p.uuid,
    login: p.twitch_login ?? id,
    seconds: Math.round(sec),
    sessions: ss.length,
    longest: Math.round(Math.max(...ss.map((s) => s.sec))),
    days: Object.keys(daily).length,
    first: ss[0].a,
    last: ss[ss.length - 1].b,
    avgViewers: Math.round(ss.reduce((x, s) => x + s.vs, 0) / Math.max(1, sec)),
    peakViewers: peak.peak,
    peakAt: peak.peakAt,
    viewerHours: Math.round(ss.reduce((x, s) => x + s.vs, 0) / 3600),
    caSeconds: Math.round(acc.ca[0]),
    caAvgViewers: acc.ca[0] > 0 ? Math.round(acc.ca[1] / acc.ca[0]) : null,
    otherSeconds: Math.round(acc.other[0]),
    otherAvgViewers: acc.other[0] > 0 ? Math.round(acc.other[1] / acc.other[0]) : null,
    followersStart: withF[0]?.f0 ?? null,
    followersEnd: withF[withF.length - 1]?.f1 ?? null,
    followerGain: withF.reduce((x, s) => x + Math.max(0, s.f1 - s.f0), 0),
    paidSubs: ss.reduce((x, s) => x + s.paid, 0),
    giftSubs: ss.reduce((x, s) => x + s.gift, 0),
    bits: ss.reduce((x, s) => x + s.bits, 0),
    clips: ss.reduce((x, s) => x + s.clips, 0),
    raidsOut: raids.filter((r) => r.from === id && r.fc).length,
    raidsIn: raids.filter((r) => r.to === id).length,
    daily,
    hours: hours.map(Math.round),
    titles,
  });
}
out.sort((a, b) => b.seconds - a.seconds);

// Feed: Beginn/Ende jeder Session
for (const s of fcSessions) {
  const v = vodAt(s.p, s.a);
  feed.push({ at: s.a, t: "start", p: s.p, v: s.titles[0], url: v ? vodLink(v, s.a) : null });
  feed.push({ at: s.b, t: "end", p: s.p, n: Math.round(s.sec), peak: s.peak });
}
for (const c of clips.slice(0, 60)) feed.push({ at: c.at, t: "clip", p: c.player, v: c.title, n: c.views, url: c.url });
feed.sort((a, b) => b.at - a.at);

const sessionsOut = fcSessions.map((s) => {
  const v = vodAt(s.p, s.a);
  // Zuschauer in 5-Minuten-Schritten ab Beginn
  const vs = [];
  for (const [at, n] of s.samples) {
    const k = Math.floor((at - s.a) / STEP);
    vs[k] = Math.max(vs[k] ?? 0, n);
  }
  return {
    p: s.p,
    a: s.a,
    b: s.b,
    seconds: Math.round(s.sec),
    avg: Math.round(s.vs / Math.max(1, s.sec)),
    peak: s.peak,
    peakAt: s.peakAt,
    followers: s.f0 !== null ? s.f1 - s.f0 : null,
    paid: s.paid,
    gift: s.gift,
    bits: s.bits,
    clips: s.clips,
    titles: s.titles.slice(0, 5),
    vod: v ? vodLink(v, s.a) : null,
    vodId: v?.id ?? null,
    vodOffset: v ? Math.max(0, Math.round((s.a - v.a) / 1000)) : null,
    v: Array.from(vs, (x) => x ?? 0),
  };
});

const binFrom = Math.floor((Date.parse("2026-10-25T22:00:00Z") - SEASON) / STEP);
const data = {
  version: 1,
  generatedAt: Date.now(),
  rule: FITNA.source,
  exclude: NOT_PLAYING.source,
  end: END,
  from: FROM,
  to: TO,
  players: out,
  sessions: sessionsOut,
  track: { start: SEASON + b0 * STEP, step: STEP, states: fcTrack },
  bins: {
    start: SEASON + binFrom * STEP,
    step: STEP,
    fc: series.fc.slice(binFrom),
    ca: series.ca.slice(binFrom),
    other: series.other.slice(binFrom),
    fcN: series.fcN.slice(binFrom),
    caN: series.caN.slice(binFrom),
    otherN: series.otherN.slice(binFrom),
  },
  days: [...days.values()].map((d) => ({
    day: d.day,
    fcVh: Math.round(d.fcVh),
    caVh: Math.round(d.caVh),
    otherVh: Math.round(d.otherVh),
    fcPeakN: d.fcPeakN,
    fcPeakV: Math.round(d.fcPeakV),
    caPeakV: Math.round(d.caPeakV),
    fcPlayers: d.fcIds.size,
    caPlayers: d.caIds.size,
  })),
  links: [...links.values()].filter((l) => l.raidsAB + l.raidsBA + l.chats + l.msgsAB + l.msgsBA + l.titleAB + l.titleBA + l.together > 0),
  raids: raids.sort((a, b) => a.at - b.at),
  shared,
  chats: chats.sort((a, b) => b.at - a.at).slice(0, 400),
  // Die meistgesehenen insgesamt plus die besten je Spieler (für Profil und Filter)
  clips: (() => {
    const seen = new Map();
    return clips.filter((c, i) => {
      const k = seen.get(c.player) ?? 0;
      seen.set(c.player, k + 1);
      return i < 120 || k < 24;
    });
  })(),
  feed: feed.slice(0, 2500),
  // Namen aller vorkommenden Spieler (auch Raid-Ziele außerhalb von FitnaCraft)
  names: Object.fromEntries(players.map((p) => [p.id, [p.name, p.uuid]])),
};
const json = JSON.stringify(data);
log(`fertig: ${out.length} Spieler, ${sessionsOut.length} Sessions, ${(json.length / 1024).toFixed(0)} KB`);
for (const p of out) console.log(`  ${p.name.padEnd(16)} ${(p.seconds / 3600).toFixed(1).padStart(6)} h  ⌀ ${String(p.avgViewers).padStart(6)} (CA ⌀ ${p.caAvgViewers ?? "–"})  +${p.followerGain} Follower  ${p.paidSubs}/${p.giftSubs} Abos  ${p.clips} Clips`);
if (process.env.FC_OUT) (await import("node:fs")).writeFileSync(process.env.FC_OUT, json);
if (!DRY) {
  await db.query(`INSERT INTO snapshots (key, at, data) VALUES ('fitnacraft', now(), $1) ON CONFLICT (key) DO UPDATE SET at = now(), data = EXCLUDED.data`, [json]);
  log("in snapshots.fitnacraft gespeichert");
}
await db.end();
