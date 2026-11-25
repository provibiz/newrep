import type { Bar } from "./types";
import { one, all, upsert, run, batchRun, type Db } from "./store";
import { nextSession, sessionFor, hourlyBoundaries } from "./calendar";
import { nyDate } from "./time";

export async function loadSeries(db: Db, symbol: string, tf: string): Promise<Bar[]> {
  const r = await one<{ data: string }>(db, "SELECT data FROM series WHERE symbol=? AND tf=?", symbol, tf);
  return r ? (JSON.parse(r.data) as Bar[]) : [];
}
export async function saveSeries(db: Db, symbol: string, tf: string, bars: Bar[], now: number) {
  if (!bars.length) return;
  await upsert(db, "series", "symbol,tf" as any, { symbol, tf, last_end: bars[bars.length - 1].end, data: JSON.stringify(bars), updated_at: now });
}
export async function dropSeries(db: Db, symbol: string) { await run(db, "DELETE FROM series WHERE symbol=?", symbol); }

/**
 * Fügt neue Kerzen hinzu. Überlappende Kerzen mit abweichendem Schluss (>0,5 %) deuten auf einen Split
 * oder eine Anpassung hin: dann wird die alte Reihe verworfen (resync = true) und muss neu geladen werden.
 */
export function mergeSeries(old: Bar[], fresh: Bar[], keep: number): { merged: Bar[]; resync: boolean } {
  const byEnd = new Map(old.map((b) => [b.end, b]));
  for (const f of fresh) {
    const o = byEnd.get(f.end);
    if (o && Math.abs(o.c / f.c - 1) > 0.005) return { merged: [], resync: true };
  }
  for (const f of fresh) byEnd.set(f.end, f);
  const merged = [...byEnd.values()].sort((a, b) => a.end - b.end).slice(-keep);
  return { merged, resync: false };
}

/** Zeitpunkt der n-ten abgeschlossenen Stundenkerze nach `from` (sitzungsübergreifend). */
export function addHourlyBars(from: number, n: number): number {
  let day = nyDate(from), left = n, last = from;
  for (let i = 0; i < 20 && left > 0; i++) {
    const s = sessionFor(day);
    if (s) for (const e of hourlyBoundaries(s)) if (e > last) { last = e; if (--left === 0) return e; }
    day = nextSession(day);
  }
  return last;
}
/** Ende der n-ten Sitzung nach dem Datum `fromDate`. */
export function addSessions(fromDate: string, n: number, mk?: { nextSession(d: string): string; sessionFor(d: string): { close: number } | null }): number {
  let d = fromDate;
  const next = mk ? mk.nextSession.bind(mk) : nextSession, sess = mk ? mk.sessionFor.bind(mk) : sessionFor;
  for (let i = 0; i < n; i++) d = next(d);
  return sess(d)!.close;
}

/** Mehrere Reihen mit einer Abfrage je 90 Symbole (D1: höchstens 100 gebundene Parameter, 1000 Abfragen je Aufruf). */
export async function loadSeriesMany(db: Db, symbols: string[], tf: string): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>(symbols.map((s) => [s, []]));
  for (let i = 0; i < symbols.length; i += 90) {
    const part = symbols.slice(i, i + 90);
    const rows = await all<{ symbol: string; data: string }>(db, `SELECT symbol, data FROM series WHERE tf=? AND symbol IN (${part.map(() => "?").join(",")})`, tf, ...part);
    for (const r of rows) out.set(r.symbol, JSON.parse(r.data) as Bar[]);
  }
  return out;
}
export async function saveSeriesMany(db: Db, tf: string, items: Map<string, Bar[]>, now: number) {
  const stmts = [...items].filter(([, b]) => b.length).map(([symbol, bars]) => ({
    sql: "INSERT INTO series (symbol,tf,last_end,data,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(symbol,tf) DO UPDATE SET last_end=excluded.last_end,data=excluded.data,updated_at=excluded.updated_at",
    args: [symbol, tf, bars[bars.length - 1].end, JSON.stringify(bars), now] }));
  await batchRun(db, stmts, 40);
}
