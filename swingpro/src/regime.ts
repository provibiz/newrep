/**
 * Marktzustand, getrennt vom einzelnen Chart. Reine Information und Begründung – es gibt KEINEN allgemeingültigen
 * numerischen Schwellenwert, ab dem der Markt „freigegeben“ wäre. Ob und wie viel eingesetzt wird, entscheidet die
 * Marktvorgabe des Nutzers (permission.ts).
 *
 * Komponenten (soweit verlässliche Daten vorliegen):
 *  - Marktbreite: neue 52-Wochen-Hochs/-Tiefs und Anteil über SMA50/SMA200 im eigenen Universum (Alpaca-Tageskerzen).
 *  - Führungsgruppen: relative Stärke (63 Handelstage) der Sektor-ETFs gegenüber SPY (Alpaca-Tageskerzen).
 *  - Erholungsversuch/Follow-Through-Day auf SPY und QQQ (Modellregel, nur Information).
 *  - Verkürzte Handelstage der Woche (NYSE-Kalender).
 * Das Universum ist NICHT identisch mit dem einer Börsen-Statistik; Zahlen anderer Quellen sind nicht reproduzierbar.
 */
import type { Bar } from "./types";
import type { Config } from "./config";
import { addDays, dowOf, nyDate, pad } from "./time";
import { sessionFor, isHoliday } from "./calendar";

export const SECTOR_ETFS: Record<string, string> = {
  XLK: "Technologie", XLY: "Zyklischer Konsum", XLC: "Kommunikation", XLV: "Gesundheit", XLP: "Basiskonsum", XLU: "Versorger",
  XLF: "Finanzen", XLE: "Energie", XLI: "Industrie", XLB: "Rohstoffe", XLRE: "Immobilien",
};
export const REGIME_ETFS = ["SPY", "QQQ", ...Object.keys(SECTOR_ETFS)];

export interface Breadth { asof: string; universe: string; period: string; source: string; n: number; newHighs: number; newLows: number; above50Pct: number | null; above200Pct: number | null }
export interface Leader { symbol: string; name: string; rs63: number; rank: number; growth: boolean }
export interface Leadership { asof: string; source: string; period: string; leaders: Leader[]; growthLeading: boolean | null }
export interface Ftd { index: string; state: "kein Erholungsversuch" | "Erholungsversuch" | "Follow-Through-Day"; day: number | null; date: string | null; text: string }
export interface Regime {
  asof: string; breadth: Breadth | null; leadership: Leadership | null; ftd: Ftd[]; thinWeek: string; text: string[];
}

export function breadthFrom(row: { n: number; nh: number; nl: number; a50: number; a200: number }, asof: string, source: string): Breadth | null {
  if (!row.n) return null;
  return {
    asof, n: row.n, newHighs: row.nh, newLows: row.nl, above50Pct: (row.a50 / row.n) * 100, above200Pct: (row.a200 / row.n) * 100,
    universe: "Nasdaq-/NYSE-Stammaktien nach den Ausschlüssen aus REGELN.md mit mindestens 252 Handelstagen Historie",
    period: "52 Wochen (252 Handelstage); neues Hoch/Tief = Hoch/Tief des Tages über/unter dem der 251 Vortage", source,
  };
}

export function leadership(etf: Map<string, Bar[]>, cfg: Pick<Config, "growthGroups">, asof: string, source: string): Leadership | null {
  const spy = etf.get("SPY");
  const ret = (b: Bar[] | undefined) => (b && b.length > 63 ? b[b.length - 1].c / b[b.length - 64].c - 1 : null);
  const base = ret(spy);
  if (base === null) return null;
  const rows: Omit<Leader, "rank">[] = [];
  for (const [sym, name] of Object.entries(SECTOR_ETFS)) {
    const r = ret(etf.get(sym));
    if (r !== null) rows.push({ symbol: sym, name, rs63: (r - base) * 100, growth: cfg.growthGroups.includes(sym) });
  }
  if (rows.length < 5) return null;
  rows.sort((a, b) => b.rs63 - a.rs63);
  const leaders = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const top3 = leaders.slice(0, 3);
  return { asof, source, period: "63 Handelstage, Rendite des Sektor-ETFs minus Rendite von SPY", leaders, growthLeading: top3.filter((l) => l.growth).length >= 2 };
}

/**
 * Erholungsversuch / Follow-Through-Day (Modellregel, nur Information): Tag 1 = erster Schluss im Plus nach dem tiefsten Schluss
 * der letzten 40 Handelstage; Follow-Through-Day = ab Tag ftdMinDay ein Plus von ≥ ftdMinGainPct bei höherem Volumen als am Vortag,
 * ohne dass das Tief unterschritten wurde. Ein FTD allein gibt nichts frei.
 */
export function followThroughDay(index: string, bars: Bar[], cfg: Pick<Config, "ftdMinGainPct" | "ftdMinDay">): Ftd {
  const none = (text: string): Ftd => ({ index, state: "kein Erholungsversuch", day: null, date: null, text: `${index}: ${text}` });
  if (bars.length < 45) return none("zu wenig Daten");
  const win = bars.slice(-40);
  let li = 0;
  win.forEach((b, i) => { if (b.c < win[li].c) li = i; });
  const low = win[li].c;
  let d1 = -1;
  for (let i = li + 1; i < win.length; i++) { if (win[i].c < low) return none("Tief wurde wieder unterschritten"); if (win[i].c > win[i - 1].c) { d1 = i; break; } }
  if (d1 < 0) return none("seit dem Tief kein Schluss im Plus");
  for (let i = d1; i < win.length; i++) {
    const day = i - d1 + 1, gain = (win[i].c / win[i - 1].c - 1) * 100;
    if (day >= cfg.ftdMinDay && gain >= cfg.ftdMinGainPct && win[i].v > win[i - 1].v) {
      const date = nyDate(win[i].end - 1);
      return { index, state: "Follow-Through-Day", day, date, text: `${index}: Follow-Through-Day am ${date} (Tag ${day} des Erholungsversuchs, ${gain.toFixed(2)} % bei höherem Volumen) – allein kein Freigabe-Signal` };
    }
  }
  const day = win.length - d1;
  return { index, state: "Erholungsversuch", day, date: null, text: `${index}: Erholungsversuch, Tag ${day} seit dem Tief (noch kein Follow-Through-Day)` };
}

/** Verkürzte oder ausgefallene Handelstage der Woche (Mo–Fr) um `today`. */
export function thinWeek(today: string): string {
  const monday = addDays(today, -((dowOf(today) + 6) % 7));
  const names = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i), [, m, dd] = d.split("-");
    const label = `${names[dowOf(d)]} ${pad(+dd)}.${pad(+m)}.`;
    const h = isHoliday(d);
    if (h) out.push(`${label} geschlossen (${h})`);
    else { const s = sessionFor(d); if (s?.early) out.push(`${label} verkürzt (Schluss 13:00 New York)`); }
  }
  return out.length ? `Handelswoche: ${out.join("; ")} – Signale und Volumen sind weniger aussagekräftig` : "Handelswoche: keine verkürzten oder ausgefallenen Handelstage";
}

export function describeRegime(r: Pick<Regime, "breadth" | "leadership" | "ftd" | "thinWeek">): string[] {
  const L: string[] = [];
  const b = r.breadth;
  L.push(b ? `Marktbreite (Stand ${b.asof}): ${b.newHighs} neue 52-Wochen-Hochs vs. ${b.newLows} neue Tiefs, ${b.above50Pct!.toFixed(0)} % über SMA50, ${b.above200Pct!.toFixed(0)} % über SMA200 · Universum: ${b.universe} (n=${b.n}) · Zeitraum: ${b.period} · Quelle: ${b.source}`
    : "Marktbreite: nicht bewertet (zu wenig Daten)");
  const l = r.leadership;
  L.push(l ? `Führung (${l.asof}): ${l.leaders.slice(0, 3).map((x) => `${x.name} ${x.rs63 >= 0 ? "+" : ""}${x.rs63.toFixed(1)}`).join(", ")} (Rel. Stärke ggü. SPY in %-Punkten) · Wachstumsgruppen ${l.growthLeading ? "führen" : "führen nicht"} · ${l.period} · Quelle: ${l.source}`
    : "Führungsgruppen: nicht bewertet (Daten fehlen)");
  for (const f of r.ftd) L.push(f.text);
  L.push(r.thinWeek);
  return L;
}
