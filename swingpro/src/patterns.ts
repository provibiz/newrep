/**
 * Die sieben Setups als zweistufiges Modell: prepare() (Vorwarnung, nur abgeschlossene Kerzen)
 * und checkTrigger() (laufende Stunde aus abgeschlossenen 5-Minuten-Kerzen).
 *
 * Portiert aus legacy-python/experts.py und swingbot.py; Änderungen sind in REGELN.md begründet.
 * Kein Detektor liest Kerzen, die nach der letzten abgeschlossenen Kerze liegen.
 */
import type { Bar, Prepared, RunningBar, SetupId } from "./types";

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
}

export const HOURLY: PatternParams = {
  undercutLookback: 11, emaPeriod: 20, emaWindow: 31, emaProximityPct: 1.5,
  wedgeBlock: 4, wedgeVolumePace: 1.0,
  shelfBars: 4, shelfThrustPct: 3, shelfThrustBars: 5, shelfMaxRangePct: 2.5,
  baseBars: 8, baseMaxRangePct: 3, baseVolumeFactor: 1.2, basePriorBars: 10,
  fhlWindow: 31, fhlMaxAge: 6,
  ttl: { undercut_rally: 6, first_higher_low: 3, wedge_pop: 3, ema_crossback: 2, base_n_break: 4, base_breakout: 4, episodic_pivot: 1 },
  minVolumeElapsedMin: 15,
};
/** Tageskerzen: ungeprüfte Modellannahme – gleiche Struktur, größere Spannen. */
export const DAILY: PatternParams = {
  ...HOURLY, emaProximityPct: 3,
  shelfThrustPct: 10, shelfMaxRangePct: 6, baseMaxRangePct: 12, baseBars: 10, basePriorBars: 15,
  ttl: { undercut_rally: 5, first_higher_low: 3, wedge_pop: 3, ema_crossback: 3, base_n_break: 4, base_breakout: 5, episodic_pivot: 1 },
};

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

const DETECTORS = [undercutRally, firstHigherLow, wedgePop, emaCrossback, baseNBreak, baseBreakout];

/** Alle vorbereiteten Setups zum Stand der letzten abgeschlossenen Kerze in H. */
export function prepare(H: Bar[], tf: "1h" | "1d" = "1h", params?: PatternParams): Prepared[] {
  const c: Ctx = { tf, p: params ?? (tf === "1h" ? HOURLY : DAILY) };
  const out: Prepared[] = [];
  for (const d of DETECTORS) {
    const r = d(H, c);
    if (r && r.stop > 0 && r.stop < r.trigger) out.push(r);
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
  if (p.setup === "first_higher_low" && !(run.l > p.invalidateBelow)) return no("zweites Tief unterschritten");
  return { fired: true, reasons, stop };
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
