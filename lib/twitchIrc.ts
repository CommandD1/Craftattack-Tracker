import "server-only";
import { createHash } from "node:crypto";
import { appendLiveEvent, getEvents, getState } from "./store";
import { KNOWN_LOGINS } from "./tracker";
import type { PlayerState, TrackerEvent } from "./types";

const IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const SYNC_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_SEEN_IDS = 10_000;
const SUB_NOTICE_TYPES: Record<string, string> = {
  sub: "Neues Abo",
  resub: "Resub",
  subgift: "Geschenk-Abo",
  anonsubgift: "Anonymes Geschenk-Abo",
  "anon-subgift": "Anonymes Geschenk-Abo",
  submysterygift: "Community-Geschenke",
  anonsubmysterygift: "Anonyme Community-Geschenke",
  "anon-submysterygift": "Anonyme Community-Geschenke",
  giftpaidupgrade: "Geschenk-Abo fortgeführt",
  anongiftpaidupgrade: "Anonymes Geschenk-Abo fortgeführt",
  primepaidupgrade: "Prime-Abo fortgeführt",
  standardpayforward: "Weitergegebenes Geschenk-Abo",
  communitypayforward: "Weitergegebene Community-Geschenke",
};

export interface TwitchIrcMessage {
  tags: Record<string, string>;
  command: string;
  params: string[];
  trailing: string | null;
}

function unescapeTag(value: string): string {
  return value.replace(/\\([snr:\\])/g, (_match, escaped: string) => {
    switch (escaped) {
      case "s": return " ";
      case "n": return "\n";
      case "r": return "\r";
      case ":": return ";";
      default: return "\\";
    }
  });
}

export function parseTwitchIrcMessage(line: string): TwitchIrcMessage | null {
  const match = /^(?:@([^ ]+) )?(?::([^ ]+) )?([^ ]+)(?: (.*))?$/.exec(line);
  if (!match) return null;
  const tags: Record<string, string> = {};
  for (const part of (match[1] ?? "").split(";")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const key = separator < 0 ? part : part.slice(0, separator);
    tags[key] = separator < 0 ? "" : unescapeTag(part.slice(separator + 1));
  }

  const rest = match[4] ?? "";
  const trailingAt = rest.indexOf(" :");
  const paramsText = trailingAt < 0 ? rest : rest.slice(0, trailingAt);
  const trailing = trailingAt < 0 ? null : rest.slice(trailingAt + 2);
  return {
    tags,
    command: match[3],
    params: paramsText ? paramsText.split(" ") : [],
    trailing,
  };
}

export interface ChannelOwner {
  id: string;
  name: string;
  uuid: string;
}

interface IrcState {
  socket: WebSocket | null;
  registered: boolean;
  joined: Set<string>;
  desired: Map<string, ChannelOwner>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  syncTimer: ReturnType<typeof setInterval> | null;
  processing: Promise<void>;
  seenIds: Set<string>;
  seenOrder: string[];
  warnedChannelCount: number;
}

type Globals = typeof globalThis & { __acTwitchIrc?: IrcState };

function state(): IrcState {
  const gl = globalThis as Globals;
  if (!gl.__acTwitchIrc) {
    gl.__acTwitchIrc = {
      socket: null,
      registered: false,
      joined: new Set(),
      desired: new Map(),
      reconnectTimer: null,
      syncTimer: null,
      processing: Promise.resolve(),
      seenIds: new Set(),
      seenOrder: [],
      warnedChannelCount: 0,
    };
  }
  return gl.__acTwitchIrc;
}

function ircCredentials(): { nick: string | null; token: string | null } {
  const nick = process.env.TWITCH_IRC_NICK?.trim().toLowerCase() || null;
  const rawToken = process.env.TWITCH_IRC_TOKEN?.trim() || null;
  const token = rawToken?.replace(/^oauth:/i, "") ?? null;
  if (Boolean(nick) !== Boolean(token)) {
    throw new Error("TWITCH_IRC_NICK und TWITCH_IRC_TOKEN müssen gemeinsam gesetzt sein.");
  }
  if ((nick && !/^[a-z0-9_]{1,25}$/.test(nick)) || (token && /[\r\n ]/.test(token))) {
    throw new Error("Ungültige Twitch-IRC-Zugangsdaten in TWITCH_IRC_NICK/TWITCH_IRC_TOKEN.");
  }
  return { nick, token };
}

function rememberEventId(irc: IrcState, id: string) {
  irc.seenIds.add(id);
  irc.seenOrder.push(id);
  if (irc.seenOrder.length > MAX_SEEN_IDS) {
    const expired = irc.seenOrder.shift();
    if (expired) irc.seenIds.delete(expired);
  }
}

function safeChannel(value: string): string | null {
  const login = value.trim().replace(/^#/, "").toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : null;
}

function mappedChannels(players: Record<string, PlayerState>): Map<string, ChannelOwner> {
  const channels = new Map<string, ChannelOwner>();
  const ordered = Object.values(players).sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)));
  for (const player of ordered) {
    const login = safeChannel(player.twitchLogin ?? player.id);
    if (login && !channels.has(login)) channels.set(login, { id: player.id, name: player.name, uuid: player.uuid });
  }
  for (const [id, twitchLogin] of Object.entries(KNOWN_LOGINS)) {
    const login = safeChannel(twitchLogin);
    if (login && !channels.has(login)) {
      const player = players[id];
      channels.set(login, player
        ? { id, name: player.name, uuid: player.uuid }
        : { id, name: id, uuid: "" });
    }
  }
  return channels;
}

function reconcileChannels(irc: IrcState) {
  const credentials = ircCredentials();
  const maxChannels = credentials.nick ? 100 : 20;
  const candidates = [...irc.desired.keys()];
  const selected = new Set(candidates.slice(0, maxChannels));
  if (candidates.length > maxChannels && irc.warnedChannelCount !== candidates.length) {
    console.warn(`[twitch-irc] ${candidates.length} Kanäle bekannt, aber nur ${maxChannels} abonnierbar; OAuth erhöht das Limit.`);
    irc.warnedChannelCount = candidates.length;
  }
  const socket = irc.socket;
  if (!socket || !irc.registered || socket.readyState !== WebSocket.OPEN) return;

  for (const channel of irc.joined) {
    if (!selected.has(channel)) socket.send(`PART #${channel}\r\n`);
  }
  for (const channel of selected) {
    if (!irc.joined.has(channel)) socket.send(`JOIN #${channel}\r\n`);
  }
  irc.joined = selected;
}

function scheduleReconnect(irc: IrcState) {
  if (irc.reconnectTimer) return;
  irc.reconnectTimer = setTimeout(() => {
    irc.reconnectTimer = null;
    connect(irc);
  }, RECONNECT_DELAY_MS);
}

function connect(irc: IrcState) {
  if (irc.socket || typeof WebSocket === "undefined") {
    if (typeof WebSocket === "undefined") console.error("[twitch-irc] WebSocket ist in dieser Node.js-Runtime nicht verfügbar.");
    return;
  }
  try {
    const credentials = ircCredentials();
    const socket = new WebSocket(IRC_URL);
    irc.socket = socket;
    irc.registered = false;
    irc.joined.clear();
    socket.addEventListener("open", () => {
      socket.send(`PASS ${credentials.token ? `oauth:${credentials.token}` : "SCHMOOPIIE"}\r\n`);
      socket.send(`NICK ${credentials.nick ?? `justinfan${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`}\r\n`);
      socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      for (const line of event.data.split(/\r\n/)) {
        if (!line) continue;
        irc.processing = irc.processing
          .then(() => handleLine(irc, socket, line))
          .catch((error: unknown) => {
            console.error("[twitch-irc] IRC-Nachricht konnte nicht verarbeitet werden:", error);
          });
      }
    });
    socket.addEventListener("close", () => {
      if (irc.socket === socket) irc.socket = null;
      irc.registered = false;
      irc.joined.clear();
      scheduleReconnect(irc);
    });
    socket.addEventListener("error", () => {
      console.error("[twitch-irc] WebSocket-Verbindung fehlgeschlagen.");
      socket.close();
    });
  } catch (error) {
    console.error("[twitch-irc] Verbindung konnte nicht gestartet werden:", error instanceof Error ? error.message : error);
  }
}

export function subscriptionEventFromNotice(message: TwitchIrcMessage, owner?: ChannelOwner): TrackerEvent | null {
  if (message.command !== "USERNOTICE") return null;
  const msgId = message.tags["msg-id"];
  const kind = msgId ? SUB_NOTICE_TYPES[msgId] : null;
  const channel = safeChannel(message.params[0] ?? "");
  if (!kind || !channel) return null;

  const sentAt = Number(message.tags["tmi-sent-ts"]);
  const timestamp = new Date(sentAt);
  const at = Number.isFinite(sentAt) && sentAt > 0 && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : new Date().toISOString();
  const login = message.tags.login || message.tags["display-name"] || "";
  const subscriber = message.tags["display-name"] || login || "Unbekannt";
  const months = Number(message.tags["msg-param-cumulative-months"] ?? message.tags["msg-param-months"]);
  const idSource = message.tags.id ?? `${channel}:${at}:${msgId}:${login}:${message.trailing ?? ""}`;
  const id = `twitch-irc-${createHash("sha256").update(idSource).digest("hex").slice(0, 32)}`;
  const meta: NonNullable<TrackerEvent["meta"]> = {
    channel,
    kind,
    subscriber,
    msgId,
  };
  if (Number.isFinite(months) && months > 0) meta.months = months;
  const plan = message.tags["msg-param-sub-plan"];
  if (plan) meta.plan = plan;
  const planName = message.tags["msg-param-sub-plan-name"];
  if (planName) meta.planName = planName;
  const giftCount = Number(message.tags["msg-param-mass-gift-count"]);
  if (Number.isFinite(giftCount) && giftCount > 0) meta.giftCount = giftCount;
  const giftMonths = Number(message.tags["msg-param-gift-months"]);
  if (Number.isFinite(giftMonths) && giftMonths > 0) meta.giftMonths = giftMonths;
  const recipient = message.tags["msg-param-recipient-display-name"] || message.tags["msg-param-recipient-user-name"];
  if (recipient) meta.recipient = recipient;
  if (message.trailing) meta.message = message.trailing;

  const event: TrackerEvent = { id, at, type: "subscription", where: "twitch", meta };
  if (owner) {
    event.player = owner.id;
    event.playerName = owner.name;
    if (owner.uuid) event.uuid = owner.uuid;
  }
  return event;
}

async function handleLine(irc: IrcState, socket: WebSocket, line: string) {
  if (line.startsWith("PING ")) {
    socket.send(line.replace(/^PING/, "PONG") + "\r\n");
    return;
  }
  const message = parseTwitchIrcMessage(line);
  if (!message) return;
  if (message.command === "RECONNECT") {
    socket.close();
    return;
  }
  if (message.command === "NOTICE" || message.command === "ERROR") {
    console.warn("[twitch-irc] Twitch-Servermeldung:", message.trailing ?? line);
    return;
  }
  if (message.command === "CAP" && line.includes(" NAK ")) {
    console.error("[twitch-irc] Twitch hat die angeforderten IRC-Funktionen abgelehnt.");
    socket.close();
    return;
  }
  if (message.command === "001") {
    irc.registered = true;
    reconcileChannels(irc);
    return;
  }
  const event = subscriptionEventFromNotice(message, irc.desired.get(safeChannel(message.params[0] ?? "") ?? ""));
  if (!event || irc.seenIds.has(event.id)) return;
  if (await appendLiveEvent(event)) rememberEventId(irc, event.id);
}

async function syncChannels(irc: IrcState) {
  const current = await getState();
  const channels = mappedChannels(current.players);
  irc.desired = channels;
  reconcileChannels(irc);
  connect(irc);
}

/** Startet den IRC-Empfang einmal pro Node-Prozess. */
export function startTwitchIrc() {
  const irc = state();
  if (irc.syncTimer) return;
  try {
    ircCredentials();
  } catch (error) {
    console.error("[twitch-irc] IRC deaktiviert:", error instanceof Error ? error.message : error);
    return;
  }
  void getEvents().then((events) => {
    for (const event of events) {
      if (event.id.startsWith("twitch-irc-")) rememberEventId(irc, event.id);
    }
    void syncChannels(irc).catch((error: unknown) => {
      console.error("[twitch-irc] Kanäle konnten nicht synchronisiert werden:", error);
    });
  }).catch((error: unknown) => {
    console.error("[twitch-irc] Ereignisse konnten nicht geladen werden:", error);
  });
  irc.syncTimer = setInterval(() => {
    void syncChannels(irc).catch((error: unknown) => {
      console.error("[twitch-irc] Kanäle konnten nicht synchronisiert werden:", error);
    });
  }, SYNC_INTERVAL_MS);
}
