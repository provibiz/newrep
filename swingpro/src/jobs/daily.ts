/** Tagesstufe nach Börsenschluss (fortsetzbar): Universum → Tageskerzen → Vorauswahl → Tages-Setups → Positionsprüfung → Tagesbericht. */
import type { Deps } from "../deps";
import { all, one, run, getMeta, setMeta, logError, batchRun, upsert } from "../store";
import { lastCompletedSession, sessionFor } from "../calendar";
import { DAY, MIN, addDays, iso, nyDate, formatBerlin } from "../time";
import { dailyBars, type AssetRaw, type RawBar } from "../providers";
import { classifyAsset, computeMetrics, prefilter, type Metrics } from "../universe";
import { loadSeries, loadSeriesMany, saveSeriesMany, mergeSeries, addSessions } from "../series";
import { prepare, invalidatedByBar } from "../patterns";
import type { Prepared } from "../types";
import { startRun, finishRun } from "./runs";
import { notifyPrewarn, PreparedBook } from "./prewarn";
import { reviewPositions } from "./positions";
import { enqueue, flushOutbox } from "../outbox";
import { runProbe } from "./probe";
import { updateRegime } from "./regime";
import { findGapDays } from "../patterns";
import type { EarningsEvent } from "../catalyst";
import { dailyParams } from "../patterns";

interface DailyState { stage: "assets" | "bars" | "rank" | "regime" | "patterns" | "review" | "done"; assets?: { total: number; excluded: Record<string, number>; renamed: string[] }; barsPages: number; resynced: number }
const CHUNK = 150, PAGE_BUDGET = 40, KEEP = 270;

export async function runDaily(d: Deps): Promise<string> {
  const now = d.now();
  const last = lastCompletedSession(now, 20);
  if (now - sessionFor(last)!.close > 4 * DAY) return "idle";
  const key = `daily_state:${last}`;
  let st = (await getMeta<DailyState>(d.db, key)) ?? { stage: "assets" as const, barsPages: 0, resynced: 0 };
  if (st.stage === "done") return "bereits erledigt";
  const r = await startRun(d, "daily", `daily:${last}`, 9 * MIN);
  if (!r) return "läuft bereits oder erledigt";
  try {
    if (st.stage === "assets") {
      await runProbe(d).catch((e) => logError(d.db, "probe", e, now));
      st.assets = await refreshAssets(d, now);
      st.stage = "bars"; await setMeta(d.db, key, st, now);
    }
    if (st.stage === "bars") {
      const pages = await syncBars(d, last, now, st);
      st.barsPages += pages.pages; st.resynced += pages.resynced;
      st.stage = pages.remaining === 0 ? "rank" : "bars"; await setMeta(d.db, key, st, now);
      if (st.stage === "bars") { await finishRun(d, r.id, "partial", { stage: "bars", remaining: pages.remaining }); return `Tageskerzen: noch ${pages.remaining} Symbole offen (setzt mit dem nächsten Takt fort)`; }
    }
    if (st.stage === "rank") {
      const stats = await rank(d, last, st, now);
      await setMeta(d.db, "universe_stats", { ...stats, asof: last }, now);
      st.stage = "regime"; await setMeta(d.db, key, st, now);
    }
    if (st.stage === "regime") {
      try { await updateRegime(d, last, now); } catch (e) { await logError(d.db, "regime", e, now); }   // Marktlage ist Information: ein Fehler stoppt den Lauf nicht
      st.stage = "patterns"; await setMeta(d.db, key, st, now);
    }
    if (st.stage === "patterns") {
      const n = await dailyPatterns(d, last, now);
      await notifyPrewarn(d, `daily:${last}`);
      st.stage = "review"; await setMeta(d.db, key, st, now);
      await setMeta(d.db, "daily_patterns", { asof: last, newPrepared: n }, now);
    }
    if (st.stage === "review") {
      await run(d.db, "UPDATE positions SET status='expired', closed_at=? WHERE status='pending' AND created_at < ?", now, now - 4 * DAY);
      const lines = await reviewPositions(d);
      await dailyReport(d, last, lines, now);
      st.stage = "done"; await setMeta(d.db, key, st, now);
    }
    await flushOutbox(d);
    await finishRun(d, r.id, "ok", { stage: st.stage, resynced: st.resynced });
    return "ok: Tageslauf abgeschlossen";
  } catch (e) {
    await logError(d.db, "daily", e, now);
    await finishRun(d, r.id, "failed", { stage: st.stage }, e instanceof Error ? e.message : String(e));
    return `fehlgeschlagen in Stufe ${st.stage}: ${e instanceof Error ? e.message : e}`;
  }
}

async function refreshAssets(d: Deps, now: number) {
  const raw = (await d.alpaca.assets()) as AssetRaw[];
  const excluded: Record<string, number> = {};
  const incl: AssetRaw[] = [];
  for (const a of raw) {
    const v = classifyAsset(a, d.cfg);
    if (v.included) incl.push(a); else excluded[v.reason!] = (excluded[v.reason!] ?? 0) + 1;
  }
  const existing = await all<{ symbol: string; asset_id: string }>(d.db, "SELECT symbol, asset_id FROM assets");
  const bySym = new Map(existing.map((e) => [e.symbol, e.asset_id])), byId = new Map(existing.map((e) => [e.asset_id, e.symbol]));
  const stmts: { sql: string; args: unknown[] }[] = [];
  const renamed: string[] = [];
  const purge = (sym: string) => ["assets", "series", "metrics"].forEach((t) => stmts.push({ sql: `DELETE FROM ${t} WHERE symbol=?`, args: [sym] }));
  const keep = new Set(incl.map((a) => a.symbol));
  for (const a of incl) {
    const sameSymOtherAsset = bySym.has(a.symbol) && bySym.get(a.symbol) !== a.id;
    const oldSym = byId.get(a.id);
    if (sameSymOtherAsset) { purge(a.symbol); renamed.push(`${a.symbol}: anderes Wertpapier (Symbol neu vergeben)`); }
    if (oldSym && oldSym !== a.symbol) { purge(oldSym); renamed.push(`${oldSym} → ${a.symbol}`); }
    stmts.push({ sql: "INSERT INTO assets (symbol,asset_id,name,exchange,included,first_seen,updated_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(symbol) DO UPDATE SET asset_id=excluded.asset_id,name=excluded.name,exchange=excluded.exchange,included=1,updated_at=excluded.updated_at", args: [a.symbol, a.id, a.name, a.exchange, now, now] });
  }
  for (const e of existing) if (!keep.has(e.symbol)) purge(e.symbol);
  await batchRun(d.db, stmts);
  return { total: raw.length, excluded, renamed };
}

async function syncBars(d: Deps, last: string, now: number, st: DailyState): Promise<{ pages: number; remaining: number; resynced: number }> {
  const close = sessionFor(last)!.close;
  const endIso = new Date(Math.min(now - 16 * MIN, close + 2 * 3_600_000)).toISOString();
  let pages = 0, resynced = 0;
  while (pages < PAGE_BUDGET) {
    const todo = await all<{ symbol: string }>(d.db, "SELECT a.symbol FROM assets a WHERE a.included=1 AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.symbol=a.symbol AND m.asof=?) ORDER BY a.symbol LIMIT ?", last, CHUNK);
    if (!todo.length) break;
    const syms = todo.map((x) => x.symbol);
    const old = new Map<string, ReturnType<typeof dailyBars>>();
    for (const [k, v] of await loadSeriesMany(d.db, syms, "1d")) old.set(k, v);
    const fresh = syms.filter((s) => !old.get(s)!.length), inc = syms.filter((s) => old.get(s)!.length);
    const got = new Map<string, ReturnType<typeof dailyBars>>();
    const fetchG = async (g: string[], start: string) => {
      if (!g.length) return;
      const res = await d.alpaca.bars(g, "1Day", start, endIso, d.cfg.dailyFeed, 8);
      pages += res.pages;
      for (const [s, raw] of res.bars) got.set(s, dailyBars(raw as RawBar[]));
    };
    await fetchG(fresh, addDays(last, -400));
    if (inc.length) await fetchG(inc, addDays(nyDate(Math.min(...inc.map((s) => old.get(s)!.slice(-1)[0].end))), -8));
    const redo: string[] = [];
    const merged = new Map<string, ReturnType<typeof dailyBars>>();
    for (const s of syms) {
      const m = mergeSeries(old.get(s)!, got.get(s) ?? [], KEEP);
      if (m.resync) redo.push(s); else merged.set(s, m.merged);
    }
    if (redo.length) { resynced += redo.length; got.clear(); await fetchG(redo, addDays(last, -400)); for (const s of redo) merged.set(s, got.get(s) ?? []); await run(d.db, `UPDATE positions SET needs_review=1 WHERE status='open' AND symbol IN (${redo.map(() => "?").join(",")})`, ...redo); }
    const stmts: { sql: string; args: unknown[] }[] = [];
    await saveSeriesMany(d.db, "1d", merged, now);
    for (const s of syms) {
      const bars = merged.get(s) ?? [];
      const m = bars.length && bars[bars.length - 1].end === close ? computeMetrics(s, bars, last) : null;
      stmts.push({ sql: "INSERT INTO metrics (symbol,asof,price,adv_usd,range_pct,ret63,rs_pct,passed,reason,updated_at,nh,nl,a50,a200,n252) VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET asof=excluded.asof,price=excluded.price,adv_usd=excluded.adv_usd,range_pct=excluded.range_pct,ret63=excluded.ret63,rs_pct=0,passed=0,reason=excluded.reason,updated_at=excluded.updated_at,nh=excluded.nh,nl=excluded.nl,a50=excluded.a50,a200=excluded.a200,n252=excluded.n252",
        args: [s, last, m?.price ?? null, m?.advUsd ?? null, m?.rangePct ?? null, m?.ret63 ?? null, m ? (bars.length < 64 ? `nur ${bars.length} Handelstage Historie` : null) : bars.length ? "Tageskerze des letzten Handelstags fehlt" : "keine Daten", now, m?.nh ?? null, m?.nl ?? null, m?.a50 ?? null, m?.a200 ?? null, bars.length] });
    }
    await batchRun(d.db, stmts);
  }
  const rem = await one<{ n: number }>(d.db, "SELECT COUNT(*) n FROM assets a WHERE a.included=1 AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.symbol=a.symbol AND m.asof=?)", last);
  return { pages, remaining: rem?.n ?? 0, resynced };
}

async function rank(d: Deps, last: string, st: DailyState, now: number) {
  const rows = await all<any>(d.db, "SELECT m.symbol, m.price, m.adv_usd, m.range_pct, m.ret63, m.reason FROM metrics m WHERE m.asof=?", last);
  const lens = new Map((await all<{ symbol: string; n: number }>(d.db, "SELECT symbol, json_array_length(data) n FROM series WHERE tf='1d'")).map((x) => [x.symbol, x.n]));
  const map = new Map<string, Metrics | null>();
  for (const r of rows) map.set(r.symbol, r.price === null ? null : { symbol: r.symbol, asof: last, price: r.price, advUsd: r.adv_usd, rangePct: r.range_pct, ret63: r.ret63, days: lens.get(r.symbol) ?? 0 });
  const { rows: out, stats } = prefilter(d.cfg, map, { available: st.assets?.total ?? 0, excludedByReason: st.assets?.excluded ?? {} });
  await batchRun(d.db, out.map((r) => ({ sql: "UPDATE metrics SET passed=?, rs_pct=?, reason=? WHERE symbol=?", args: [r.passed ? 1 : 0, r.rsPct, r.reason, r.symbol] })));
  return { ...stats, renamed: st.assets?.renamed ?? [], resynced: st.resynced };
}

async function dailyPatterns(d: Deps, last: string, now: number): Promise<number> {
  const watch = (await all<{ symbol: string }>(d.db, "SELECT symbol FROM metrics WHERE passed=1")).map((x) => x.symbol);
  let n = 0, fmpCalls = 0;
  const book = new PreparedBook(d); await book.load();
  const series = await loadSeriesMany(d.db, watch, "1d");
  const actAll = new Map<string, any[]>();
  for (const r of await all<any>(d.db, "SELECT id, symbol, armed_at, data FROM prepared WHERE state='active' AND timeframe='1d'")) (actAll.get(r.symbol) ?? actAll.set(r.symbol, []).get(r.symbol)!).push(r);
  for (const sym of watch) {
    const bars = series.get(sym) ?? [];
    if (bars.length < 31) continue;
    for (const a of actAll.get(sym) ?? []) {
      const p: Prepared = JSON.parse(a.data);
      const bad = bars.find((b) => b.end > a.armed_at && invalidatedByBar(p, b));
      if (bad) await run(d.db, "UPDATE prepared SET state='invalidated', state_reason=? WHERE id=?", `Tageskerze bis ${iso(bad.end)} unterschritt ${p.invalidateBelow.toFixed(2)}`, a.id);
    }
    if (bars[bars.length - 1].end !== sessionFor(last)!.close) continue;
    const params = dailyParams(d.cfg);
    let events: EarningsEvent[] | undefined;
    if (d.fmp && fmpCalls < d.cfg.ercMaxFmpCalls && findGapDays(bars, params).length) {        // Quartalszahlen nur für Titel mit Kurslücke abrufen (FMP-Kontingent)
      try { events = await earningsFor(d, sym, now); fmpCalls++; } catch (e) { await logError(d.db, "fmp", e, now); }
    }
    book.add(sym, bars, prepare(bars, "1d", params, { events }), (p) => addSessions(last, p.ttlBars), true);
  }
  await book.flush();
  n = book.stats.added;
  return n;
}

async function dailyReport(d: Deps, last: string, posLines: string[], now: number) {
  if (!d.cfg.mailDaily) return;
  const u = await getMeta<any>(d.db, "universe_stats");
  const cnt = await all<{ status: string; n: number }>(d.db, "SELECT status, COUNT(*) n FROM signals WHERE signal_time > ? GROUP BY status", now - DAY);
  const errs = await all<{ scope: string; n: number }>(d.db, "SELECT scope, COUNT(*) n FROM errors WHERE ts > ? GROUP BY scope", now - DAY);
  const L = [(d.cfg.mode === "paper" ? "PAPER-MODUS\n" : "") + `Tagesbericht ${last} · ${formatBerlin(now)}`, ""];
  if (u) L.push(`Universum: ${u.available} Titel verfügbar, ${u.excluded} ausgeschlossen (${Object.entries(u.excludedByReason).map(([k, v]) => `${k}: ${v}`).join("; ")}), ${u.dataGaps} mit Datenlücken, ${u.passedLiquidity} liquide, ${u.watch} auf der Beobachtungsliste.`);
  if (u?.renamed?.length) L.push(`Symbolwechsel: ${u.renamed.join("; ")}`);
  L.push(`Signale letzte 24 h: ${cnt.length ? cnt.map((c) => `${c.n}× ${c.status}`).join(", ") : "keine"}`, `Fehler letzte 24 h: ${errs.length ? errs.map((e) => `${e.n}× ${e.scope}`).join(", ") : "keine"}`);
  L.push("", posLines.length ? "Offene Positionen:" : "Keine offenen Positionen.", ...posLines.map((x) => "• " + x));
  L.push("", "Dieser Bericht kommt auch ohne Signale: Wenn er ausbleibt, ist der Dienst ausgefallen.");
  await enqueue(d, { id: `daily:${last}`, kind: "daily", subject: `Tagesbericht ${last}${cnt.some((c) => c.status === "confirmed") ? " · Einstiege" : " · keine Einstiege"}`, text: L.join("\n"), sendBy: now + 12 * 3_600_000 });
}
export { upsert, DAY };

/** Quartalszahlen je Symbol, 7 Tage zwischengespeichert (nur abgeleitete Ereignisse, keine Rohdaten). */
async function earningsFor(d: Deps, symbol: string, now: number): Promise<EarningsEvent[]> {
  const c = await getMeta<{ at: number; ev: EarningsEvent[] }>(d.db, `earn:${symbol}`);
  if (c && now - c.at < 7 * DAY) return c.ev;
  const ev = await (d.fmp as any).earningsFor(symbol, now) as EarningsEvent[];
  await setMeta(d.db, `earn:${symbol}`, { at: now, ev }, now);
  return ev;
}
