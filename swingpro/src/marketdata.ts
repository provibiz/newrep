/**
 * Datenanbieter-Schnittstelle je Markt. Die Jobs kennen nur diese Schnittstelle; Anbieter sind austauschbar.
 * Fehlt der Zugang, liefert `MissingAccess` die genaue Lücke und den benötigten Tarif (Statusseite) – es wird nichts gebucht.
 */
import type { Bar } from "./types";
import type { Quote } from "./entry";

export interface AssetInfo {
  key: string; symbol: string; name: string; mic: string; currency: string;
  isin?: string | null; type?: string | null; attributes?: string[]; providerId?: string;
  /** Rohdaten des Anbieters (US: Alpaca-Asset) für die Klassifizierung */
  raw?: unknown;
}
export interface QuoteInfo { quote: Quote | null; sessionOpen: number | null }
export interface DataGap { what: string; provider: string; plan: string; detail: string }

export interface MarketData {
  id: string;
  /** Beschreibung für Mails/Status: Anbieter, Feed, Verzögerung */
  feedLabel: string;
  assets(): Promise<AssetInfo[]>;
  /** Split-bereinigte Tageskerzen (end = Sitzungsschluss), ab startDate bis endMs. */
  dailyBars(keys: string[], startDate: string, endMs: number): Promise<{ bars: Map<string, Bar[]>; requests: number }>;
  /** Abgeschlossene und laufende 5-Minuten-Kerzen (end = Beginn + 5 min). */
  bars5(keys: string[], startMs: number, endMs: number): Promise<Map<string, Bar[]>>;
  quotes(keys: string[], now: number): Promise<Map<string, QuoteInfo>>;
}

/** Zugang fehlt: nichts wird abgerufen, die Lücke wird sichtbar gemacht. */
export class MissingAccess extends Error {
  constructor(public gap: DataGap) { super(`${gap.what}: ${gap.detail}`); this.name = "MissingAccess"; }
}
export class RateLimited extends Error { constructor(msg = "Rate-Limit des Datenanbieters erreicht – Fortsetzung im nächsten Lauf") { super(msg); this.name = "RateLimited"; } }

export function missingData(gap: DataGap): MarketData {
  const fail = async (): Promise<never> => { throw new MissingAccess(gap); };
  return { id: "missing", feedLabel: `nicht verfügbar (${gap.provider})`, assets: fail, dailyBars: fail, bars5: fail, quotes: fail };
}
