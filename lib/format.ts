const nf = new Intl.NumberFormat("de-DE");
const dtf = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});
const tf = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

export const num = (n: number) => nf.format(Math.round(n));

export function duration(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} T ${h} Std`;
  if (h > 0) return `${h} Std ${m} Min`;
  return `${m} Min`;
}

export function distance(m: number) {
  const r = Math.round(m);
  return r >= 1000 ? `${nf.format(Math.round(r / 100) / 10)} km` : `${r} m`;
}

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "–";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s)) return "–";
  if (s < 90) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(s / 3600);
  if (h < 24) return `vor ${h} Std`;
  return `vor ${Math.round(s / 86400)} T`;
}

export const dateTime = (iso: string) => dtf.format(new Date(iso));
export const time = (iso: string) => tf.format(new Date(iso));

export function boardValue(key: string, v: number) {
  switch (key) {
    case "playtimeSeconds":
      return duration(v);
    case "distance":
      return distance(v);
    default:
      return num(v);
  }
}

export const headUrl = (uuid: string | undefined, size = 32) =>
  uuid
    ? `https://mc-heads.net/avatar/${uuid}/${size}`
    : `https://mc-heads.net/avatar/MHF_Steve/${size}`;
