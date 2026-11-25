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
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  TWELVEDATA_API_KEY?: string;
  STATUS_TOKEN: string;
  TOKEN_PEPPER: string;
  // Variablen
  [k: string]: unknown;
}

export interface Config {
  mode: "paper" | "live";
  markets: ("US" | "DE")[];
  deMinPrice: number; deMinTurnover: number; deMaxWatch: number;
  autoStance: boolean; autoStaleSessions: number; autoStaleStance: "cash" | "selective" | "open";
  autoBearishFlagsCash: number; autoBearishFlagsSelective: number; autoMinAbove50Pct: number; autoMinHighLowRatio: number;
  stanceMaxDays: number;
  indexSources: string;
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
  // Marktvorgabe des Nutzers (Entscheidung für die aktuelle Lage, keine allgemeine Regel)
  stance: "open" | "selective" | "cash";
  stanceNote: string;
  stanceSelectiveSetups: string[];
  stanceWeightMin: number | null;
  stanceWeightMax: number | null;
  mailWatch: boolean;
  // Konsolidierung nach Quartalszahlen (Modellannahmen)
  ercMinGapPct: number; ercMinDays: number; ercLookbackDays: number; ercMaxRangePct: number; ercStopBasis: "inside_day" | "breakout_day"; ercMaxFmpCalls: number;
  // Mehrwöchige Basis (Modellannahmen)
  mwbMinDays: number; mwbMaxRangePct: number; mwbPriorRisePct: number; mwbMaxDistPct: number;
  // EMA-Reclaim (Modellannahmen)
  reclaimMinSidewaysDays: number; reclaimMaxSidewaysDays: number; reclaimMaxRangePct: number; reclaimConfirm: "intraday" | "daily_close";
  reclaimLevelTest: boolean; reclaimLevelTolPct: number; reclaimLevelAdvancePct: number;
  // Marktlage (nur Information)
  growthGroups: string[]; ftdMinGainPct: number; ftdMinDay: number;
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
  const markets = str(env.MARKETS, "US").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) as ("US" | "DE")[];
  if (!markets.length || markets.some((m) => m !== "US" && m !== "DE")) throw new Error("MARKETS: erlaubt sind US und DE (kommagetrennt)");
  if (markets.includes("DE") && (!fx || fx <= 0 || !str(env.FX_DATE) || !str(env.FX_SOURCE))) throw new Error("MARKETS enthält DE: FX_USD_PER_EUR, FX_DATE und FX_SOURCE sind Pflicht (EUR-Kurse, dokumentierter Wechselkurs)");
  const c: Config = {
    mode, markets, feed, dailyFeed,
    deMinPrice: num(env.DE_MIN_PRICE, 5, "DE_MIN_PRICE"), deMinTurnover: num(env.DE_MIN_TURNOVER_EUR, 5_000_000, "DE_MIN_TURNOVER_EUR"), deMaxWatch: num(env.DE_MAX_WATCH, 150, "DE_MAX_WATCH"),
    autoStance: bool(env.AUTO_STANCE, true), autoStaleSessions: num(env.AUTO_STALE_SESSIONS, 3, "AUTO_STALE_SESSIONS"),
    autoStaleStance: str(env.AUTO_STALE_STANCE, "cash") as Config["autoStaleStance"],
    autoBearishFlagsCash: num(env.AUTO_BEARISH_FLAGS_CASH, 3, "AUTO_BEARISH_FLAGS_CASH"), autoBearishFlagsSelective: num(env.AUTO_BEARISH_FLAGS_SELECTIVE, 1, "AUTO_BEARISH_FLAGS_SELECTIVE"),
    autoMinAbove50Pct: num(env.AUTO_MIN_ABOVE50_PCT, 40, "AUTO_MIN_ABOVE50_PCT"), autoMinHighLowRatio: num(env.AUTO_MIN_HIGH_LOW_RATIO, 1, "AUTO_MIN_HIGH_LOW_RATIO"),
    stanceMaxDays: num(env.STANCE_MAX_DAYS, 14, "STANCE_MAX_DAYS"), indexSources: str(env.INDEX_SOURCES),
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
    stance: str(env.MARKET_STANCE, "open") as Config["stance"], stanceNote: str(env.STANCE_NOTE),
    stanceSelectiveSetups: str(env.STANCE_SELECTIVE_SETUPS, "first_higher_low,ema_reclaim").split(",").map((x) => x.trim()).filter(Boolean),
    stanceWeightMin: env.STANCE_WEIGHT_MIN === undefined || env.STANCE_WEIGHT_MIN === "" ? null : num(env.STANCE_WEIGHT_MIN, 0, "STANCE_WEIGHT_MIN"),
    stanceWeightMax: env.STANCE_WEIGHT_MAX === undefined || env.STANCE_WEIGHT_MAX === "" ? null : num(env.STANCE_WEIGHT_MAX, 0, "STANCE_WEIGHT_MAX"),
    mailWatch: bool(env.MAIL_WATCH, true),
    ercMinGapPct: num(env.ERC_MIN_GAP_PCT, 8, "ERC_MIN_GAP_PCT"), ercMinDays: num(env.ERC_MIN_DAYS, 5, "ERC_MIN_DAYS"),
    ercLookbackDays: num(env.ERC_LOOKBACK_DAYS, 30, "ERC_LOOKBACK_DAYS"), ercMaxRangePct: num(env.ERC_MAX_RANGE_PCT, 8, "ERC_MAX_RANGE_PCT"),
    ercStopBasis: str(env.ERC_STOP_BASIS, "inside_day") as Config["ercStopBasis"], ercMaxFmpCalls: num(env.ERC_MAX_FMP_CALLS, 30, "ERC_MAX_FMP_CALLS"),
    mwbMinDays: num(env.MWB_MIN_DAYS, 15, "MWB_MIN_DAYS"), mwbMaxRangePct: num(env.MWB_MAX_RANGE_PCT, 10, "MWB_MAX_RANGE_PCT"),
    mwbPriorRisePct: num(env.MWB_PRIOR_RISE_PCT, 10, "MWB_PRIOR_RISE_PCT"), mwbMaxDistPct: num(env.MWB_MAX_DIST_PCT, 4, "MWB_MAX_DIST_PCT"),
    reclaimMinSidewaysDays: num(env.EMA_RECLAIM_MIN_SIDEWAYS_DAYS, 3, "EMA_RECLAIM_MIN_SIDEWAYS_DAYS"),
    reclaimMaxSidewaysDays: num(env.EMA_RECLAIM_MAX_SIDEWAYS_DAYS, 15, "EMA_RECLAIM_MAX_SIDEWAYS_DAYS"),
    reclaimMaxRangePct: num(env.EMA_RECLAIM_MAX_RANGE_PCT, 6, "EMA_RECLAIM_MAX_RANGE_PCT"),
    reclaimConfirm: str(env.EMA_RECLAIM_CONFIRM, "intraday") as Config["reclaimConfirm"],
    reclaimLevelTest: bool(env.EMA_RECLAIM_LEVEL_TEST, true), reclaimLevelTolPct: num(env.EMA_RECLAIM_LEVEL_TOL_PCT, 3, "EMA_RECLAIM_LEVEL_TOL_PCT"),
    reclaimLevelAdvancePct: num(env.EMA_RECLAIM_LEVEL_ADVANCE_PCT, 20, "EMA_RECLAIM_LEVEL_ADVANCE_PCT"),
    growthGroups: str(env.GROWTH_GROUPS, "XLK,XLY,XLC").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    ftdMinGainPct: num(env.FTD_MIN_GAIN_PCT, 1.25, "FTD_MIN_GAIN_PCT"), ftdMinDay: num(env.FTD_MIN_DAY, 4, "FTD_MIN_DAY"),
  };
  if (!["open", "selective", "cash"].includes(c.stance)) throw new Error("MARKET_STANCE muss open, selective oder cash sein");
  if (!["inside_day", "breakout_day"].includes(c.ercStopBasis)) throw new Error("ERC_STOP_BASIS muss inside_day oder breakout_day sein");
  if (!["intraday", "daily_close"].includes(c.reclaimConfirm)) throw new Error("EMA_RECLAIM_CONFIRM muss intraday oder daily_close sein");
  if (!["info", "block_trend_setups", "block_all"].includes(c.qqqFilter)) throw new Error("QQQ_FILTER ungültig");
  for (const [k, v] of Object.entries({ capital: c.capital, risk: c.riskPercent, weight: c.maxWeightPercent, openRisk: c.maxOpenRiskPercent })) {
    if (!(v > 0)) throw new Error(`Konfiguration ${k} muss > 0 sein`);
  }
  if (c.riskPercent > 100 || c.maxWeightPercent > 100) throw new Error("Prozentwerte über 100 sind ungültig");
  if (!(c.partialFraction > 0 && c.partialFraction < 1)) throw new Error("PARTIAL_FRACTION muss zwischen 0 und 1 liegen");
  return c;
}

/** Wechselkurs from → to (nur USD/EUR). Ohne dokumentierten Kurs wird nie umgerechnet. */
export function fxRate(c: Config, from: string, to: string): number {
  if (from === to) return 1;
  if (!c.fxUsdPerEur) throw new Error(`Kein dokumentierter Wechselkurs für ${from}→${to} (FX_USD_PER_EUR fehlt)`);
  if (from === "EUR" && to === "USD") return c.fxUsdPerEur;
  if (from === "USD" && to === "EUR") return 1 / c.fxUsdPerEur;
  throw new Error(`Währungspaar ${from}/${to} nicht unterstützt`);
}
/** Umrechnung Kontowährung -> USD. */
export function toUsd(c: Config, amount: number): number {
  return c.accountCurrency === "USD" ? amount : amount * (c.fxUsdPerEur as number);
}
export function fromUsd(c: Config, usd: number): number {
  return c.accountCurrency === "USD" ? usd : usd / (c.fxUsdPerEur as number);
}
