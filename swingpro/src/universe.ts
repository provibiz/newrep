/** Universum (Nasdaq/NYSE-Stammaktien) und tägliche Vorauswahl. */
import type { Bar } from "./types";
import type { Config } from "./config";
import type { AssetRaw } from "./providers";
import type { AssetInfo } from "./marketdata";
import { isValidIsin } from "./instruments";

export interface AssetVerdict { included: boolean; reason: string | null }

const ETF_NAME = /\b(ETF|ETN|ETP|Fund|Funds|Warrants?|Units?|Rights?|Preferred|Pref|Depositary Shares|Notes?|Debentures?|Subordinated)\b|%|\b(iShares|SPDR|ProShares|Direxion|Vanguard|WisdomTree|VanEck|GraniteShares|Teucrium|Grayscale|Global X|Roundhill|Invesco [A-Z0-9 ]+ (Trust|ETF)|Bitcoin Trust|Ether(eum)? Trust)\b/i;
const ADR_NAME = /\b(ADR|ADS|American Depositary)\b/i;
const SPAC_NAME = /\bAcquisition (Corp|Co|Corporation|Company)\b|\bBlank Check\b/i;

/**
 * Klassifiziert ein Alpaca-Asset. Heuristik auf Namen und Symbolformen, da die Assets-API kein ETF-Flag liefert.
 * ADRs sind standardmäßig ausgeschlossen (Quartalsdaten oft in anderer Währung/Form 20-F), per INCLUDE_ADRS zuschaltbar.
 */
export function classifyAsset(a: AssetRaw, cfg: Config): AssetVerdict {
  const no = (reason: string): AssetVerdict => ({ included: false, reason });
  const sym = a.symbol.toUpperCase();
  if (cfg.includeSymbols.includes(sym)) return { included: true, reason: null };
  if (cfg.excludeSymbols.includes(sym)) return no("manuell ausgeschlossen");
  if (a.class !== "us_equity" || a.status !== "active") return no("nicht aktiv/keine US-Aktie");
  if (!a.tradable) return no("nicht handelbar");
  if (!cfg.allowedExchanges.includes(a.exchange)) return no(`Börse ${a.exchange}`);
  if (!/^[A-Z]{1,5}(\.[AB])?$/.test(sym)) return no("Symbolform (Preferred/Warrant/Unit/Recht)");
  if (/^[A-Z]{4}[WURQ]$/.test(sym) && a.exchange === "NASDAQ") return no("Nasdaq-Suffix W/U/R/Q (Warrant/Unit/Recht/Insolvenz)");
  if (/^[A-Z]{4}[YF]$/.test(sym) && a.exchange === "NASDAQ" && !cfg.includeAdrs) return no("Nasdaq-Suffix Y/F (ADR/Auslandstitel)");
  if (SPAC_NAME.test(a.name ?? "")) return no("SPAC/Mantel");
  if (ETF_NAME.test(a.name ?? "")) return no("ETF/ETN/Fonds/Sonderinstrument (Name)");
  if (!cfg.includeAdrs && ADR_NAME.test(a.name ?? "")) return no("ADR");
  if ((a.attributes ?? []).includes("ipo")) return no("Neuemission (noch nicht regulär gehandelt)");
  return { included: true, reason: null };
}

export type ShareClass = "common" | "preferred" | "class_a" | "class_b" | "other";
export interface Classified { included: boolean; reason: string | null; shareClass: ShareClass; isin: string | null }

/** Aktiengattung eindeutig bestimmen (Vorzugsaktien „Vz.“ sind eigene Instrumente mit eigener ISIN, getrennt von der Stammaktie). */
export function shareClassOf(name: string, symbol = ""): ShareClass {
  if (/\b(Vz\.?|Vzo|Vorzug\w*|Pref\w*)\b/i.test(name)) return "preferred";
  if (/\.A$/.test(symbol) || /\bClass A\b/i.test(name)) return "class_a";
  if (/\.B$/.test(symbol) || /\bClass B\b/i.test(name)) return "class_b";
  return "common";
}
const DE_EXCLUDE_TYPE = /(ETF|ETC|ETN|ETP|Fund|Warrant|Bond|Right|Certificate|Note|Index|Structured|Unit)/i;
const DE_EXCLUDE_NAME = /\b(ETF|ETC|ETN|UCITS|Zertifikat|Fonds?|Anleihe|Optionsschein|Index\s*Fund|Tracker|Bonus|Turbo|Hebel)\b/i;
/**
 * Xetra: Stammaktien und Vorzugsaktien in EUR. ETFs/ETCs/ETNs, Fonds, Zertifikate, Anleihen und Optionsscheine sind ausgeschlossen
 * (Typ des Anbieters, sonst Namensheuristik). Ohne ISIN-Angabe des Anbieters wird die Aktie geführt, die Lücke aber gezählt.
 */
export function classifyDe(a: AssetInfo, cfg: Config): Classified {
  const shareClass = shareClassOf(a.name, a.symbol);
  const isin = a.isin && isValidIsin(a.isin) ? a.isin : null;
  const no = (reason: string): Classified => ({ included: false, reason, shareClass, isin });
  if (cfg.excludeSymbols.includes(a.symbol.toUpperCase())) return no("manuell ausgeschlossen");
  if (a.mic !== "XETR") return no(`Handelsplatz ${a.mic}`);
  if (a.currency !== "EUR") return no(`Währung ${a.currency} (nur EUR)`);
  if (!/^[A-Z0-9]{2,6}$/.test(a.symbol)) return no("Symbolform");
  if (a.type && DE_EXCLUDE_TYPE.test(a.type)) return no(`Typ ${a.type}`);
  if (a.type && !/(Common|Preferred|Stock|Equity|Share|REIT|Depositary)/i.test(a.type)) return no(`Typ ${a.type}`);
  if (/Depositary/i.test(a.type ?? "")) return no("Hinterlegungsschein");
  if (DE_EXCLUDE_NAME.test(a.name)) return no("ETF/Fonds/Zertifikat (Name)");
  return { included: true, reason: null, shareClass, isin };
}

export interface Metrics { symbol: string; asof: string; price: number; adv: number; rangePct: number; ret63: number; days: number; nh?: number; nl?: number; a50?: number; a200?: number }

export function computeMetrics(symbol: string, daily: Bar[], asof: string): Metrics | null {
  if (daily.length < 64) return null;
  const last20 = daily.slice(-20);
  const price = daily[daily.length - 1].c;
  const adv = last20.reduce((s, b) => s + b.c * b.v, 0) / 20;
  const rangePct = (last20.reduce((s, b) => s + (b.h - b.l) / b.c, 0) / 20) * 100;
  const ret63 = price / daily[daily.length - 64].c - 1;
  const last = daily[daily.length - 1], n = daily.length;
  const prior = daily.slice(-252, -1);
  const full = n >= 252;
  const sma = (k: number) => (n >= k ? daily.slice(-k).reduce((x, b) => x + b.c, 0) / k : NaN);
  return { symbol, asof, price, adv, rangePct, ret63, days: n,
    nh: full && last.h > Math.max(...prior.map((b) => b.h)) ? 1 : 0, nl: full && last.l < Math.min(...prior.map((b) => b.l)) ? 1 : 0,
    a50: price > sma(50) ? 1 : 0, a200: price > sma(200) ? 1 : 0 };
}

export interface PrefilterRow extends Metrics { rsPct: number; passed: boolean; reason: string | null; rank?: number }
export interface Thresholds { minPrice: number; minTurnover: number; minRangePct: number; maxRangePct: number; minRs: number; minHistory: number; maxWatch: number; currency: string }
export const usThresholds = (c: Config): Thresholds => ({ minPrice: c.minPrice, minTurnover: c.minDollarVolume, minRangePct: c.minRangePct, maxRangePct: c.maxRangePct, minRs: c.minRsPercentile, minHistory: c.minHistoryDays, maxWatch: c.maxWatch, currency: "USD" });
export const deThresholds = (c: Config): Thresholds => ({ ...usThresholds(c), minPrice: c.deMinPrice, minTurnover: c.deMinTurnover, maxWatch: c.deMaxWatch, currency: "EUR" });
export interface PrefilterStats {
  available: number; excluded: number; excludedByReason: Record<string, number>;
  dataGaps: number; considered: number; passedLiquidity: number; watch: number;
}

/** Stufenweise Vorauswahl. RS-Perzentil wird unter den liquiden Titeln berechnet. */
export function prefilter(cfg: Config, metrics: Map<string, Metrics | null>, stats0: { available: number; excludedByReason: Record<string, number> }, thr: Thresholds = usThresholds(cfg)): { rows: PrefilterRow[]; stats: PrefilterStats } {
  const excluded = Object.values(stats0.excludedByReason).reduce((s, n) => s + n, 0);
  let dataGaps = 0;
  const liquid: Metrics[] = [];
  const rows: PrefilterRow[] = [];
  const fail = (m: Metrics, reason: string) => rows.push({ ...m, rsPct: 0, passed: false, reason });
  for (const [, m] of metrics) {
    if (!m) { dataGaps++; continue; }
    if (m.days < thr.minHistory) { dataGaps++; fail(m, `Handelshistorie ${m.days} < ${thr.minHistory} Tage (Neuemission/Datenlücke)`); continue; }
    if (m.price < thr.minPrice) { fail(m, `Kurs ${m.price.toFixed(2)} < ${thr.minPrice}`); continue; }
    if (m.adv < thr.minTurnover) { fail(m, `Ø-Umsatz ${(m.adv / 1e6).toFixed(1)} Mio ${thr.currency} < ${(thr.minTurnover / 1e6).toFixed(1)} Mio ${thr.currency}`); continue; }
    if (m.rangePct < thr.minRangePct || m.rangePct > thr.maxRangePct) { fail(m, `Ø-Tagesspanne ${m.rangePct.toFixed(1)} % außerhalb ${thr.minRangePct}–${thr.maxRangePct} %`); continue; }
    liquid.push(m);
  }
  const sorted = [...liquid].sort((a, b) => a.ret63 - b.ret63);
  const n = sorted.length;
  const pass: PrefilterRow[] = [];
  sorted.forEach((m, i) => {
    const rsPct = n > 1 ? (i / (n - 1)) * 100 : 100;
    if (rsPct >= thr.minRs) pass.push({ ...m, rsPct, passed: true, reason: null });
    else rows.push({ ...m, rsPct, passed: false, reason: `Relative Stärke (63 Tage) Perzentil ${rsPct.toFixed(0)} < ${thr.minRs}` });
  });
  pass.sort((a, b) => b.rsPct - a.rsPct);
  const keep = pass.slice(0, thr.maxWatch);
  for (const m of pass.slice(thr.maxWatch)) rows.push({ ...m, passed: false, reason: `Obergrenze ${thr.maxWatch} überwachte Titel` });
  keep.forEach((r, i) => { r.rank = i + 1; });
  rows.push(...keep);
  return { rows, stats: { available: stats0.available, excluded, excludedByReason: stats0.excludedByReason, dataGaps, considered: metrics.size, passedLiquidity: n, watch: keep.length } };
}
