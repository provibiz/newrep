/** Stufe 1 (Stunde): Stundenkerzen inkrementell fortschreiben, Setups vorbereiten, Vorwarnung versenden. */
import type { Deps } from "../deps";
import { all, run, getMeta, setMeta, logError, batchRun } from "../store";
import { sessionFor, hourlyBoundaries } from "../calendar";
import { HOUR, MIN, iso, nyDate } from "../time";
import { buildHourly, ms, type RawBar } from "../providers";
import { loadSeriesMany, saveSeriesMany, mergeSeries, addHourlyBars } from "../series";
import { prepare, invalidatedByBar } from "../patterns";
import type { Bar, Prepared } from "../types";
import { startRun, finishRun } from "./runs";
import { notifyPrewarn, PreparedBook } from "./prewarn";
import { flushOutbox } from "../outbox";
import { assertFeed } from "./probe";

const KEEP = 120;
const CHUNK = 100;

export interface HourlyStats { symbols: number; checked: number; gaps: number; newPrepared: number; suppressed: number; resynced: number; boundary: string; requests: number }

export async function runHourly(d: Deps): Promise<string> {
  const now = d.now(), lag = d.cfg.barLagSec * 1000;
  const s = sessionFor(nyDate(now));
  if (!s) return "idle: kein Handelstag";
  const ends = hourlyBoundaries(s).filter((e) => e + lag + 2 * MIN <= now);
  if (!ends.length) return "idle: noch keine abgeschlossene Stundenkerze";
  const b = ends[ends.length - 1];
  if (now - b > 55 * MIN) return "idle: Fenster der Stundenkerze vorbei";
  const feedBlock = await assertFeed(d);
  if (feedBlock) { await logError(d.db, "feed", new Error(feedBlock), now); return "gesperrt: " + feedBlock; }
  const runKey = `hourly:${iso(b)}`;
  const r = await startRun(d, "hourly", runKey);
  if (!r) return "bereits erledigt";
  const stats: HourlyStats = { symbols: 0, checked: 0, gaps: 0, newPrepared: 0, suppressed: 0, resynced: 0, boundary: iso(b), requests: 0 };
  try {
    const watch = (await all<{ symbol: string }>(d.db, "SELECT symbol FROM metrics WHERE passed=1")).map((x) => x.symbol);
    if (!watch.length) { await finishRun(d, r.id, "failed", stats, "Universum leer: der Tageslauf hat noch keine Vorauswahl erzeugt"); return "fehlgeschlagen: Universum leer"; }
    const symbols = ["QQQ", ...watch.filter((x) => x !== "QQQ")];
    stats.symbols = symbols.length;
    const endIso = new Date(now - 2 * MIN).toISOString();
    const loaded = new Map<string, Bar[]>();

    for (let i = 0; i < symbols.length; i += CHUNK) {
      const chunk = symbols.slice(i, i + CHUNK);
      const old = new Map<string, Bar[]>();
      for (const [k, v] of await loadSeriesMany(d.db, chunk, "1h")) old.set(k, v);
      const fresh = chunk.filter((x) => old.get(x)!.length === 0);
      const inc = chunk.filter((x) => old.get(x)!.length > 0);
      const fetchGroup = async (syms: string[], startMs: number) => {
        if (!syms.length) return new Map<string, Bar[]>();
        const res = await d.alpaca.bars(syms, "30Min", new Date(startMs).toISOString(), endIso, d.cfg.feed);
        stats.requests += res.pages;
        const out = new Map<string, Bar[]>();
        for (const [sym, raw] of res.bars) out.set(sym, buildHourly(raw as RawBar[], now, lag));
        return out;
      };
      const got = new Map<string, Bar[]>();
      for (const [k, v] of await fetchGroup(fresh, now - 16 * 86_400_000)) got.set(k, v);
      if (inc.length) {
        const start = Math.min(...inc.map((x) => old.get(x)!.slice(-3)[0].end)) - 2 * HOUR;
        for (const [k, v] of await fetchGroup(inc, start)) got.set(k, v);
      }
      const resync: string[] = [];
      for (const sym of chunk) {
        const o = old.get(sym)!, f = got.get(sym) ?? [];
        const m = mergeSeries(o, f, KEEP);
        if (m.resync) { resync.push(sym); continue; }
        loaded.set(sym, m.merged);
      }
      if (resync.length) { // Split/Anpassung erkannt: Reihe verwerfen und neu laden
        stats.resynced += resync.length;
        for (const [k, v] of await fetchGroup(resync, now - 16 * 86_400_000)) loaded.set(k, v);
        for (const sym of resync) if (!loaded.has(sym)) loaded.set(sym, []);
        await run(d.db, `UPDATE positions SET needs_review=1 WHERE status='open' AND symbol IN (${resync.map(() => "?").join(",")})`, ...resync);
      }
      await saveSeriesMany(d.db, "1h", new Map(chunk.map((sym) => [sym, loaded.get(sym) ?? []])), now);
    }

    const qqq = loaded.get("QQQ") ?? [];
    if (qqq.length < 31 || qqq[qqq.length - 1].end !== b) {
      await finishRun(d, r.id, "failed", stats, `QQQ-Referenzdaten unvollständig (letzte Kerze ${qqq.length ? iso(qqq[qqq.length - 1].end) : "–"}, erwartet ${iso(b)})`);
      return "fehlgeschlagen: QQQ unvollständig – erneuter Versuch mit dem nächsten Takt";
    }
    const activeBySym = new Map<string, any[]>();
    for (const r of await all<any>(d.db, "SELECT id, symbol, armed_at, data FROM prepared WHERE state='active' AND timeframe='1h'")) (activeBySym.get(r.symbol) ?? activeBySym.set(r.symbol, []).get(r.symbol)!).push(r);
    const book = new PreparedBook(d); await book.load();
    const inval: { sql: string; args: unknown[] }[] = [];
    for (const sym of symbols) {
      if (sym === "QQQ") continue;
      const bars = loaded.get(sym) ?? [];
      const tail = bars.slice(-31);
      if (bars.length < 31 || bars[bars.length - 1].end !== b || tail.some((x) => !(x.v > 0))) { stats.gaps++; continue; }
      stats.checked++;
      inval.push(...invalidations(bars, activeBySym.get(sym) ?? []));
      book.add(sym, bars, prepare(bars, "1h"), (p) => addHourlyBars(p.armedAt, p.ttlBars));
    }
    await batchRun(d.db, inval, 40);
    await book.flush();
    stats.newPrepared = book.stats.added; stats.suppressed = book.stats.suppressed;
    await run(d.db, "UPDATE prepared SET state='expired', state_reason='Verfall' WHERE state='active' AND expires_at <= ?", now);
    await notifyPrewarn(d, runKey);
    await flushOutbox(d);
    await finishRun(d, r.id, "ok", stats);
    return `ok: ${stats.checked} geprüft, ${stats.gaps} Lücken, ${stats.newPrepared} neu vorbereitet`;
  } catch (e) {
    await logError(d.db, "hourly", e, now);
    await finishRun(d, r.id, "failed", stats, e instanceof Error ? e.message : String(e));
    return `fehlgeschlagen: ${e instanceof Error ? e.message : e}`;
  }
}

function invalidations(hourly: Bar[], rows: any[]): { sql: string; args: unknown[] }[] {
  const out: { sql: string; args: unknown[] }[] = [];
  for (const r of rows) {
    const p: Prepared = JSON.parse(r.data);
    const bad = hourly.find((b) => b.end > r.armed_at && invalidatedByBar(p, b));
    if (bad) out.push({ sql: "UPDATE prepared SET state='invalidated', state_reason=? WHERE id=?", args: [`Stundenkerze bis ${iso(bad.end)} unterschritt ${p.invalidateBelow.toFixed(2)}`, r.id] });
  }
  return out;
}
export { getMeta, setMeta, ms };
