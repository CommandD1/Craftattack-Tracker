/**
 * User-Agent aller Anfragen nach außen: nennt Projekt und Kontakt, damit Betreiber (craftattack.one, mc-heads.net)
 * den Tracker in ihren Logs zuordnen und sich melden können, statt ihn nur als unbekannten Bot zu sperren.
 */
export const USER_AGENT = "actracker/1.0 (+https://craftattack.hiorcraft.tv; hello@hxo.dev)";

const BASE_COOLDOWN_MS = 5 * 60_000;
const MAX_COOLDOWN_MS = 6 * 60 * 60_000;
const STRIKE_RESET_MS = 24 * 60 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

interface OriginState {
  strikes: number;
  pausedUntil: number;
  lastBlockedAt: number;
}

const origins = new Map<string, OriginState>();

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 8.64e15 - Date.now());
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - Date.now()), 8.64e15 - Date.now());
}

function originOf(input: string | URL): string {
  return new URL(input).origin;
}

export function getCraftAttackPauseMs(input?: string | URL): number {
  const now = Date.now();
  if (input) return Math.max(0, (origins.get(originOf(input))?.pausedUntil ?? 0) - now);
  return Math.max(0, ...[...origins.values()].map((state) => state.pausedUntil - now));
}

export function craftAttackPausedResponse(input: string | URL): Response | null {
  const pauseMs = getCraftAttackPauseMs(input);
  if (pauseMs === 0) return null;
  return new Response(null, {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": String(Math.max(1, Math.ceil(pauseMs / 1000))) },
  });
}

export async function fetchCraftAttack(
  input: string | URL,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<Response> {
  const origin = originOf(input);
  const now = Date.now();
  const state = origins.get(origin);
  if (state && now < state.pausedUntil) {
    throw new Error(`Requests to ${origin} paused until ${new Date(state.pausedUntil).toISOString()}`);
  }

  const response = await fetch(input, init);
  const challenged = response.headers.get("cf-mitigated")?.toLowerCase() === "challenge";
  const cloudflareError =
    response.status === 403 ||
    response.status === 429 ||
    (response.status >= 500 && response.status <= 599 && response.headers.has("cf-ray"));

  if (challenged || cloudflareError) {
    const blockedAt = Date.now();
    const current = origins.get(origin) ?? { strikes: 0, pausedUntil: 0, lastBlockedAt: 0 };
    if (blockedAt - current.lastBlockedAt >= STRIKE_RESET_MS) current.strikes = 0;
    current.strikes += 1;
    current.lastBlockedAt = blockedAt;

    const exponentialCooldown = Math.min(
      MAX_COOLDOWN_MS,
      BASE_COOLDOWN_MS * 2 ** Math.min(current.strikes - 1, 20),
    );
    const waitMs = Math.max(exponentialCooldown, retryAfterMs(response.headers.get("retry-after")) ?? 0);
    current.pausedUntil = blockedAt + waitMs;
    origins.set(origin, current);

    const rayId = response.headers.get("cf-ray");
    console.warn(
      `[tracker] ${origin} returned HTTP ${response.status}${challenged ? " with a Cloudflare challenge" : ""}` +
        `${rayId ? ` (CF-Ray ${rayId})` : ""}; pausing requests for ${Math.ceil(waitMs / 1000)}s (strike ${current.strikes})`,
    );
  }

  return response;
}

export function maxCraftAttackTimerDelay(delay: number): number {
  return Math.min(Math.max(0, delay), MAX_TIMER_DELAY_MS);
}
