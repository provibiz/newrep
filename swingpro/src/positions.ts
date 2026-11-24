/** Positionsbegleitung ohne Seiteneffekte: 2R-Teilverkauf, Wochentief-Trailing, Stopp-/Gap-Hinweise, Stagnation. */
import type { Bar } from "./types";
import type { Config } from "./config";
import { addDays, dowOf, nyDate } from "./time";
import { nextSession, previousSession, isSessionDay } from "./calendar";
import { stopBelow } from "./patterns";

export interface Position {
  id: string; symbol: string;
  entry: number; shares: number; fees: number;
  initialStop: number; stop: number;
  openedAt: number;
  sharesSold: number;            // nur ausgeführte, vom Nutzer bestätigte Verkäufe
  partialRecommendedAt: number | null;
  stagnationHintedAt: number | null;
}
export const rPerShare = (p: Position) => p.entry - p.initialStop;
export const remaining = (p: Position) => p.shares - p.sharesSold;
export const rMultiple = (p: Position, price: number) => (price - p.entry) / rPerShare(p);

export function partialTarget(cfg: Config, p: Position): { price: number; shares: number } {
  return { price: p.entry + cfg.partialAtR * rPerShare(p), shares: Math.max(1, Math.floor(p.shares * cfg.partialFraction)) };
}

export interface WeeklyBar { week: string; low: number; high: number; lastDate: string }
const weekKey = (d: string) => addDays(d, -((dowOf(d) + 6) % 7)); // Montag der Woche

/** Tagesbars (end = Sitzungsschluss) -> Wochenbars nach NY-Datum. */
export function weeklyBars(daily: Bar[]): WeeklyBar[] {
  const m = new Map<string, WeeklyBar>();
  for (const b of daily) {
    const d = nyDate(b.end - 1), w = weekKey(d);
    const x = m.get(w);
    if (!x) m.set(w, { week: w, low: b.l, high: b.h, lastDate: d });
    else { x.low = Math.min(x.low, b.l); x.high = Math.max(x.high, b.h); if (d > x.lastDate) x.lastDate = d; }
  }
  return [...m.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
}

/** Eine Woche gilt als abgeschlossen, wenn ihr letzter Handelstag vor der nächsten Sitzungswoche liegt und die Sitzung gelaufen ist. */
export function completedWeeks(weeks: WeeklyBar[], lastCompleted: string): WeeklyBar[] {
  return weeks.filter((w) => w.lastDate <= lastCompleted && weekKey(nextSession(w.lastDate)) !== w.week);
}

/**
 * Bestätigtes Wochentief: ein Wochentief, das tiefer liegt als die Vorwoche und tiefer als die zwei folgenden
 * abgeschlossenen Wochen. Es steht damit erst fest, wenn die zweite Folgewoche abgeschlossen ist – keine Zukunftsdaten.
 * Nur Wochen nach der Einstiegswoche zählen.
 */
export function confirmedWeeklyLows(weeks: WeeklyBar[], lastCompleted: string, entryDate: string): { week: string; low: number }[] {
  const w = completedWeeks(weeks, lastCompleted);
  const entryWeek = weekKey(entryDate);
  const out: { week: string; low: number }[] = [];
  for (let i = 1; i + 2 < w.length; i++) {
    if (w[i].week <= entryWeek) continue;
    if (w[i].low < w[i - 1].low && w[i].low < w[i + 1].low && w[i].low < w[i + 2].low) out.push({ week: w[i].week, low: w[i].low });
  }
  return out;
}

/** Neuer Schutzstopp (nur höher) oder null. Greift erst, wenn die 2R-Marke erreicht wurde. */
export function trailedStop(cfg: Config, p: Position, daily: Bar[], lastCompleted: string): { stop: number; from: string; low: number } | null {
  if (p.partialRecommendedAt === null) return null;
  const lows = confirmedWeeklyLows(weeklyBars(daily), lastCompleted, nyDate(p.openedAt));
  let best: { stop: number; from: string; low: number } | null = null;
  for (const l of lows) {
    const s = Math.round((stopBelow(l.low) - (cfg.trailBufferCents - 1) / 100) * 100) / 100;
    if (s > p.stop && (!best || s > best.stop)) best = { stop: s, from: l.week, low: l.low };
  }
  return best;
}

export type StopAssessment =
  | { hit: false }
  | { hit: true; gap: boolean; text: string };

/** Stopp-Prüfung. Bei Eröffnung unter dem Stopp wird ausdrücklich kein Verkauf zum Stoppkurs behauptet. */
export function assessStop(p: Position, price: number, sessionOpen: number | null): StopAssessment {
  if (price > p.stop) return { hit: false };
  if (sessionOpen !== null && sessionOpen < p.stop) {
    return { hit: true, gap: true, text: `Kurslücke: Eröffnung ${sessionOpen.toFixed(2)} lag bereits unter dem Stopp ${p.stop.toFixed(2)}, aktueller Kurs ${price.toFixed(2)}. Ein Verkauf zum Stoppkurs ist nicht anzunehmen; der tatsächliche Preis ist erst nach deiner Ausführung bekannt.` };
  }
  return { hit: true, gap: false, text: `Kurs ${price.toFixed(2)} liegt auf/unter dem Stopp ${p.stop.toFixed(2)}. Der tatsächliche Ausführungskurs kann abweichen (Spread, Slippage).` };
}

export function sessionsBetween(from: string, to: string): number {
  let n = 0, d = from;
  while (d < to) { d = addDays(d, 1); if (isSessionDay(d)) n++; }
  return n;
}

export function stagnation(cfg: Config, p: Position, price: number, today: string): string | null {
  if (p.stagnationHintedAt !== null) return null;
  const days = sessionsBetween(nyDate(p.openedAt), today);
  if (days >= cfg.stagnationDays && rMultiple(p, price) < cfg.stagnationMinR) {
    return `Seit ${days} Handelstagen kein Fortschritt (aktuell ${rMultiple(p, price).toFixed(2)} R, Marke ${cfg.stagnationMinR} R). Der Swing läuft seitwärts – Zeitstopp prüfen und Kapital ggf. umschichten.`;
  }
  return null;
}
export { previousSession };
