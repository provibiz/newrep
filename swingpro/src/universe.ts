/** Universum (Nasdaq/NYSE-Stammaktien) und tägliche Vorauswahl. */
import type { Bar } from "./types";
import type { Config } from "./config";
import type { AssetRaw } from "./providers";

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

export interface Metrics { symbol: string; asof: string; price: number; advUsd: number; rangePct: number; ret63: number; days: number; nh?: number; nl?: number; a50?: number; a200?: number }

export function computeMetrics(symbol: string, daily: Bar[], asof: string): Metrics | null {
  if (daily.length < 64) return null;
  const last20 = daily.slice(-20);
  const price = daily[daily.length - 1].c;
  const advUsd = last20.reduce((s, b) => s + b.c * b.v, 0) / 20;
  const rangePct = (last20.reduce((s, b) => s + (b.h - b.l) / b.c, 0) / 20) * 100;
  const ret63 = price / daily[daily.length - 64].c - 1;
  const last = daily[daily.length - 1], n = daily.length;
  const prior = daily.slice(-252, -1);
  const full = n >= 252;
  const sma = (k: number) => (n >= k ? daily.slice(-k).reduce((x, b) => x + b.c, 0) / k : NaN);
  return { symbol, asof, price, advUsd, rangePct, ret63, days: n,
    nh: full && last.h > Math.max(...prior.map((b) => b.h)) ? 1 : 0, nl: full && last.l < Math.min(...prior.map((b) => b.l)) ? 1 : 0,
    a50: price > sma(50) ? 1 : 0, a200: price > sma(200) ? 1 : 0 };
}

export interface PrefilterRow extends Metrics { rsPct: number; passed: boolean; reason: string | null }
export interface PrefilterStats {
  available: number; excluded: number; excludedByReason: Record<string, number>;
  dataGaps: number; considered: number; passedLiquidity: number; watch: number;
}

/** Stufenweise Vorauswahl. RS-Perzentil wird unter den liquiden Titeln berechnet. */
export function prefilter(cfg: Config, metrics: Map<string, Metrics | null>, stats0: { available: number; excludedByReason: Record<string, number> }): { rows: PrefilterRow[]; stats: PrefilterStats } {
  const excluded = Object.values(stats0.excludedByReason).reduce((s, n) => s + n, 0);
  let dataGaps = 0;
  const liquid: Metrics[] = [];
  const rows: PrefilterRow[] = [];
  const fail = (m: Metrics, reason: string) => rows.push({ ...m, rsPct: 0, passed: false, reason });
  for (const [, m] of metrics) {
    if (!m) { dataGaps++; continue; }
    if (m.days < cfg.minHistoryDays) { dataGaps++; fail(m, `Handelshistorie ${m.days} < ${cfg.minHistoryDays} Tage (Neuemission/Datenlücke)`); continue; }
    if (m.price < cfg.minPrice) { fail(m, `Kurs ${m.price.toFixed(2)} < ${cfg.minPrice}`); continue; }
    if (m.advUsd < cfg.minDollarVolume) { fail(m, `Ø-Dollarumsatz ${(m.advUsd / 1e6).toFixed(1)} Mio < ${(cfg.minDollarVolume / 1e6).toFixed(1)} Mio`); continue; }
    if (m.rangePct < cfg.minRangePct || m.rangePct > cfg.maxRangePct) { fail(m, `Ø-Tagesspanne ${m.rangePct.toFixed(1)} % außerhalb ${cfg.minRangePct}–${cfg.maxRangePct} %`); continue; }
    liquid.push(m);
  }
  const sorted = [...liquid].sort((a, b) => a.ret63 - b.ret63);
  const n = sorted.length;
  const pass: PrefilterRow[] = [];
  sorted.forEach((m, i) => {
    const rsPct = n > 1 ? (i / (n - 1)) * 100 : 100;
    if (rsPct >= cfg.minRsPercentile) pass.push({ ...m, rsPct, passed: true, reason: null });
    else rows.push({ ...m, rsPct, passed: false, reason: `Relative Stärke (63 Tage) Perzentil ${rsPct.toFixed(0)} < ${cfg.minRsPercentile}` });
  });
  pass.sort((a, b) => b.rsPct - a.rsPct);
  const keep = pass.slice(0, cfg.maxWatch);
  for (const m of pass.slice(cfg.maxWatch)) rows.push({ ...m, passed: false, reason: `Obergrenze ${cfg.maxWatch} überwachte Titel` });
  rows.push(...keep);
  return { rows, stats: { available: stats0.available, excluded, excludedByReason: stats0.excludedByReason, dataGaps, considered: metrics.size, passedLiquidity: n, watch: keep.length } };
}
