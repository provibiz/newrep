/**
 * Märkte: USA (Nasdaq/NYSE, USD) und Deutschland (Xetra, EUR). Je Markt: Zeitzone, Währung, Handelskalender und Datenanbieter.
 * Ein Kurs aus einem Markt ist nie Ersatz für den anderen. Instrumente werden über einen Schlüssel eindeutig geführt:
 * US = Ticker (rückwärtskompatibel), Xetra = „XETR:<Mnemonic>“.
 */
import { addDays, dateKey, partsIn, zonedToUtc, parseDateKey } from "./time";
import { easterSunday, sessionFor as usSession, previousSession as usPrev, nextSession as usNext, lastCompletedSession as usLast, type Session } from "./calendar";
import type { MarketData } from "./marketdata";

export type MarketId = "US" | "DE";

export interface Market {
  id: MarketId; label: string; tz: string; currency: string; mics: string[];
  /** Verzögerung der Tagesdaten in Minuten nach Handelsschluss (SIP-Historie: 15 Minuten) */
  dailyDelayMin: number;
  dateOf(ms: number): string;
  sessionFor(date: string): Session | null;
  previousSession(date: string): string;
  nextSession(date: string): string;
  lastCompletedSession(now: number, bufferMin?: number): string;
  /** Die letzte Handelsstunde, in der noch neue Einstiege erlaubt sind (Ende der letzten vollen Stunde ab Eröffnung). */
  data: MarketData;
}

// ───────── Xetra-Kalender (Handelstage laut Deutsche Börse; gegen den offiziellen Kalender prüfen, siehe ZUGAENGE.md) ─────────
const key = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const xetraHolidayCache = new Map<number, Map<string, string>>();
/** Xetra bleibt an Neujahr, Karfreitag, Ostermontag, 1. Mai, 24./25./26./31. Dezember geschlossen. */
export function xetraHolidays(y: number): Map<string, string> {
  let h = xetraHolidayCache.get(y);
  if (h) return h;
  h = new Map();
  const easter = easterSunday(y);
  h.set(key(y, 1, 1), "Neujahr"); h.set(addDays(easter, -2), "Karfreitag"); h.set(addDays(easter, 1), "Ostermontag"); h.set(key(y, 5, 1), "Tag der Arbeit");
  h.set(key(y, 12, 24), "Heiligabend"); h.set(key(y, 12, 25), "1. Weihnachtstag"); h.set(key(y, 12, 26), "2. Weihnachtstag"); h.set(key(y, 12, 31), "Silvester");
  xetraHolidayCache.set(y, h);
  return h;
}
const dow = (k: string) => { const { y, m, d } = parseDateKey(k); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export function xetraSession(k: string): Session | null {
  const w = dow(k);
  if (w === 0 || w === 6 || xetraHolidays(parseDateKey(k).y).has(k)) return null;
  const { y, m, d } = parseDateKey(k);
  // 30.12. (Jahresschlussbörse) ist laut Deutsche Börse verkürzt; die Zeiten stehen nicht in unseren Quellen → als verkürzt markiert, keine neuen Einstiege
  const early = m === 12 && d === 30;
  return { date: k, open: zonedToUtc("Europe/Berlin", y, m, d, 9, 0), close: zonedToUtc("Europe/Berlin", y, m, d, 17, 30), early };
}
export const berlinDate = (ms: number) => dateKey(partsIn(ms, "Europe/Berlin"));
const prevOf = (sess: (k: string) => Session | null) => (k: string) => { let d = addDays(k, -1); while (!sess(d)) d = addDays(d, -1); return d; };
const nextOf = (sess: (k: string) => Session | null) => (k: string) => { let d = addDays(k, 1); while (!sess(d)) d = addDays(d, 1); return d; };
const lastOf = (sess: (k: string) => Session | null) => (now: number, bufferMin = 0) => {
  let d = addDays(new Date(now).toISOString().slice(0, 10), 1);
  for (let i = 0; i < 12; i++) { d = addDays(d, -1); const s = sess(d); if (s && s.close + bufferMin * 60_000 <= now) return d; }
  throw new Error("Keine abgeschlossene Sitzung gefunden");
};

export function usMarket(data: MarketData): Market {
  return { id: "US", label: "USA (Nasdaq/NYSE)", tz: "America/New_York", currency: "USD", mics: ["XNAS", "XNYS"], dailyDelayMin: 16,
    dateOf: (ms) => dateKey(partsIn(ms, "America/New_York")), sessionFor: usSession, previousSession: usPrev, nextSession: usNext, lastCompletedSession: usLast, data };
}
export function deMarket(data: MarketData): Market {
  return { id: "DE", label: "Deutschland (Xetra)", tz: "Europe/Berlin", currency: "EUR", mics: ["XETR"], dailyDelayMin: 0,
    dateOf: berlinDate, sessionFor: xetraSession, previousSession: prevOf(xetraSession), nextSession: nextOf(xetraSession), lastCompletedSession: lastOf(xetraSession), data };
}
export const marketOfKey = (key: string): MarketId => (key.startsWith("XETR:") ? "DE" : "US");
export const displaySymbol = (key: string) => key.replace(/^[A-Z]{4}:/, "");
export const instKey = (mic: string, symbol: string) => (mic === "XETR" ? `XETR:${symbol}` : symbol);
export { zonedToUtc };
