/**
 * Tagesstufe je Markt nach Börsenschluss (fortsetzbar):
 * Universum → Indexmitgliedschaften → Tageskerzen → Vorauswahl/Kandidatenprotokoll/Abdeckung → Marktlage → Tages-Setups → Positionsprüfung → Tagesbericht.
 * Das Universum entsteht aus ALLEN geeigneten Aktien des Marktes (außerhalb der Indizes eingeschlossen); die Indizes dienen der Abdeckungskontrolle.
 */
import type { Deps } from "../deps";
import { all, one, run, getMeta, setMeta, logError, batchRun, upsert } from "../store";
import { DAY, MIN, addDays, iso, formatBerlin } from "../time";
import { classifyAsset, classifyDe, computeMetrics, prefilter, usThresholds, deThresholds, shareClassOf, type Metrics, type Classified } from "../universe";
import { loadSeriesMany, saveSeriesMany, mergeSeries, addSessions } from "../series";
import { prepare, invalidatedByBar, findGapDays, dailyParams } from "../patterns";
import type { Prepared } from "../types";
import { startRun, finishRun } from "./runs";
import { notifyPrewarn, PreparedBook } from "./prewarn";
import { reviewPositions } from "./positions";
import { enqueue, flushOutbox } from "../outbox";
import { runProbe } from "./probe";
import { updateRegime } from "./regime";
import type { EarningsEvent } from "../catalyst";
import type { Market, MarketId } from "../markets";
import { MissingAccess, RateLimited, type AssetInfo } from "../marketdata";
import { INDEXES, fetchIndexMembers, matchMembers, sourcesFrom, reasonCategory, type Coverage, type IndexCoverage } from "../indexes";
import type { AssetRaw } from "../providers";

interface DailyState { stage: "assets" | "indexes" | "bars" | "rank" | "regime" | "patterns" | "review" | "done"; assets?: { total: number; excluded: Record<string, number>; renamed: string[] }; barsPages: number; resynced: number }
const CHUNK = 150, PAGE_BUDGET = 40, KEEP = 270;

/** Alle konfigurierten Märkte nacheinander; jeder Markt hat eigenen Zustand und eigene Läufe. */
export async function runDailyAll(d: Deps): Promise<string> {
  const out: string[] = [];
  for (const id of d.cfg.markets) out.push(`${id}: ${await runDaily(d, id)}`);
  return out.join(" | ");
}

export async function runDaily(d: Deps, marketId: MarketId = "US"): Promise<string> {
  const mk = d.markets[marketId], now = d.now();
  const last = mk.lastCompletedSession(now, 20);
  if (now - mk.sessionFor(last)!.close > 4 * DAY) return "idle";
  const key = `daily_state:${marketId}:${last}`;
  let st = (await getMeta<DailyState>(d.db, key)) ?? { stage: "assets" as const, barsPages: 0, resynced: 0 };
  if (st.stage === "done") return "bereits erledigt";
  const r = await startRun(d, "daily", `daily:${marketId}:${last}`, 9 * MIN);
  if (!r) return "läuft bereits oder erledigt";
  try {
    if (st.stage === "assets") {
      if (marketId === "US") await runProbe(d).catch((e) => logError(d.db, "probe", e, now));
      st.assets = await refreshAssets(d, mk, now);
      st.stage = "indexes"; await setMeta(d.db, key, st, now);
    }
    if (st.stage === "indexes") {
      await refreshIndexes(d, mk, last, now);
      st.stage = "bars"; await setMeta(d.db, key, st, now);
    }
    if (st.stage === "bars") {
      const pages = await syncBars(d, mk, last, now, st);
      st.barsPages += pages.pages; st.resynced += pages.resynced;
      st.stage = pages.remaining === 0 ? "rank" : "bars"; await setMeta(d.db, key, st, now);
      if (st.stage === "bars") { await finishRun(d, r.id, "partial", { stage: "bars", remaining: pages.remaining }); return `Tageskerzen: noch ${pages.remaining} Symbole offen (setzt mit dem nächsten Takt fort)`; }
    }
    if (st.stage === "rank") {
      const stats = await rank(d, mk, last, st, now);
      await setMeta(d.db, `universe_stats:${marketId}`, { ...stats, asof: last }, now);
      await computeCoverage(d, mk, last, st, stats, now);
      st.stage = "regime"; await setMeta(d.db, key, st, now);
    }
    if (st.stage === "regime") {
      try { await updateRegime(d, mk, last, now); } catch (e) { await logError(d.db, "regime", e, now); }   // Marktlage ist Information: ein Fehler stoppt den Lauf nicht
      st.stage = "patterns"; await setMeta(d.db, key, st, now);
    }
    if (st.stage === "patterns") {
      const n = await dailyPatterns(d, mk, last, now);
      await notifyPrewarn(d, `daily:${marketId}:${last}`);
      st.stage = "review"; await setMeta(d.db, key, st, now);
      await setMeta(d.db, `daily_patterns:${marketId}`, { asof: last, newPrepared: n }, now);
    }
    if (st.stage === "review") {
      await run(d.db, "UPDATE positions SET status='expired', closed_at=? WHERE status='pending' AND market=? AND created_at < ?", now, marketId, now - 4 * DAY);
      const lines = await reviewPositions(d, mk);
      await dailyReport(d, mk, last, lines, now);
      st.stage = "done"; await setMeta(d.db, key, st, now);
    }
    await flushOutbox(d);
    await finishRun(d, r.id, "ok", { stage: st.stage, resynced: st.resynced });
    return "ok: Tageslauf abgeschlossen";
  } catch (e) {
    if (e instanceof MissingAccess) {   // Zugang fehlt: genaue Lücke sichtbar machen, nichts buchen, kein Fehlerlärm
      await setMeta(d.db, `data_gap:${marketId}`, { ...e.gap, at: now }, now);
      await finishRun(d, r.id, "failed", { stage: st.stage }, e.message);
      return `Datenzugang fehlt: ${e.message}`;
    }
    if (e instanceof RateLimited) { await finishRun(d, r.id, "partial", { stage: st.stage }, e.message); return `${e.message}`; }
    await logError(d.db, "daily", e, now);
    await finishRun(d, r.id, "failed", { stage: st.stage }, e instanceof Error ? e.message : String(e));
    return `fehlgeschlagen in Stufe ${st.stage}: ${e instanceof Error ? e.message : e}`;
  }
}

async function refreshAssets(d: Deps, mk: Market, now: number) {
  const infos = await mk.data.assets();
  await setMeta(d.db, `data_gap:${mk.id}`, null, now);
  const excluded: Record<string, number> = {};
  const incl: (AssetInfo & { c: Classified })[] = [];
  const seenIsin = new Set<string>();
  for (const a of infos) {
    let v: Classified;
    if (mk.id === "US") { const x = classifyAsset(a.raw as AssetRaw, d.cfg); v = { included: x.included, reason: x.reason, shareClass: shareClassOf(a.name, a.symbol), isin: null }; }
    else v = classifyDe(a, d.cfg);
    if (v.included && v.isin) { if (seenIsin.has(v.isin)) v = { ...v, included: false, reason: "Duplikat (gleiche ISIN)" }; else seenIsin.add(v.isin); }
    if (v.included) incl.push({ ...a, c: v }); else excluded[v.reason!] = (excluded[v.reason!] ?? 0) + 1;
  }
  const existing = await all<{ symbol: string; asset_id: string }>(d.db, "SELECT symbol, asset_id FROM assets WHERE market=?", mk.id);
  const bySym = new Map(existing.map((e) => [e.symbol, e.asset_id])), byId = new Map(existing.map((e) => [e.asset_id, e.symbol]));
  const stmts: { sql: string; args: unknown[] }[] = [];
  const renamed: string[] = [];
  const purge = (sym: string) => ["assets", "series", "metrics"].forEach((t) => stmts.push({ sql: `DELETE FROM ${t} WHERE symbol=?`, args: [sym] }));
  const keep = new Set(incl.map((a) => a.key));
  for (const a of incl) {
    const stableId = a.c.isin ?? a.providerId ?? a.key;
    const sameSymOtherAsset = bySym.has(a.key) && bySym.get(a.key) !== stableId;
    const oldSym = byId.get(stableId);
    if (sameSymOtherAsset) { purge(a.key); renamed.push(`${a.symbol}: anderes Wertpapier (Symbol neu vergeben)`); }
    if (oldSym && oldSym !== a.key) { purge(oldSym); renamed.push(`${oldSym.replace(/^XETR:/, "")} → ${a.symbol}`); }
    stmts.push({ sql: "INSERT INTO assets (symbol,asset_id,name,exchange,included,first_seen,updated_at,market,mic,isin,share_class,currency) VALUES (?,?,?,?,1,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET asset_id=excluded.asset_id,name=excluded.name,exchange=excluded.exchange,included=1,updated_at=excluded.updated_at,market=excluded.market,mic=excluded.mic,isin=excluded.isin,share_class=excluded.share_class,currency=excluded.currency",
      args: [a.key, stableId, a.name, a.mic, now, now, mk.id, a.mic, a.c.isin, a.c.shareClass, a.currency] });
  }
  for (const e of existing) if (!keep.has(e.symbol)) purge(e.symbol);
  await batchRun(d.db, stmts);
  return { total: infos.length, excluded, renamed };
}

/** Indexmitglieder laden und den erfassten Instrumenten zuordnen. Fehlende Quelle/Abruffehler werden als Lücke geführt, nie als 0 Mitglieder. */
async function refreshIndexes(d: Deps, mk: Market, last: string, now: number) {
  const sources = sourcesFrom(d.cfg.indexSources);
  const assets = await all<{ symbol: string; isin: string | null }>(d.db, "SELECT symbol, isin FROM assets WHERE market=? AND included=1", mk.id);
  const list = assets.map((a) => ({ key: a.symbol, symbol: a.symbol.replace(/^XETR:/, ""), isin: a.isin }));
  const res: Record<string, { status: string; source: string | null; error?: string; members?: number; unmatched?: { symbol: string; name: string }[]; unmatchedCount?: number }> = {};
  for (const ix of INDEXES.filter((i) => i.market === mk.id)) {
    const src = sources[ix.id];
    if (!src) { res[ix.id] = { status: "quelle_fehlt", source: null }; continue; }
    try {
      const members = await fetchIndexMembers(d.fetch, src);
      const m = matchMembers(members, list);
      await run(d.db, "DELETE FROM index_members WHERE index_id=?", ix.id);
      await batchRun(d.db, [...m.matched].map(([k, sym]) => ({ sql: "INSERT OR REPLACE INTO index_members (index_id,inst_key,member_symbol,source,asof) VALUES (?,?,?,?,?)", args: [ix.id, k, sym, src.url, last] })), 40);
      res[ix.id] = { status: "ok", source: src.note ?? src.url, members: members.length, unmatched: m.unmatched.slice(0, 15).map((x) => ({ symbol: x.symbol, name: x.name })), unmatchedCount: m.unmatched.length };
    } catch (e) {
      res[ix.id] = { status: "abruf_fehlgeschlagen", source: src.url, error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
      await logError(d.db, "index:" + ix.id, e, now);
    }
  }
  await setMeta(d.db, `index_fetch:${mk.id}`, { asof: last, res }, now);
}

async function syncBars(d: Deps, mk: Market, last: string, now: number, st: DailyState): Promise<{ pages: number; remaining: number; resynced: number }> {
  const close = mk.sessionFor(last)!.close;
  const endMs = Math.min(now - mk.dailyDelayMin * MIN, close + 2 * 3_600_000);
  let pages = 0, resynced = 0;
  while (pages < PAGE_BUDGET) {
    const todo = await all<{ symbol: string }>(d.db, "SELECT a.symbol FROM assets a WHERE a.included=1 AND a.market=? AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.symbol=a.symbol AND m.asof=?) ORDER BY a.symbol LIMIT ?", mk.id, last, CHUNK);
    if (!todo.length) break;
    const syms = todo.map((x) => x.symbol);
    const old = new Map<string, ReturnType<typeof Array.prototype.slice>>() as Map<string, any[]>;
    for (const [k, v] of await loadSeriesMany(d.db, syms, "1d")) old.set(k, v);
    const fresh = syms.filter((s) => !old.get(s)!.length), inc = syms.filter((s) => old.get(s)!.length);
    const got = new Map<string, any[]>();
    const fetchG = async (g: string[], start: string) => {
      if (!g.length) return;
      const res = await mk.data.dailyBars(g, start, endMs);
      pages += res.requests;
      for (const [s, b] of res.bars) got.set(s, b);
    };
    await fetchG(fresh, addDays(last, -400));
    if (inc.length) await fetchG(inc, addDays(mk.dateOf(Math.min(...inc.map((s) => old.get(s)!.slice(-1)[0].end)) ), -8));
    const redo: string[] = [];
    const merged = new Map<string, any[]>();
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
      stmts.push({ sql: "INSERT INTO metrics (symbol,asof,price,adv_usd,range_pct,ret63,rs_pct,passed,reason,updated_at,nh,nl,a50,a200,n252,market,currency) VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET asof=excluded.asof,price=excluded.price,adv_usd=excluded.adv_usd,range_pct=excluded.range_pct,ret63=excluded.ret63,rs_pct=0,passed=0,reason=excluded.reason,updated_at=excluded.updated_at,nh=excluded.nh,nl=excluded.nl,a50=excluded.a50,a200=excluded.a200,n252=excluded.n252,market=excluded.market,currency=excluded.currency",
        args: [s, last, m?.price ?? null, m?.adv ?? null, m?.rangePct ?? null, m?.ret63 ?? null, m ? (bars.length < 64 ? `nur ${bars.length} Handelstage Historie` : null) : bars.length ? "Tageskerze des letzten Handelstags fehlt" : "keine Daten", now, m?.nh ?? null, m?.nl ?? null, m?.a50 ?? null, m?.a200 ?? null, bars.length, mk.id, mk.currency] });
    }
    await batchRun(d.db, stmts);
  }
  const rem = await one<{ n: number }>(d.db, "SELECT COUNT(*) n FROM assets a WHERE a.included=1 AND a.market=? AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.symbol=a.symbol AND m.asof=?)", mk.id, last);
  return { pages, remaining: rem?.n ?? 0, resynced };
}

async function rank(d: Deps, mk: Market, last: string, st: DailyState, now: number) {
  const rows = await all<any>(d.db, "SELECT m.symbol, m.price, m.adv_usd, m.range_pct, m.ret63, m.reason FROM metrics m WHERE m.asof=? AND m.market=?", last, mk.id);
  const lens = new Map((await all<{ symbol: string; n: number }>(d.db, "SELECT symbol, json_array_length(data) n FROM series WHERE tf='1d'")).map((x) => [x.symbol, x.n]));
  const map = new Map<string, Metrics | null>();
  for (const r of rows) map.set(r.symbol, r.price === null ? null : { symbol: r.symbol, asof: last, price: r.price, adv: r.adv_usd, rangePct: r.range_pct, ret63: r.ret63, days: lens.get(r.symbol) ?? 0 });
  const thr = mk.id === "US" ? usThresholds(d.cfg) : deThresholds(d.cfg);
  const { rows: out, stats } = prefilter(d.cfg, map, { available: st.assets?.total ?? 0, excludedByReason: st.assets?.excluded ?? {} }, thr);
  await batchRun(d.db, out.map((r) => ({ sql: "UPDATE metrics SET passed=?, rs_pct=?, reason=? WHERE symbol=?", args: [r.passed ? 1 : 0, r.rsPct, r.reason, r.symbol] })));
  // Unveränderliches Kandidatenprotokoll (nur INSERT): Rang und Begründung, bevor der weitere Kursverlauf bekannt ist
  const memberships = new Map<string, string[]>();
  for (const m of await all<{ inst_key: string; index_id: string }>(d.db, "SELECT inst_key, index_id FROM index_members")) (memberships.get(m.inst_key) ?? memberships.set(m.inst_key, []).get(m.inst_key)!).push(m.index_id);
  const cand = out.filter((r) => r.passed);
  await batchRun(d.db, cand.map((r) => ({ sql: "INSERT OR IGNORE INTO candidate_log (asof,market,inst_key,rank,score,reasons,recorded_at) VALUES (?,?,?,?,?,?,?)", args: [last, mk.id, r.symbol, r.rank!, r.rsPct, JSON.stringify([
    `Relative Stärke: 63-Tage-Rendite ${(r.ret63 * 100).toFixed(1)} % = Perzentil ${r.rsPct.toFixed(0)} im Markt ${mk.label}`,
    `Liquidität: Ø-Umsatz 20 Tage ${(r.adv / 1e6).toFixed(1)} Mio ${thr.currency}`, `Handelsspanne: Ø-Tagesspanne ${r.rangePct.toFixed(1)} %`,
    `Kurs ${r.price.toFixed(2)} ${thr.currency}`, memberships.get(r.symbol)?.length ? `Indizes: ${memberships.get(r.symbol)!.join(", ")}` : "außerhalb der kontrollierten Indizes (trotzdem gescannt)"]), now] })), 40);
  return { ...stats, renamed: st.assets?.renamed ?? [], resynced: st.resynced };
}

/** Abdeckung je Markt und Index: erfasst · aktuelle Daten · Filter · tatsächlich auf Setups geprüft. */
async function computeCoverage(d: Deps, mk: Market, last: string, st: DailyState, stats: any, now: number) {
  const fetched = (await getMeta<any>(d.db, `index_fetch:${mk.id}`))?.res ?? {};
  const inst = await all<any>(d.db, "SELECT a.symbol, m.price, m.passed, m.reason FROM assets a LEFT JOIN metrics m ON m.symbol=a.symbol AND m.asof=? WHERE a.included=1 AND a.market=?", last, mk.id);
  const mem = new Map<string, Set<string>>();
  for (const r of await all<{ index_id: string; inst_key: string }>(d.db, "SELECT index_id, inst_key FROM index_members")) (mem.get(r.index_id) ?? mem.set(r.index_id, new Set()).get(r.index_id)!).add(r.inst_key);
  const bySym = new Map(inst.map((i) => [i.symbol, i]));
  const agg = (keys: Iterable<string>) => {
    let captured = 0, withData = 0, checked = 0; const filt: Record<string, number> = {};
    for (const k of keys) { const i = bySym.get(k); if (!i) continue; captured++; if (i.price !== null) withData++; if (i.passed) checked++; else { const c = reasonCategory(i.reason); filt[c] = (filt[c] ?? 0) + 1; } }
    return { captured, withData, checked, filt };
  };
  const indexes: IndexCoverage[] = INDEXES.filter((i) => i.market === mk.id).map((ix) => {
    const f = fetched[ix.id] ?? { status: "quelle_fehlt", source: null };
    const a = agg(mem.get(ix.id) ?? []);
    return { id: ix.id, label: ix.label, status: f.status, source: f.source, error: f.error, asof: last, members: f.members ?? null, captured: a.captured, withData: a.withData, checked: a.checked, excludedByFilter: a.filt, unmatched: f.unmatched ?? [], unmatchedCount: f.unmatchedCount ?? 0 };
  });
  const inAny = new Set<string>(); for (const ix of indexes) for (const k of mem.get(ix.id) ?? []) inAny.add(k);
  const outside = agg(inst.filter((i) => !inAny.has(i.symbol)).map((i) => i.symbol));
  const total = agg(inst.map((i) => i.symbol));
  const cov: Coverage = { market: mk.id, asof: last, available: stats.available, excludedByClass: stats.excludedByReason, included: inst.length, withData: total.withData, dataGaps: stats.dataGaps,
    passedFilters: stats.passedLiquidity, checked: total.checked, indexes, outside: { captured: outside.captured, withData: outside.withData, checked: outside.checked }, dataAccess: { ok: true, detail: mk.data.feedLabel } };
  await setMeta(d.db, `coverage:${mk.id}`, cov, now);
  void st;
}

async function dailyPatterns(d: Deps, mk: Market, last: string, now: number): Promise<number> {
  const watch = (await all<{ symbol: string }>(d.db, "SELECT symbol FROM metrics WHERE passed=1 AND market=?", mk.id)).map((x) => x.symbol);
  let n = 0, fmpCalls = 0;
  const book = new PreparedBook(d); await book.load();
  const series = await loadSeriesMany(d.db, watch, "1d");
  const actAll = new Map<string, any[]>();
  for (const r of await all<any>(d.db, "SELECT id, symbol, armed_at, data FROM prepared WHERE state='active' AND timeframe='1d' AND market=?", mk.id)) (actAll.get(r.symbol) ?? actAll.set(r.symbol, []).get(r.symbol)!).push(r);
  for (const sym of watch) {
    const bars = series.get(sym) ?? [];
    if (bars.length < 31) continue;
    for (const a of actAll.get(sym) ?? []) {
      const p: Prepared = JSON.parse(a.data);
      const bad = bars.find((b) => b.end > a.armed_at && invalidatedByBar(p, b));
      if (bad) await run(d.db, "UPDATE prepared SET state='invalidated', state_reason=? WHERE id=?", `Tageskerze bis ${iso(bad.end)} unterschritt ${p.invalidateBelow.toFixed(2)}`, a.id);
    }
    if (bars[bars.length - 1].end !== mk.sessionFor(last)!.close) continue;
    const params = dailyParams(d.cfg);
    let events: EarningsEvent[] | undefined;
    // Quartalszahlen (FMP, überwiegend US) nur für US-Titel mit Kurslücke abrufen (FMP-Kontingent)
    if (mk.id === "US" && d.fmp && fmpCalls < d.cfg.ercMaxFmpCalls && findGapDays(bars, params).length) {
      try { events = await earningsFor(d, sym, now); fmpCalls++; } catch (e) { await logError(d.db, "fmp", e, now); }
    }
    book.add(sym, bars, prepare(bars, "1d", params, { events }), (p) => addSessions(last, p.ttlBars, mk), mk.id, mk.currency);
  }
  await book.flush();
  n = book.stats.added;
  return n;
}

async function dailyReport(d: Deps, mk: Market, last: string, posLines: string[], now: number) {
  if (!d.cfg.mailDaily) return;
  const u = await getMeta<any>(d.db, `universe_stats:${mk.id}`);
  const cov = await getMeta<Coverage>(d.db, `coverage:${mk.id}`);
  const cnt = await all<{ status: string; n: number }>(d.db, "SELECT status, COUNT(*) n FROM signals WHERE signal_time > ? AND market=? GROUP BY status", now - DAY, mk.id);
  const errs = await all<{ scope: string; n: number }>(d.db, "SELECT scope, COUNT(*) n FROM errors WHERE ts > ? GROUP BY scope", now - DAY);
  const L = [(d.cfg.mode === "paper" ? "PAPER-MODUS\n" : "") + `Tagesbericht ${mk.label} ${last} · ${formatBerlin(now)}`, ""];
  if (u) L.push(`Universum: ${u.available} Titel verfügbar, ${u.excluded} ausgeschlossen (${Object.entries(u.excludedByReason).map(([k, v]) => `${k}: ${v}`).join("; ")}), ${u.dataGaps} mit Datenlücken, ${u.passedLiquidity} liquide, ${u.watch} auf der Beobachtungsliste.`);
  if (cov) for (const ix of cov.indexes) L.push(`• ${ix.label}: ${ix.status === "ok" ? `${ix.members} Mitglieder, ${ix.captured} erfasst, ${ix.withData} mit aktuellen Daten, ${ix.checked} auf Setups geprüft` : ix.status === "quelle_fehlt" ? "Indexquelle fehlt (Abdeckung nicht prüfbar)" : "Indexabruf fehlgeschlagen"}`);
  if (cov) L.push(`• Außerhalb der kontrollierten Indizes: ${cov.outside.captured} erfasst, ${cov.outside.checked} auf Setups geprüft`);
  if (u?.renamed?.length) L.push(`Symbolwechsel: ${u.renamed.join("; ")}`);
  L.push(`Signale letzte 24 h: ${cnt.length ? cnt.map((c) => `${c.n}× ${c.status}`).join(", ") : "keine"}`, `Fehler letzte 24 h: ${errs.length ? errs.map((e) => `${e.n}× ${e.scope}`).join(", ") : "keine"}`);
  L.push("", posLines.length ? "Offene Positionen:" : "Keine offenen Positionen.", ...posLines.map((x) => "• " + x));
  L.push("", "Dieser Bericht kommt auch ohne Signale: Wenn er ausbleibt, ist der Dienst ausgefallen.");
  await enqueue(d, { id: `daily:${mk.id}:${last}`, kind: "daily", subject: `Tagesbericht ${mk.id} ${last}${cnt.some((c) => c.status === "confirmed") ? " · Einstiege" : " · keine Einstiege"}`, text: L.join("\n"), sendBy: now + 12 * 3_600_000 });
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
