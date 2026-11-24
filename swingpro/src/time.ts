/** Zeitzonen- und Formatierungshilfen (Europe/Berlin, America/New_York) ohne Fremdbibliotheken. */

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface Parts { y: number; m: number; d: number; h: number; min: number; s: number; dow: number }

/** dow: 0=So … 6=Sa */
export function partsIn(ms: number, tz: string): Parts {
  const o: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, s: +o.second, dow: dows.indexOf(o.weekday) };
}
export const ny = (ms: number) => partsIn(ms, "America/New_York");
export const berlin = (ms: number) => partsIn(ms, "Europe/Berlin");

/** Offset (ms) der Zone gegenüber UTC zum Zeitpunkt ms. */
export function offsetMs(ms: number, tz: string): number {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Wandzeit in der Zone -> UTC ms (springt bei nicht existierenden Zeiten vorwärts). */
export function zonedToUtc(tz: string, y: number, m: number, d: number, h = 0, min = 0): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}
export const nyToUtc = (y: number, m: number, d: number, h = 0, min = 0) => zonedToUtc("America/New_York", y, m, d, h, min);

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const dateKey = (p: { y: number; m: number; d: number }) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
export const nyDate = (ms: number) => dateKey(ny(ms));

export function parseDateKey(k: string): { y: number; m: number; d: number } {
  const [y, m, d] = k.split("-").map(Number);
  return { y, m, d };
}
/** Kalendertag +n (reine Datumsarithmetik, ohne Zeitzone). */
export function addDays(k: string, n: number): string {
  const { y, m, d } = parseDateKey(k);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function dowOf(k: string): number {
  const { y, m, d } = parseDateKey(k);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "24.11.2026 16:35 Uhr MEZ" in Berlin. */
export function formatBerlin(ms: number, withZone = true): string {
  const p = berlin(ms);
  const zone = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", timeZoneName: "short" })
    .formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")?.value ?? "";
  return `${pad(p.d)}.${pad(p.m)}.${p.y} ${pad(p.h)}:${pad(p.min)}${p.s ? ":" + pad(p.s) : ""} Uhr${withZone ? " " + zone : ""}`;
}
export function formatBerlinTime(ms: number): string {
  const p = berlin(ms);
  return `${pad(p.h)}:${pad(p.min)}:${pad(p.s)}`;
}
export function formatNy(ms: number): string {
  const p = ny(ms);
  return `${pad(p.h)}:${pad(p.min)} New York`;
}
/** Stundenunterschied Berlin − New York zum Zeitpunkt (normal 6, in einzelnen Wochen 5). */
export function berlinMinusNyHours(ms: number): number {
  return (offsetMs(ms, "Europe/Berlin") - offsetMs(ms, "America/New_York")) / HOUR;
}
export const iso = (ms: number) => new Date(ms).toISOString();
