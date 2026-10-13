const DEFAULT_COOLDOWN_MS = 5 * 60_000;

let pausedUntil = 0;

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function fetchCraftAttack(
  input: string | URL,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<Response> {
  const hostname = new URL(input).hostname;
  const isCraftAttackHost = hostname === "craftattack.one" || hostname.endsWith(".craftattack.one");
  if (isCraftAttackHost && Date.now() < pausedUntil) {
    throw new Error(`craftattack.one requests paused until ${new Date(pausedUntil).toISOString()}`);
  }

  const response = await fetch(input, init);
  const challenged = response.headers.get("cf-mitigated") === "challenge";
  const blocked =
    challenged ||
    response.status === 403 ||
    response.status === 429 ||
    (response.status === 503 && response.headers.has("cf-ray"));

  if (isCraftAttackHost && blocked) {
    const waitMs = Math.max(
      DEFAULT_COOLDOWN_MS,
      retryAfterMs(response.headers.get("retry-after")) ?? 0,
    );
    pausedUntil = Date.now() + waitMs;
    console.warn(`[tracker] craftattack.one returned HTTP ${response.status}; pausing requests for ${Math.ceil(waitMs / 1000)}s`);
  }

  return response;
}
