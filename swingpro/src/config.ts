/**
 * Konfiguration aus Worker-Variablen (wrangler.jsonc "vars") und Secrets.
 * Alle Schwellen sind Modellentscheidungen bzw. persönliche Vorgaben (siehe REGELN.md) und anpassbar.
 */
export interface Env {
  DB: D1Database;
  // Secrets
  ALPACA_KEY_ID: string;
  ALPACA_SECRET: string;
  FMP_API_KEY?: string;
  RESEND_API_KEY?: string;
  STATUS_TOKEN: string;
  TOKEN_PEPPER: string;
  // Variablen
  [k: string]: unknown;
}

export interface Config {
  mode: "paper" | "live";
  feed: "iex" | "sip";
  dailyFeed: "iex" | "sip";
  // Konto
  accountCurrency: "USD" | "EUR";
  capital: number;            // in Kontowährung
  fxUsdPerEur: number | null; // nur bei EUR
  fxDate: string | null;
  fxSource: string | null;
  riskPercent: number;        // je Trade
  maxWeightPercent: number;
  maxOpenRiskPercent: number; // gesamt
  maxPositions: number;
  // Mail
  mailFrom: string;
  mailTo: string;
  baseUrl: string;            // öffentliche URL des Workers (für Links)
  mailPrewarn: boolean;
  mailEntry: boolean;
  mailMissed: boolean;
  mailPosition: boolean;
  mailDaily: boolean;
  entryMailMaxAgeMin: number; // danach wird eine nicht versandte Einstiegsmail verworfen
  // Universum
  allowedExchanges: string[];
  includeAdrs: boolean;
  excludeSymbols: string[];
  includeSymbols: string[];
  minPrice: number;
  minDollarVolume: number;    // 20-Tage-Durchschnitt, Daily-Feed
  minRangePct: number;        // typische Tagesspanne (ADR %)
  maxRangePct: number;
  minRsPercentile: number;
  minHistoryDays: number;
  maxWatch: number;           // Obergrenze des täglich überwachten Universums
  // Signale
  maxQuoteAgeSec: number;
  maxChaseR: number;
  minStopPct: number;
  maxStopPct: number;
  prewarnTtlHours: number;
  qqqFilter: "info" | "block_trend_setups" | "block_all";
  growthMinRevenue: number;
  growthMinEps: number;
  growthMaxAgeDays: number;
  // Position
  partialAtR: number;
  partialFraction: number;
  stagnationDays: number;
  stagnationMinR: number;
  trailBufferCents: number;
  barLagSec: number;
}

const bool = (v: unknown, d: boolean) => (v === undefined || v === "" ? d : String(v).toLowerCase() === "true");
const num = (v: unknown, d: number, name: string) => {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Konfiguration ${name} ist keine Zahl`);
  return n;
};
const str = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));

export function loadConfig(env: Record<string, unknown>): Config {
  const mode = str(env.MODE, "paper");
  if (mode !== "paper" && mode !== "live") throw new Error("MODE muss paper oder live sein");
  const feed = str(env.DATA_FEED, "iex");
  if (feed !== "iex" && feed !== "sip") throw new Error("DATA_FEED muss iex oder sip sein");
  const dailyFeed = str(env.DAILY_FEED, "sip");
  if (dailyFeed !== "iex" && dailyFeed !== "sip") throw new Error("DAILY_FEED muss iex oder sip sein");
  const cur = str(env.ACCOUNT_CURRENCY, "USD");
  if (cur !== "USD" && cur !== "EUR") throw new Error("ACCOUNT_CURRENCY muss USD oder EUR sein");
  const fx = env.FX_USD_PER_EUR === undefined || env.FX_USD_PER_EUR === "" ? null : num(env.FX_USD_PER_EUR, 0, "FX_USD_PER_EUR");
  if (cur === "EUR") {
    if (!fx || fx <= 0) throw new Error("Bei ACCOUNT_CURRENCY=EUR ist FX_USD_PER_EUR (z. B. EZB-Referenzkurs) Pflicht");
    if (!str(env.FX_DATE) || !str(env.FX_SOURCE)) throw new Error("Bei EUR sind FX_DATE und FX_SOURCE Pflicht (dokumentierter Wechselkurs)");
  }
  const c: Config = {
    mode, feed, dailyFeed,
    accountCurrency: cur,
    capital: num(env.CAPITAL, 10000, "CAPITAL"),
    fxUsdPerEur: fx, fxDate: str(env.FX_DATE) || null, fxSource: str(env.FX_SOURCE) || null,
    riskPercent: num(env.RISK_PERCENT, 0.5, "RISK_PERCENT"),
    maxWeightPercent: num(env.MAX_WEIGHT_PERCENT, 25, "MAX_WEIGHT_PERCENT"),
    maxOpenRiskPercent: num(env.MAX_OPEN_RISK_PERCENT, 3, "MAX_OPEN_RISK_PERCENT"),
    maxPositions: num(env.MAX_POSITIONS, 8, "MAX_POSITIONS"),
    mailFrom: str(env.MAIL_FROM), mailTo: str(env.MAIL_TO), baseUrl: str(env.BASE_URL).replace(/\/$/, ""),
    mailPrewarn: bool(env.MAIL_PREWARN, true), mailEntry: bool(env.MAIL_ENTRY, true),
    mailMissed: bool(env.MAIL_MISSED, true), mailPosition: bool(env.MAIL_POSITION, true), mailDaily: bool(env.MAIL_DAILY, true),
    entryMailMaxAgeMin: num(env.ENTRY_MAIL_MAX_AGE_MIN, 10, "ENTRY_MAIL_MAX_AGE_MIN"),
    allowedExchanges: str(env.EXCHANGES, "NASDAQ,NYSE").split(",").map((s) => s.trim()).filter(Boolean),
    includeAdrs: bool(env.INCLUDE_ADRS, false),
    excludeSymbols: str(env.EXCLUDE_SYMBOLS).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    includeSymbols: str(env.INCLUDE_SYMBOLS).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    minPrice: num(env.MIN_PRICE, 10, "MIN_PRICE"),
    minDollarVolume: num(env.MIN_DOLLAR_VOLUME, 20_000_000, "MIN_DOLLAR_VOLUME"),
    minRangePct: num(env.MIN_RANGE_PCT, 2, "MIN_RANGE_PCT"),
    maxRangePct: num(env.MAX_RANGE_PCT, 12, "MAX_RANGE_PCT"),
    minRsPercentile: num(env.MIN_RS_PERCENTILE, 50, "MIN_RS_PERCENTILE"),
    minHistoryDays: num(env.MIN_HISTORY_DAYS, 130, "MIN_HISTORY_DAYS"),
    maxWatch: num(env.MAX_WATCH, 400, "MAX_WATCH"),
    maxQuoteAgeSec: num(env.MAX_QUOTE_AGE_SEC, 120, "MAX_QUOTE_AGE_SEC"),
    maxChaseR: num(env.MAX_CHASE_R, 0.25, "MAX_CHASE_R"),
    minStopPct: num(env.MIN_STOP_PCT, 0.5, "MIN_STOP_PCT"),
    maxStopPct: num(env.MAX_STOP_PCT, 10, "MAX_STOP_PCT"),
    prewarnTtlHours: num(env.PREWARN_TTL_HOURS, 6, "PREWARN_TTL_HOURS"),
    qqqFilter: str(env.QQQ_FILTER, "block_trend_setups") as Config["qqqFilter"],
    growthMinRevenue: num(env.GROWTH_MIN_REVENUE_PCT, 20, "GROWTH_MIN_REVENUE_PCT"),
    growthMinEps: num(env.GROWTH_MIN_EPS_PCT, 25, "GROWTH_MIN_EPS_PCT"),
    growthMaxAgeDays: num(env.GROWTH_MAX_AGE_DAYS, 180, "GROWTH_MAX_AGE_DAYS"),
    partialAtR: num(env.PARTIAL_AT_R, 2, "PARTIAL_AT_R"),
    partialFraction: num(env.PARTIAL_FRACTION, 0.5, "PARTIAL_FRACTION"),
    stagnationDays: num(env.STAGNATION_DAYS, 15, "STAGNATION_DAYS"),
    stagnationMinR: num(env.STAGNATION_MIN_R, 1, "STAGNATION_MIN_R"),
    trailBufferCents: num(env.TRAIL_BUFFER_CENTS, 1, "TRAIL_BUFFER_CENTS"),
    barLagSec: num(env.BAR_LAG_SEC, 60, "BAR_LAG_SEC"),
  };
  if (!["info", "block_trend_setups", "block_all"].includes(c.qqqFilter)) throw new Error("QQQ_FILTER ungültig");
  for (const [k, v] of Object.entries({ capital: c.capital, risk: c.riskPercent, weight: c.maxWeightPercent, openRisk: c.maxOpenRiskPercent })) {
    if (!(v > 0)) throw new Error(`Konfiguration ${k} muss > 0 sein`);
  }
  if (c.riskPercent > 100 || c.maxWeightPercent > 100) throw new Error("Prozentwerte über 100 sind ungültig");
  if (!(c.partialFraction > 0 && c.partialFraction < 1)) throw new Error("PARTIAL_FRACTION muss zwischen 0 und 1 liegen");
  return c;
}

/** Umrechnung Kontowährung -> USD. */
export function toUsd(c: Config, amount: number): number {
  return c.accountCurrency === "USD" ? amount : amount * (c.fxUsdPerEur as number);
}
export function fromUsd(c: Config, usd: number): number {
  return c.accountCurrency === "USD" ? usd : usd / (c.fxUsdPerEur as number);
}
