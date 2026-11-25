/** Marktkontext: S&P 500 (Baron, nur Information) und QQQ-Filter (bisheriger Marktfilter, separat geprüft). */
import { RECOVERY_SETUPS, type Bar, type SetupId } from "./types";
import { prepare } from "./patterns";
import type { Config } from "./config";
import { addDays } from "./time";

export interface SpContext {
  state: "über" | "unter" | "auf" | "unbekannt";
  /** Datum der verwendeten FRED-Beobachtung */
  obsDate: string | null;
  close: number | null;
  sma200: number | null;
  /** letzte vollständig abgeschlossene US-Sitzung zum Signalzeitpunkt */
  lastCompleted: string;
  /** false: der Schluss von lastCompleted war bei FRED noch nicht veröffentlicht */
  isLastCompleted: boolean;
  text: string;
}

/**
 * Parst FRED-CSV (observation_date,SP500; fehlende Werte leer oder ".").
 * Nur Beobachtungen bis einschließlich lastCompleted werden verwendet, nie spätere.
 * Rohdaten werden nicht gespeichert (FRED-Nutzungsbedingungen untersagen Caching); nur das abgeleitete Ergebnis.
 */
export function sp500Context(csv: string, lastCompleted: string): SpContext {
  const rows: [string, number][] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(",");
    if (!d || v === undefined || v === "" || v === ".") continue;
    const x = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(x) && x > 0 && d <= lastCompleted) rows.push([d, x]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const unknown = (why: string): SpContext => ({
    state: "unbekannt", obsDate: null, close: null, sma200: null, lastCompleted, isLastCompleted: false,
    text: `S&P 500 · Daten fehlen (${why}); letzter abgeschlossener Handelstag wäre ${lastCompleted}`,
  });
  if (rows.length < 200) return unknown("weniger als 200 Schlusskurse");
  const [obsDate, close] = rows[rows.length - 1];
  if (obsDate < addDays(lastCompleted, -5)) return unknown(`jüngster Wert vom ${obsDate} ist zu alt`);
  const sma = rows.slice(-200).reduce((s, r) => s + r[1], 0) / 200;
  const state = close > sma ? "über" : close < sma ? "unter" : "auf";
  const isLast = obsDate === lastCompleted;
  return {
    state, obsDate, close, sma200: sma, lastCompleted, isLastCompleted: isLast,
    text: `S&P 500 ${state} der 200-Tage-Linie · Schluss ${close.toFixed(2)} vom ${obsDate} / SMA200 ${sma.toFixed(2)}` +
      (isLast ? "" : ` · Hinweis: Schluss vom ${lastCompleted} ist bei FRED noch nicht veröffentlicht, gezeigt wird der letzte verfügbare Wert`) +
      " · nur Information, sperrt keinen Einstieg",
  };
}

export interface QqqDecision {
  mode: Config["qqqFilter"];
  trendOk: boolean;
  recovery: boolean;
  close: number | null;
  sma20: number | null;
  barEnd: number | null;
  /** Setups, die diese Regel zu diesem Zeitpunkt blockiert */
  blocked: SetupId[];
  text: string;
  dataOk: boolean;
}

const ALL: SetupId[] = ["undercut_rally", "first_higher_low", "wedge_pop", "ema_crossback", "base_n_break", "base_breakout", "episodic_pivot"];

/** QQQ-Stundenfilter (Original: Schluss > SMA20 der Stundenschlüsse oder frisch ausgelöstes First Higher Low in QQQ). */
export function qqqDecision(cfg: Config, qqq: Bar[]): QqqDecision {
  if (qqq.length < 31) {
    return { mode: cfg.qqqFilter, trendOk: false, recovery: false, close: null, sma20: null, barEnd: null, dataOk: false,
      blocked: cfg.qqqFilter === "info" ? [] : ALL, text: "QQQ-Daten fehlen: Marktfilter kann nicht bewertet werden" };
  }
  const last = qqq[qqq.length - 1];
  const sma = qqq.slice(-20).reduce((s, b) => s + b.c, 0) / 20;
  const trendOk = last.c > sma;
  const fhl = prepare(qqq.slice(0, -1), "1h").find((p) => p.setup === "first_higher_low");
  const recovery = !!fhl && last.c > fhl.trigger && last.l > fhl.invalidateBelow;
  const pass = trendOk || recovery;
  let blocked: SetupId[] = [];
  if (!pass) {
    if (cfg.qqqFilter === "block_all") blocked = ALL;
    else if (cfg.qqqFilter === "block_trend_setups") blocked = ALL.filter((s) => !RECOVERY_SETUPS.includes(s));
  }
  const rule = cfg.qqqFilter === "info" ? "nur Information" :
    cfg.qqqFilter === "block_all" ? "sperrt alle Setups" : "sperrt Trend-Setups, Erholungs-Setups (Undercut & Rally, First Higher Low) bleiben erlaubt";
  return {
    mode: cfg.qqqFilter, trendOk, recovery, close: last.c, sma20: sma, barEnd: last.end, blocked, dataOk: true,
    text: `QQQ-Filter (${rule}): Stundenschluss ${last.c.toFixed(2)} ${trendOk ? "über" : "unter"} SMA20 ${sma.toFixed(2)}` +
      (recovery ? " · QQQ-Erholungssignal (First Higher Low) aktiv" : "") +
      (blocked.length ? ` → blockiert ${blocked.length} Setup-Typen` : " → blockiert nichts"),
  };
}

/** Der QQQ-Stundenfilter gilt nur für US-Titel. Für Xetra-Titel entscheidet die Marktlage des Marktes (permission.ts), kein US-Index. */
export function qqqNotApplicable(cfg: Config): QqqDecision {
  return { mode: cfg.qqqFilter, trendOk: true, recovery: false, close: null, sma20: null, barEnd: null, blocked: [], dataOk: true, text: "QQQ-Filter: gilt nur für US-Titel (für Xetra nicht angewendet; es gibt keinen US-Ersatz für deutsche Titel)" };
}
