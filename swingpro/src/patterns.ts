/**
 * Die sieben Setups als zweistufiges Modell: prepare() (Vorwarnung, nur abgeschlossene Kerzen)
 * und checkTrigger() (laufende Stunde aus abgeschlossenen 5-Minuten-Kerzen).
 *
 * Portiert aus legacy-python/experts.py und swingbot.py; Änderungen sind in REGELN.md begründet.
 * Kein Detektor liest Kerzen, die nach der letzten abgeschlossenen Kerze liegen.
 */
import type { Bar, Prepared, RunningBar, SetupId } from "./types";
import type { Config } from "./config";
import { catalystKnown, type EarningsEvent } from "./catalyst";
import { nyDate } from "./time";
import { sessionFor } from "./calendar";

export interface PatternParams {
  undercutLookback: number;   // 11
  emaPeriod: number;          // 20
  emaWindow: number;          // 31
  emaProximityPct: number;    // Schluss höchstens so weit über dem EMA (Vorwarnbedingung)
  wedgeBlock: number;         // 4
  wedgeVolumePace: number;    // Faktor auf Block-Durchschnitt (original: > Mittel)
  shelfBars: number;          // 4
  shelfThrustPct: number;     // 3
  shelfThrustBars: number;    // 5
  shelfMaxRangePct: number;   // 2.5
  baseBars: number;           // 8
  baseMaxRangePct: number;    // 3
  baseVolumeFactor: number;   // 1.2
  basePriorBars: number;      // 10
  fhlWindow: number;          // 31
  fhlMaxAge: number;          // 6
  ttl: Record<SetupId, number>;
  minVolumeElapsedMin: number; // frühestens nach so vielen Minuten gilt die Volumen-Hochrechnung
  /** Konsolidierung nach Quartalszahlen (Tageschart) */
  erc: { minGapPct: number; minDays: number; lookbackDays: number; maxRangePct: number; stopBasis: "inside_day" | "breakout_day" };
  /** Mehrwöchige Basis (Tageschart) */
  mwb: { minDays: number; maxRangePct: number; priorRisePct: number; priorBars: number; maxDistPct: number };
  /** EMA-Reclaim (Tageschart) */
  reclaim: { minSideways: number; maxSideways: number; maxRangePct: number; confirm: "intraday" | "daily_close"; levelTest: boolean; levelTolPct: number; levelAdvancePct: number };
}

const NEW_DEFAULTS = {
  erc: { minGapPct: 8, minDays: 5, lookbackDays: 30, maxRangePct: 8, stopBasis: "inside_day" as const },
  mwb: { minDays: 15, maxRangePct: 10, priorRisePct: 10, priorBars: 20, maxDistPct: 4 },
  reclaim: { minSideways: 3, maxSideways: 15, maxRangePct: 6, confirm: "intraday" as const, levelTest: true, levelTolPct: 3, levelAdvancePct: 20 },
};

export const HOURLY: PatternParams = {
  undercutLookback: 11, emaPeriod: 20, emaWindow: 31, emaProximityPct: 1.5,
  wedgeBlock: 4, wedgeVolumePace: 1.0,
  shelfBars: 4, shelfThrustPct: 3, shelfThrustBars: 5, shelfMaxRangePct: 2.5,
  baseBars: 8, baseMaxRangePct: 3, baseVolumeFactor: 1.2, basePriorBars: 10,
  fhlWindow: 31, fhlMaxAge: 6,
  ttl: { undercut_rally: 6, first_higher_low: 3, wedge_pop: 3, ema_crossback: 2, base_n_break: 4, base_breakout: 4, episodic_pivot: 1, earnings_consolidation: 4, multiweek_base: 4, ema_reclaim: 3 },
  minVolumeElapsedMin: 15,
  ...NEW_DEFAULTS,
};
/** Tageskerzen: ungeprüfte Modellannahme – gleiche Struktur, größere Spannen. */
export const DAILY: PatternParams = {
  ...HOURLY, emaProximityPct: 3,
  shelfThrustPct: 10, shelfMaxRangePct: 6, baseMaxRangePct: 12, baseBars: 10, basePriorBars: 15,
  ttl: { undercut_rally: 5, first_higher_low: 3, wedge_pop: 3, ema_crossback: 3, base_n_break: 4, base_breakout: 5, episodic_pivot: 1, earnings_consolidation: 5, multiweek_base: 5, ema_reclaim: 3 },
};

/** Tages-Parameter mit den konfigurierten Modellannahmen. */
export function dailyParams(cfg: Config): PatternParams {
  return { ...DAILY,
    erc: { minGapPct: cfg.ercMinGapPct, minDays: cfg.ercMinDays, lookbackDays: cfg.ercLookbackDays, maxRangePct: cfg.ercMaxRangePct, stopBasis: cfg.ercStopBasis },
    mwb: { minDays: cfg.mwbMinDays, maxRangePct: cfg.mwbMaxRangePct, priorRisePct: cfg.mwbPriorRisePct, priorBars: 20, maxDistPct: cfg.mwbMaxDistPct },
    reclaim: { minSideways: cfg.reclaimMinSidewaysDays, maxSideways: cfg.reclaimMaxSidewaysDays, maxRangePct: cfg.reclaimMaxRangePct, confirm: cfg.reclaimConfirm, levelTest: cfg.reclaimLevelTest, levelTolPct: cfg.reclaimLevelTolPct, levelAdvancePct: cfg.reclaimLevelAdvancePct },
  };
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
export const floorCent = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
/** Stopp: Invalidierungsmarke auf Cent abgerundet, minus 1 Cent. */
export const stopBelow = (level: number) => Math.round((floorCent(level) - 0.01) * 100) / 100;

export function ema(closes: number[], period: number): number {
  let v = mean(closes.slice(0, period));
  for (const c of closes.slice(period)) v += (2 / (period + 1)) * (c - v);
  return v;
}

/** Lokale Tiefs mit je zwei höheren Nachbarn (streng), wie im Original. */
export function pivots(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const nb = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]];
    if (bars[i].l < Math.min(...nb.map((b) => b.l))) out.push(i);
  }
  return out;
}

type Ctx = { tf: "1h" | "1d"; p: PatternParams };
const mk = (c: Ctx, H: Bar[], setup: SetupId, f: Omit<Prepared, "setup" | "timeframe" | "armedAt" | "ttlBars">): Prepared =>
  ({ setup, timeframe: c.tf, armedAt: H[H.length - 1].end, ttlBars: c.p.ttl[setup], ...f });

function undercutRally(H: Bar[], c: Ctx): Prepared | null {
  const n = c.p.undercutLookback;
  if (H.length < n + 2) return null;
  const L = H[H.length - 1], prev = H[H.length - 2];
  const prior = H.slice(-(n + 1), -1);
  const oldLow = Math.min(...prior.map((b) => b.l));
  // Original: Tief unter dem Tief der vorigen elf Kerzen, Schluss darüber und über dem vorigen Schluss.
  if (!(L.l < oldLow && oldLow < L.c && L.c > prev.c)) return null;
  return mk(c, H, "undercut_rally", {
    trigger: L.h, stop: stopBelow(L.l), invalidateBelow: L.l, needsHourClose: false,
    conditions: [
      `Tief ${L.l.toFixed(2)} lag unter dem Tief der vorigen ${n} Kerzen (${oldLow.toFixed(2)})`,
      `Schluss ${L.c.toFixed(2)} wieder über diesem Tief und über dem vorigen Schluss (${prev.c.toFixed(2)})`,
    ],
    pending: [`5-Minuten-Schluss über dem Hoch der Undercut-Kerze (${L.h.toFixed(2)}) – das ist der „Rally“-Teil`],
  });
}

function firstHigherLow(H: Bar[], c: Ctx): Prepared | null {
  const W = H.slice(-(c.p.fhlWindow - 1));
  const pts = pivots(W);
  if (pts.length < 2) return null;
  const [a, b] = pts.slice(-2);
  if (!(b - a >= 3 && W.length - b <= c.p.fhlMaxAge && W[b].l > W[a].l)) return null;
  if (W[a].l !== Math.min(...W.slice(0, b).map((x) => x.l))) return null;
  const trigger = Math.max(...W.slice(b, b + 3).map((x) => x.h));
  if (!(Math.min(...W.slice(b + 1).map((x) => x.l)) > W[b].l)) return null;
  if (!W.slice(b + 3).every((x) => x.c <= trigger)) return null; // Ausbruch wäre schon passiert
  return mk(c, W, "first_higher_low", {
    trigger, stop: stopBelow(W[b].l), invalidateBelow: W[b].l,
    conditions: [
      `Erstes bestätigtes Tief ${W[a].l.toFixed(2)}, zweites bestätigtes Tief ${W[b].l.toFixed(2)} liegt höher (≥3 Kerzen später)`,
      "Zweites Tief wurde seither nicht mehr unterschritten oder berührt",
    ],
    pending: [`5-Minuten-Schluss über ${trigger.toFixed(2)} (höchstes Hoch der zweiten Tiefkerze und ihrer zwei Folgekerzen)`],
  });
}

function wedgePop(H: Bar[], c: Ctx): Prepared | null {
  const k = c.p.wedgeBlock;
  if (H.length < 2 * k) return null;
  const left = H.slice(-2 * k, -k), right = H.slice(-k);
  const h1 = Math.max(...left.map((b) => b.h)), l1 = Math.min(...left.map((b) => b.l));
  const h2 = Math.max(...right.map((b) => b.h)), l2 = Math.min(...right.map((b) => b.l));
  if (!(h2 < h1 && l2 < l1 && h2 - l2 < h1 - l1)) return null;
  const minVol = mean(right.map((b) => b.v)) * c.p.wedgeVolumePace;
  return mk(c, H, "wedge_pop", {
    trigger: h2, stop: stopBelow(l2), invalidateBelow: l2, minHourVolume: minVol,
    conditions: [
      `Zwei ${k}-Kerzen-Blöcke: zweiter mit niedrigeren Hochs (${h2.toFixed(2)} < ${h1.toFixed(2)}) und Tiefs (${l2.toFixed(2)} < ${l1.toFixed(2)})`,
      `Handelsspanne schrumpft: ${(h2 - l2).toFixed(2)} < ${(h1 - l1).toFixed(2)}`,
    ],
    pending: [`5-Minuten-Schluss über ${h2.toFixed(2)} bei Volumen im Tempo über dem Blockschnitt (Hochrechnung, siehe REGELN.md)`],
  });
}

function emaCrossback(H: Bar[], c: Ctx): Prepared | null {
  const need = c.p.emaWindow - 1;
  if (H.length < need) return null;
  const closes = H.slice(-need).map((b) => b.c);
  const avg = ema(closes, c.p.emaPeriod);
  const before = ema(closes.slice(0, -1), c.p.emaPeriod);
  const prev = H[H.length - 1];
  if (!(avg > before && prev.c > avg)) return null;
  if ((prev.c / avg - 1) * 100 > c.p.emaProximityPct) return null; // nicht in Reichweite eines Rücksetzers
  return mk(c, H, "ema_crossback", {
    trigger: prev.h, stop: stopBelow(Math.min(prev.l, avg)), invalidateBelow: Math.min(prev.l, avg) * 0.995,
    touchLevel: avg,
    conditions: [
      `EMA${c.p.emaPeriod} steigt (${avg.toFixed(2)}), letzter Schluss ${prev.c.toFixed(2)} liegt ${((prev.c / avg - 1) * 100).toFixed(1)} % darüber`,
    ],
    pending: [
      `Laufende Kerze berührt oder unterschreitet ${avg.toFixed(2)} (EMA der Vorkerze)`,
      `und ein 5-Minuten-Schluss über dem Hoch der Vorkerze (${prev.h.toFixed(2)})`,
    ],
  });
}

function shelfRange(g: Bar[]) { return { hi: Math.max(...g.map((b) => b.h)), lo: Math.min(...g.map((b) => b.l)) }; }

/** Kurzer Schub-Sockel („Flagge“): Anstieg ≥3 % in fünf Kerzen, danach vier ruhige Kerzen. */
function baseNBreakConditions(H: Bar[], p: PatternParams) {
  const k = p.shelfBars;
  if (H.length < k + p.shelfThrustBars + 1) return null;
  const shelf = H.slice(-k);
  const start = H[H.length - k];                       // erste Sockelkerze
  const ref = H[H.length - k - p.shelfThrustBars];     // Schluss fünf Kerzen davor
  const { hi, lo } = shelfRange(shelf);
  const thrust = start.c >= (1 + p.shelfThrustPct / 100) * ref.c;
  const tight = (hi / lo - 1) * 100 <= p.shelfMaxRangePct;
  return { shelf, hi, lo, thrust, tight, ref, start };
}

function baseNBreak(H: Bar[], c: Ctx): Prepared | null {
  const r = baseNBreakConditions(H, c.p);
  if (!r || !r.thrust || !r.tight) return null;
  return mk(c, H, "base_n_break", {
    trigger: r.hi, stop: stopBelow(r.lo), invalidateBelow: r.lo,
    conditions: [
      `Schub: Schluss zu Sockelbeginn ${r.start.c.toFixed(2)} ≥ ${c.p.shelfThrustPct} % über dem Schluss fünf Kerzen davor (${r.ref.c.toFixed(2)})`,
      `Kurzer Sockel: ${c.p.shelfBars} Kerzen mit ${((r.hi / r.lo - 1) * 100).toFixed(2)} % Spanne (max. ${c.p.shelfMaxRangePct} %)`,
    ],
    pending: [`5-Minuten-Schluss über dem Sockelhoch ${r.hi.toFixed(2)}`],
  });
}

/**
 * Längere Basis ohne vorangehenden Schub. Schließt sich mit Base’n Break aus:
 * Liegt unmittelbar vor dem kurzen Sockel ein Schub ≥ shelfThrustPct, zählt der Ausbruch ausschließlich als Base’n Break.
 */
function baseBreakout(H: Bar[], c: Ctx): Prepared | null {
  const { baseBars: n, basePriorBars: pr } = c.p;
  if (H.length < n + pr) return null;
  const base = H.slice(-n);
  const { hi, lo } = shelfRange(base);
  if ((hi / lo - 1) * 100 > c.p.baseMaxRangePct) return null;
  const priorRef = H[H.length - n - pr];
  if (!(base[0].c > priorRef.c)) return null;
  const nb = baseNBreakConditions(H, c.p);
  if (nb && nb.thrust) return null; // gehört zu Base’n Break
  const minVol = c.p.baseVolumeFactor * mean(base.map((b) => b.v));
  return mk(c, H, "base_breakout", {
    trigger: hi, stop: stopBelow(lo), invalidateBelow: lo, minHourVolume: minVol,
    conditions: [
      `Basis über ${n} Kerzen mit ${((hi / lo - 1) * 100).toFixed(2)} % Spanne (max. ${c.p.baseMaxRangePct} %)`,
      `Vorheriger Anstieg: Basisbeginn ${base[0].c.toFixed(2)} über dem Schluss ${pr} Kerzen zuvor (${priorRef.c.toFixed(2)}), ohne kurzen Schub`,
    ],
    pending: [`5-Minuten-Schluss über dem Basishoch ${hi.toFixed(2)} bei Volumen ≥ ${c.p.baseVolumeFactor}× Basisschnitt (Hochrechnung)`],
  });
}


export function emaSeries(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;
  let v = mean(closes.slice(0, period));
  out[period - 1] = v;
  for (let i = period; i < closes.length; i++) { v += (2 / (period + 1)) * (closes[i] - v); out[i] = v; }
  return out;
}
const dateOf = (b: Bar) => nyDate(b.end - 1);
const rangePct = (g: Bar[]) => { const { hi, lo } = shelfRange(g); return (hi / lo - 1) * 100; };
/** Inside Day: Hoch und Tief liegen innerhalb der Vorkerze (mindestens eine Seite echt innen). */
export function isInsideDay(last: Bar, prev: Bar): boolean {
  return last.h <= prev.h && last.l >= prev.l && (last.h < prev.h || last.l > prev.l);
}

/**
 * Konsolidierung nach Quartalszahlen: Gap ≥ erc.minGapPct mit belegtem Katalysator, danach mindestens erc.minDays
 * Konsolidierung (Gap nicht geschlossen), steigende EMAs, letzte Tageskerze ist ein Inside Day.
 * Weder die Zahlenmeldung noch die Gap-Kerze lösen aus: Trigger ist das Hoch des Inside Days.
 */
function earningsConsolidation(H: Bar[], c: Ctx, ctx?: PrepareCtx): Prepared | null {
  const e = c.p.erc, n = H.length;
  if (n < 30 || !ctx?.events?.length) return null;
  const last = H[n - 1], prev = H[n - 2];
  if (!isInsideDay(last, prev)) return null;
  let gapIdx = -1, ev: EarningsEvent | undefined, evidence = "";
  for (let i = n - 1; i >= Math.max(1, n - e.lookbackDays); i--) {
    if (!(H[i].o >= H[i - 1].c * (1 + e.minGapPct / 100))) continue;
    const gapDate = dateOf(H[i]), sess = sessionFor(gapDate);
    if (!sess) continue;
    for (const x of ctx.events) { const r = catalystKnown(x, gapDate, sess.open); if (r.ok) { ev = x; evidence = r.evidence; break; } }
    if (ev) { gapIdx = i; break; }
  }
  if (gapIdx < 0 || n - 1 - gapIdx < e.minDays) return null;               // Gap-Tag und die Tage unmittelbar danach lösen nie aus
  if (!(Math.min(...H.slice(gapIdx + 1).map((b) => b.l)) > H[gapIdx - 1].c)) return null; // Gap wurde nicht gefüllt
  const win = H.slice(-e.minDays);
  if (rangePct(win) > e.maxRangePct) return null;
  const closes = H.map((b) => b.c), e10 = emaSeries(closes, 10), e20 = emaSeries(closes, 20);
  if (!(e10[n - 1] > e20[n - 1] && e20[n - 1] > e20[n - 6] && last.c >= e20[n - 1])) return null;
  const insideDate = dateOf(last);
  return mk(c, H, "earnings_consolidation", {
    trigger: last.h, stop: stopBelow(last.l), invalidateBelow: last.l, currency: undefined,
    stopBasis: `Tagestief des Inside Days vom ${insideDate} (${last.l.toFixed(2)}). Modellannahme: die Quelle nennt nur „unter dem Tagestief“ und lässt den Tag offen`,
    conditions: [
      `Quartalszahlen mit Kurslücke ${(((H[gapIdx].o / H[gapIdx - 1].c) - 1) * 100).toFixed(1)} % am ${dateOf(H[gapIdx])} (${evidence}) – die Meldung und die Lücke selbst lösen keinen Einstieg aus`,
      `${n - 1 - gapIdx} Handelstage Konsolidierung seit der Lücke (Lücke nicht gefüllt), Spanne der letzten ${e.minDays} Tage ${rangePct(win).toFixed(1)} % (max. ${e.maxRangePct} %)`,
      `Kurs hält sich an steigenden EMAs (EMA10 ${e10[n - 1].toFixed(2)} > EMA20 ${e20[n - 1].toFixed(2)})`,
      `Inside Day am ${insideDate}: Hoch ${last.h.toFixed(2)}, Tief ${last.l.toFixed(2)} innerhalb der Vorkerze`,
    ],
    pending: [`5-Minuten-Schluss über dem Hoch des Inside Days (${last.h.toFixed(2)})`],
    extra: { gapDay: dateOf(H[gapIdx]), insideDay: insideDate, catalyst: evidence, stopBasisKind: e.stopBasis },
  });
}

/**
 * Mehrwöchige Basis im Tageschart: mindestens mwb.minDays Tage seitwärts (Spanne ≤ mwb.maxRangePct) nach einem Anstieg,
 * steigender EMA20 unter dem Kurs, letzte Kerze ist ein Inside Day. Der Trigger ist das Hoch des Inside Days –
 * das Basishoch (z. B. eine runde Marke) bleibt Kontext und wird nicht als Trigger verwendet.
 */
function multiweekBase(H: Bar[], c: Ctx): Prepared | null {
  const b = c.p.mwb, n = H.length;
  if (n < b.minDays + b.priorBars + 1) return null;
  const last = H[n - 1], prev = H[n - 2];
  if (!isInsideDay(last, prev)) return null;
  const win = H.slice(-b.minDays);
  const { hi, lo } = shelfRange(win);
  if ((hi / lo - 1) * 100 > b.maxRangePct) return null;
  const ref = H[n - b.minDays - b.priorBars];
  if (!(win[0].c >= ref.c * (1 + b.priorRisePct / 100))) return null;
  const e20 = emaSeries(H.map((x) => x.c), 20);
  if (!(e20[n - 1] > e20[n - 6] && last.c > e20[n - 1])) return null;
  if ((hi - last.c) / hi * 100 > b.maxDistPct) return null;
  const d = dateOf(last);
  return mk(c, H, "multiweek_base", {
    trigger: last.h, stop: stopBelow(last.l), invalidateBelow: last.l,
    stopBasis: `Tagestief des Inside Days vom ${d} (${last.l.toFixed(2)}). Modellannahme: die Quelle nennt nur „unter dem Tagestief“`,
    contextLevels: [{ level: hi, label: "Basishoch/Marke – Kontext, KEIN Trigger" }],
    conditions: [
      `Basis über ${b.minDays} Handelstage mit ${((hi / lo - 1) * 100).toFixed(1)} % Spanne (max. ${b.maxRangePct} %) nach einem Anstieg von ≥ ${b.priorRisePct} %`,
      `Steigender EMA20 (${e20[n - 1].toFixed(2)}) unter dem Kurs ${last.c.toFixed(2)}`,
      `Inside Day am ${d}: Hoch ${last.h.toFixed(2)}, Tief ${last.l.toFixed(2)}`,
    ],
    pending: [`5-Minuten-Schluss über dem Hoch des Inside Days (${last.h.toFixed(2)}); das Basishoch ${hi.toFixed(2)} ist nur Kontext`],
    extra: { baseHigh: hi, insideDay: d, stopBasisKind: "inside_day" },
  });
}

export interface ReclaimProgress { retest: boolean; level: number | null; levelDate: string | null; sidewaysDays: number; belowEmas: boolean }

/** Fortschritt des EMA-Reclaim-Aufbaus: Rücklauf aufs alte Niveau (nur Vorbereitung) → Seitwärtsphase → (Trigger). */
export function emaReclaimProgress(H: Bar[], p: PatternParams): ReclaimProgress {
  const r = p.reclaim, n = H.length;
  const none: ReclaimProgress = { retest: false, level: null, levelDate: null, sidewaysDays: 0, belowEmas: false };
  if (n < 40) return none;
  const closes = H.map((b) => b.c), e10 = emaSeries(closes, 10), e20 = emaSeries(closes, 20);
  const last = H[n - 1];
  const below = last.c < Math.min(e10[n - 1], e20[n - 1]) && e20[n - 1] < e20[n - 6];
  let level: number | null = null, levelDate: string | null = null;
  if (r.levelTest) {
    const recentLow = Math.min(...H.slice(-(r.maxSideways + 5)).map((b) => b.l));
    for (let i = n - 6; i >= 10; i--) {
      const h = H[i].h;
      if (h !== Math.max(...H.slice(i - 5, i + 6).map((b) => b.h))) continue;       // lokales Hoch (±5 Tage)
      if (!(Math.max(...H.slice(i + 1).map((b) => b.h)) >= h * (1 + r.levelAdvancePct / 100))) continue; // später deutlich überboten = ausgebrochenes Niveau
      if (Math.abs(recentLow / h - 1) * 100 <= r.levelTolPct) { level = h; levelDate = dateOf(H[i]); break; }
    }
  }
  let k = 0;
  for (let w = Math.min(r.maxSideways, n); w >= 2; w--) if (rangePct(H.slice(-w)) <= r.maxRangePct) { k = w; break; }
  return { retest: r.levelTest ? level !== null : true, level, levelDate, sidewaysDays: k, belowEmas: below };
}

/**
 * EMA-Reclaim (nicht EMA-Crossback): Der Kurs liegt NACH einem Abverkauf unter EMA10 und EMA20 (EMA20 fällt),
 * hat das alte Ausbruchsniveau von oben getestet (nur die Vorbereitung), läuft seitwärts und soll EMA10/EMA20 zurückerobern.
 * Anzahl Seitwärtstage und Bestätigungsart (5-Minuten-Schluss vs. Tagesschluss) sind konfigurierbare Modellannahmen.
 * EMA-Crossback dagegen verlangt einen steigenden EMA20 mit Kurs DARÜBER – beide schließen sich aus.
 */
function emaReclaim(H: Bar[], c: Ctx): Prepared | null {
  const r = c.p.reclaim, n = H.length;
  const pr = emaReclaimProgress(H, c.p);
  if (!pr.belowEmas || !pr.retest || pr.sidewaysDays < r.minSideways) return null;
  const closes = H.map((b) => b.c), e10 = emaSeries(closes, 10)[n - 1], e20 = emaSeries(closes, 20)[n - 1];
  const trigger = Math.max(e10, e20);
  const win = H.slice(-pr.sidewaysDays), low = Math.min(...win.map((b) => b.l));
  if (!(trigger > H[n - 1].c) || !(low > 0)) return null;
  const lowDate = dateOf(win.find((b) => b.l === low)!);
  return mk(c, H, "ema_reclaim", {
    trigger, stop: stopBelow(low), invalidateBelow: low, refresh: true, needsDayClose: r.confirm === "daily_close",
    stopBasis: `Tief der Konsolidierung vom ${lowDate} (${low.toFixed(2)}) innerhalb der letzten ${pr.sidewaysDays} Seitwärtstage`,
    conditions: [
      pr.level !== null ? `Rücklauf auf das alte Ausbruchsniveau ${pr.level.toFixed(2)} (Hoch vom ${pr.levelDate}) – das ist nur die Vorbereitung` : "Niveau-Test ausgeschaltet",
      `Seitwärtsphase über ${pr.sidewaysDays} Tage (${rangePct(win).toFixed(1)} % Spanne). Modellannahme: mindestens ${r.minSideways} Tage – die Quelle nennt keine Zahl`,
      `Schluss ${H[n - 1].c.toFixed(2)} unter EMA10 ${e10.toFixed(2)} und EMA20 ${e20.toFixed(2)} (fallender EMA20)`,
    ],
    pending: [r.confirm === "intraday"
      ? `5-Minuten-Schluss über EMA10 und EMA20 (${trigger.toFixed(2)}). Modellannahme: Die Quelle legt keine Schlusskursbestätigung fest`
      : `Tagesschluss über EMA10 und EMA20 (${trigger.toFixed(2)}), erst nach Börsenschluss. Modellannahme: Die Quelle legt keine Schlusskursbestätigung fest`],
    extra: { level: pr.level, sidewaysDays: pr.sidewaysDays, stopBasisKind: "consolidation_low" },
  });
}

const DETECTORS = [undercutRally, firstHigherLow, wedgePop, emaCrossback, baseNBreak, baseBreakout];

/** Alle vorbereiteten Setups zum Stand der letzten abgeschlossenen Kerze in H. */
export interface PrepareCtx { events?: EarningsEvent[] }

/** Kurslücken (Eröffnung ≥ erc.minGapPct über dem Vortagesschluss) innerhalb des Rückblicks – Kandidaten für die Katalysator-Prüfung. */
export function findGapDays(H: Bar[], p: PatternParams): number[] {
  const out: number[] = [];
  for (let i = H.length - 1; i >= Math.max(1, H.length - p.erc.lookbackDays); i--) if (H[i].o >= H[i - 1].c * (1 + p.erc.minGapPct / 100)) out.push(i);
  return out;
}

export function prepare(H: Bar[], tf: "1h" | "1d" = "1h", params?: PatternParams, ctx?: PrepareCtx): Prepared[] {
  const c: Ctx = { tf, p: params ?? (tf === "1h" ? HOURLY : DAILY) };
  const out: Prepared[] = [];
  const list: ((H: Bar[], c: Ctx, x?: PrepareCtx) => Prepared | null)[] = [...DETECTORS];
  if (tf === "1d") list.push(multiweekBase, emaReclaim, earningsConsolidation);
  for (const d of list) {
    const r = d(H, c, ctx);
    if (r && r.stop > 0 && r.stop < r.trigger) out.push(r);
  }
  // Im Tageschart ersetzen die spezifischen Basis-Pfade (Inside-Day-Trigger) den generischen Basisausbruch derselben Kursstrecke.
  if (tf === "1d" && out.some((p) => p.setup === "earnings_consolidation" || p.setup === "multiweek_base")) {
    return out.filter((p) => p.setup !== "base_breakout" && p.setup !== "base_n_break");
  }
  return out;
}

export interface TriggerResult { fired: boolean; reasons: string[]; stop: number; blocked?: string }

/**
 * Prüft, ob die laufende Stunde (aus abgeschlossenen 5-Minuten-Kerzen) den Auslöser bestätigt.
 * Verwendet nur Kerzen bis running.lastEnd.
 */
export function checkTrigger(p: Prepared, run: RunningBar, p2: PatternParams = HOURLY): TriggerResult {
  const no = (blocked: string): TriggerResult => ({ fired: false, reasons: [], stop: p.stop, blocked });
  if (p.needsHourClose) return no("Setup braucht den Stundenschluss");
  if (p.needsDayClose) return no("Setup braucht den Tagesschluss");
  if (run.l <= p.invalidateBelow) return no("Invalidierungsmarke unterschritten");
  if (!(run.c > p.trigger)) return no("kein 5-Minuten-Schluss über dem Auslöser");
  let stop = p.stop;
  const reasons = [`abgeschlossene 5-Minuten-Kerze schloss bei ${run.c.toFixed(2)} über dem Auslöser ${p.trigger.toFixed(2)}`];
  if (p.setup === "ema_crossback") {
    if (!(p.touchLevel !== undefined && run.l <= p.touchLevel)) return no("EMA nicht berührt");
    stop = Math.min(stop, stopBelow(run.l));
    reasons.push(`laufende Stunde berührte den EMA (Tief ${run.l.toFixed(2)} ≤ ${p.touchLevel.toFixed(2)})`);
  }
  if (p.minHourVolume !== undefined) {
    if (run.elapsedMin < p2.minVolumeElapsedMin) return no("zu früh für die Volumen-Hochrechnung");
    const pace = (run.v / run.elapsedMin) * (run.periodMin ?? 60);
    if (!(pace >= p.minHourVolume)) return no(`Volumentempo ${Math.round(pace)} < nötig ${Math.round(p.minHourVolume)}`);
    reasons.push(`Volumentempo ${Math.round(pace)}/h ≥ ${Math.round(p.minHourVolume)} (hochgerechnet aus ${run.elapsedMin} Min)`);
  }
  if (p.extra?.stopBasisKind === "breakout_day") stop = stopBelow(run.l); // Stopp-Basis konfiguriert: Tagestief des Ausbruchstags
  if (p.setup === "first_higher_low" && !(run.l > p.invalidateBelow)) return no("zweites Tief unterschritten");
  return { fired: true, reasons, stop };
}

/** Tagesschluss-Setups (z. B. EMA-Reclaim mit Tagesschluss-Bestätigung): nur mit vollständiger Tageskerze nach Börsenschluss. */
export function checkDayCloseTrigger(p: Prepared, day: RunningBar): TriggerResult {
  if (!p.needsDayClose) return { fired: false, reasons: [], stop: p.stop, blocked: "kein Tagesschluss-Setup" };
  if (day.l <= p.invalidateBelow) return { fired: false, reasons: [], stop: p.stop, blocked: "Invalidierungsmarke unterschritten" };
  if (!(day.c > p.trigger)) return { fired: false, reasons: [], stop: p.stop, blocked: "Tagesschluss nicht über dem Auslöser" };
  return { fired: true, stop: p.stop, reasons: [`Tagesschluss ${day.c.toFixed(2)} über dem Auslöser ${p.trigger.toFixed(2)} (abgeschlossene Tageskerze)`] };
}

/** True, wenn die Vorbereitung nach der neuen abgeschlossenen Stundenkerze nicht mehr gilt. */
export function invalidatedByBar(p: Prepared, bar: Bar): boolean {
  if (p.setup === "ema_crossback") return bar.c < p.invalidateBelow;
  return bar.c < p.invalidateBelow || bar.l < p.invalidateBelow;
}

/** Aggregiert abgeschlossene 5-Minuten-Kerzen einer Stunde. Kerzenende = Beginn+5min. */
export function runningHour(fiveMin: Bar[], hourStart: number, now: number, lagMs: number, periodMin = 60): RunningBar | null {
  const done = fiveMin.filter((b) => b.end - 300_000 >= hourStart && b.end <= hourStart + periodMin * 60_000 && b.end <= now - lagMs)
    .sort((x, y) => x.end - y.end);
  if (!done.length) return null;
  const last = done[done.length - 1];
  return {
    start: hourStart, o: done[0].o, h: Math.max(...done.map((b) => b.h)), l: Math.min(...done.map((b) => b.l)),
    c: last.c, v: done.reduce((s, b) => s + b.v, 0), elapsedMin: Math.round((last.end - hourStart) / 60000), lastEnd: last.end, periodMin,
  };
}
