/**
 * NYSE-Handelskalender (berechnet). Regeln: nyse.com/trade/hours-calendars.
 * Feiertage auf Samstag werden – außer Neujahr – am Freitag, auf Sonntag am Montag beobachtet.
 * Früher Schluss 13:00 ET: Tag nach Thanksgiving, 24.12. (Mo–Do), 3.7. (wenn 4.7. Di–Fr).
 * Außerplanmäßige Schließungen kennt die Berechnung nicht; der Live-Betrieb prüft deshalb zusätzlich /v2/clock.
 */
import { addDays, dowOf, nyToUtc, parseDateKey, pad } from "./time";

const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function nthWeekday(y: number, m: number, dow: number, n: number): string {
  const first = dowOf(key(y, m, 1));
  const day = 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
  return key(y, m, day);
}
function lastWeekday(y: number, m: number, dow: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ld = dowOf(key(y, m, last));
  return key(y, m, last - ((ld - dow + 7) % 7));
}
export function easterSunday(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(y, month, day);
}
/** Beobachtungsregel: Sa -> Fr, So -> Mo (nicht für Neujahr). */
function observed(k: string, saturdayToFriday = true): string | null {
  const dow = dowOf(k);
  if (dow === 6) return saturdayToFriday ? addDays(k, -1) : null;
  if (dow === 0) return addDays(k, 1);
  return k;
}

const holidayCache = new Map<number, Map<string, string>>();
export function holidays(y: number): Map<string, string> {
  let h = holidayCache.get(y);
  if (h) return h;
  h = new Map();
  const add = (k: string | null, name: string) => { if (k) h!.set(k, name); };
  add(observed(key(y, 1, 1), false), "Neujahr");
  add(nthWeekday(y, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekday(y, 2, 1, 3), "Presidents’ Day");
  add(addDays(easterSunday(y), -2), "Karfreitag");
  add(lastWeekday(y, 5, 1), "Memorial Day");
  if (y >= 2022) add(observed(key(y, 6, 19)), "Juneteenth");
  add(observed(key(y, 7, 4)), "Independence Day");
  add(nthWeekday(y, 9, 1, 1), "Labor Day");
  add(nthWeekday(y, 11, 4, 4), "Thanksgiving");
  add(observed(key(y, 12, 25)), "Weihnachten");
  holidayCache.set(y, h);
  return h;
}
/** Neujahr auf Samstag (1.1.) wird nicht beobachtet; fällt der 31.12. des Vorjahres darauf, bleibt geöffnet – siehe observed(…, false). */
export function isHoliday(k: string): string | null {
  const { y } = parseDateKey(k);
  return holidays(y).get(k) ?? holidays(y + 1).get(k) ?? null;
}

export interface Session { date: string; open: number; close: number; early: boolean }

export function earlyCloseDates(y: number): Set<string> {
  const s = new Set<string>();
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  s.add(addDays(thanksgiving, 1));
  const dec24 = key(y, 12, 24);
  if (dowOf(dec24) >= 1 && dowOf(dec24) <= 4) s.add(dec24);
  const jul4dow = dowOf(key(y, 7, 4));
  if (jul4dow >= 2 && jul4dow <= 5) s.add(key(y, 7, 3));
  return s;
}

export function sessionFor(k: string): Session | null {
  const dow = dowOf(k);
  if (dow === 0 || dow === 6 || isHoliday(k)) return null;
  const { y, m, d } = parseDateKey(k);
  const early = earlyCloseDates(y).has(k);
  return { date: k, open: nyToUtc(y, m, d, 9, 30), close: nyToUtc(y, m, d, early ? 13 : 16, 0), early };
}
export function isSessionDay(k: string): boolean { return sessionFor(k) !== null; }

export function previousSession(k: string): string {
  let d = addDays(k, -1);
  while (!isSessionDay(d)) d = addDays(d, -1);
  return d;
}
export function nextSession(k: string): string {
  let d = addDays(k, 1);
  while (!isSessionDay(d)) d = addDays(d, 1);
  return d;
}

/**
 * Letzte Sitzung, die zum Zeitpunkt now vollständig abgeschlossen ist
 * (Schluss + bufferMin Minuten Nachlauf für Datenlieferung).
 */
export function lastCompletedSession(now: number, bufferMin = 0): string {
  let d = addDays(new Date(now).toISOString().slice(0, 10), 1);
  for (let i = 0; i < 12; i++) {
    d = addDays(d, -1);
    const s = sessionFor(d);
    if (s && s.close + bufferMin * 60_000 <= now) return d;
  }
  throw new Error("Keine abgeschlossene Sitzung gefunden");
}

/** Abgeschlossene Handelsstunden-Kerzen (Beginn 09:30 + k·60 min, nur volle Stunden) einer Sitzung. */
export function hourlyBoundaries(s: Session): number[] {
  const ends: number[] = [];
  for (let t = s.open + 3_600_000; t <= s.close; t += 3_600_000) ends.push(t);
  return ends;
}
