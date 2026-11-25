/**
 * Stufe 2 (5 Minuten): nur vorbereitete Kandidaten werden anhand abgeschlossener 5-Minuten-Kerzen geprüft.
 * Ablauf je Auslöser: Trigger-Prüfung → Marktfilter → frischer Kurs → Stopp/Stückzahl neu → bestätigt | verpasst | nicht prüfbar.
 */
import type { Deps } from "../deps";
import { all, run, one, insertIgnore, logError } from "../store";
import type { MarketId } from "../markets";
import { MIN, HOUR, iso } from "../time";
import { checkTrigger, checkDayCloseTrigger, runningHour, HOURLY, DAILY, stopBelow } from "../patterns";
import { SETUP_LABEL, type Prepared, type SetupId } from "../types";
import { loadSeries } from "../series";
import { qqqDecision, qqqNotApplicable } from "../market";
import { checkEntry } from "../entry";
import { sizePosition, type OpenPosition } from "../sizing";
import { entryMail, missedMail, feedText } from "../mail";
import { flushOutbox } from "../outbox";
import { fireSignal, watchOnly, type Hit } from "./signal";
import { decidePermission, getStance } from "../permission";
import { createToken } from "../tokens";
import { spContext, growthFor } from "./context";
import { startRun, finishRun } from "./runs";
import { watchPositions } from "./positions";
import { episodicStage } from "./episodic";
import { assertFeed } from "./probe";

export interface IntradayStats { candidates: number; symbols: number; fired: number; confirmed: number; missed: number; unverifiable: number; blocked: number; noCapacity: number; mails: number }

export async function openPositions(d: Deps): Promise<OpenPosition[]> {
  const rows = await all<any>(d.db, "SELECT symbol, entry, stop, shares, shares_sold, currency FROM positions WHERE status='open'");
  return rows.map((r) => ({ symbol: r.symbol, entry: r.entry, stop: r.stop, sharesRemaining: r.shares - r.shares_sold, currency: r.currency }));
}

/** Beide konfigurierten Märkte nacheinander; jeder prüft nur seine eigene Handelssitzung. */
export async function runIntradayAll(d: Deps): Promise<string> {
  const out: string[] = [];
  for (const id of d.cfg.markets) out.push(`${id}: ${await runIntraday(d, id)}`);
  return out.join(" | ");
}

export async function runIntraday(d: Deps, marketId: MarketId = "US"): Promise<string> {
  const mk = d.markets[marketId];
  const now = d.now(), lag = d.cfg.barLagSec * 1000;
  const day = mk.dateOf(now), s = mk.sessionFor(day);
  if (!s || now < s.open + 5 * MIN + lag || now > s.close + 10 * MIN) return "idle: außerhalb der regulären Handelszeit";
  if (s.early && marketId === "DE") return "idle: verkürzter Xetra-Handelstag (Zeiten nicht hinterlegt) – keine neuen Einstiege";
  if (marketId === "US" && d.checkClock) {
    try {
      const c = await d.alpaca.clock();
      if (!c.is_open && now < s.close) return "idle: Alpaca meldet Börse geschlossen (außerplanmäßig?)";
    } catch (e) { await logError(d.db, "clock", e, now); }
  }
  const feedBlock = marketId === "US" ? await assertFeed(d) : null;
  if (feedBlock) { await logError(d.db, "feed", new Error(feedBlock), now); return "gesperrt: " + feedBlock; }
  const slot = Math.floor(now / (5 * MIN)) * 5 * MIN;
  const r = await startRun(d, "intraday", `intraday:${marketId}:${iso(slot)}`, 4 * MIN);
  if (!r) return "bereits erledigt";
  const st: IntradayStats = { candidates: 0, symbols: 0, fired: 0, confirmed: 0, missed: 0, unverifiable: 0, blocked: 0, noCapacity: 0, mails: 0 };
  const errors: string[] = [];
  try {
    await run(d.db, "UPDATE prepared SET state='expired', state_reason='Verfall' WHERE state='active' AND expires_at <= ?", now);
    if (marketId === "US") try { await episodicStage(d, s); } catch (e) { errors.push("episodic: " + (e instanceof Error ? e.message : e)); await logError(d.db, "episodic", e, now); }

    const rows = await all<any>(d.db, "SELECT * FROM prepared WHERE state='active' AND setup!='episodic_pivot' AND market=?", marketId);
    const epRows = await all<any>(d.db, "SELECT * FROM prepared WHERE state='active' AND setup='episodic_pivot' AND market=?", marketId);
    st.candidates = rows.length + epRows.length;
    const lastEntryEnd = s.open + Math.floor((s.close - s.open) / HOUR) * HOUR; // Ende der letzten vollen Stunde: danach keine neuen Einstiege
    if (now <= lastEntryEnd + lag + 5 * MIN && (rows.length || epRows.length)) {
      const lastFive = s.open + Math.floor((now - lag - s.open) / (5 * MIN)) * 5 * MIN; // Ende der jüngsten abgeschlossenen 5-Minuten-Kerze
      const hourStart = s.open + Math.floor((lastFive - s.open - 1) / HOUR) * HOUR;  // Stunde, die diese Kerze enthält
      const syms = [...new Set([...rows, ...epRows].map((x) => x.symbol))];
      st.symbols = syms.length;
      const earliest = Math.min(hourStart, s.open);
      const five = await mk.data.bars5(syms, earliest, now);
      const dataAt = d.now();   // Datenverfügbarkeit: Zeitpunkt, zu dem die Kerzen abgerufen waren (≥ Kerzenschluss)

      // 1) Auslöser prüfen
      const hits = new Map<string, Hit[]>();
      for (const row of rows) {
        const p: Prepared = JSON.parse(row.data);
        const bars = five.get(row.symbol) ?? [];
        const daily = p.timeframe === "1d";
        const run5 = daily ? runningHour(bars, s.open, now, lag, Math.round((s.close - s.open) / MIN)) : runningHour(bars, hourStart, now, lag, 60);
        if (!run5) continue;
        const t = checkTrigger(p, run5, daily ? DAILY : HOURLY);
        if (!t.fired) continue;
        (hits.get(row.symbol) ?? hits.set(row.symbol, []).get(row.symbol)!).push({ row, p, reasons: t.reasons, stop: t.stop, trigger: p.trigger, signalTime: run5.lastEnd, dataAt });
      }
      for (const row of epRows) {
        const hit = await episodicTrigger(d, row, five.get(row.symbol) ?? [], s, now, lag);
        if (hit) (hits.get(row.symbol) ?? hits.set(row.symbol, []).get(row.symbol)!).push(hit);
      }
      if (hits.size) {
        const detectedAt = d.now();
        const qqq = marketId === "US" ? qqqDecision(d.cfg, await loadSeries(d.db, "QQQ", "1h")) : qqqNotApplicable(d.cfg);
        const stance = await getStance(d, marketId);
        const snaps = await mk.data.quotes([...hits.keys()], d.now());
        const checkedAt = d.now();
        const open = await openPositions(d);
        for (const [symbol, hs] of hits) {
          st.fired++;
          const perm = decidePermission(d.cfg, stance, hs.map((h) => h.p.setup), qqq);
          for (const h of hs) h.detectedAt = detectedAt;
          if (!perm.permitted) { st.blocked++; await watchOnly(d, symbol, hs, perm, [], snaps.get(symbol), checkedAt, qqq, marketId); continue; }
          const sig = await fireSignal(d, symbol, hs.filter((h) => perm.allowed.includes(h.p.setup)), snaps.get(symbol), checkedAt, open, qqq, perm, marketId);
          if (sig === "confirmed") { st.confirmed++; st.mails++; } else if (sig === "missed") { st.missed++; } else if (sig === "watch_only") st.noCapacity++; else if (sig === "unverifiable") st.unverifiable++;
        }
      }
    }
    // Tagesschluss-Setups (z. B. EMA-Reclaim mit Tagesschluss-Bestätigung): erst nach Börsenschluss mit vollständiger Tageskerze
    if (now - lag >= s.close && now <= s.close + 10 * MIN) {
      const dayRows = (await all<any>(d.db, "SELECT * FROM prepared WHERE state='active' AND market=?", marketId)).filter((r) => JSON.parse(r.data).needsDayClose);
      if (dayRows.length) {
        const syms = [...new Set(dayRows.map((x) => x.symbol))];
        const res5 = await mk.data.bars5(syms, s.open, now);
        const dataAt = d.now();
        const hits = new Map<string, Hit[]>();
        for (const row of dayRows) {
          const p: Prepared = JSON.parse(row.data);
          const day = runningHour(res5.get(row.symbol) ?? [], s.open, now, lag, Math.round((s.close - s.open) / MIN));
          if (!day || day.lastEnd < s.close) continue;                 // Tageskerze muss vollständig sein
          const t = checkDayCloseTrigger(p, day);
          if (t.fired) (hits.get(row.symbol) ?? hits.set(row.symbol, []).get(row.symbol)!).push({ row, p, reasons: t.reasons, stop: t.stop, trigger: p.trigger, signalTime: day.lastEnd, dataAt, detectedAt: d.now() });
        }
        if (hits.size) {
          const qqq = marketId === "US" ? qqqDecision(d.cfg, await loadSeries(d.db, "QQQ", "1h")) : qqqNotApplicable(d.cfg), stance = await getStance(d, marketId), snaps = await mk.data.quotes([...hits.keys()], d.now()), open = await openPositions(d);
          for (const [symbol, hs] of hits) {
            st.fired++;
            const perm = decidePermission(d.cfg, stance, hs.map((h) => h.p.setup), qqq);
            if (!perm.permitted) { st.blocked++; await watchOnly(d, symbol, hs, perm, [], snaps.get(symbol), d.now(), qqq, marketId); continue; }
            const sig = await fireSignal(d, symbol, hs.filter((h) => perm.allowed.includes(h.p.setup)), snaps.get(symbol), d.now(), open, qqq, perm, marketId);
            if (sig === "confirmed") st.confirmed++; else if (sig === "missed") st.missed++;
          }
        }
      }
    }
    try { await watchPositions(d, mk, s); } catch (e) { errors.push("positions: " + (e instanceof Error ? e.message : e)); await logError(d.db, "positions", e, now); }
    await flushOutbox(d);
    await finishRun(d, r.id, errors.length ? "partial" : "ok", { ...st, errors });
    return `ok: ${st.candidates} Kandidaten, ${st.fired} ausgelöst, ${st.confirmed} bestätigt, ${st.missed} verpasst`;
  } catch (e) {
    await logError(d.db, "intraday", e, now);
    await finishRun(d, r.id, "failed", st, e instanceof Error ? e.message : String(e));
    return `fehlgeschlagen: ${e instanceof Error ? e.message : e}`;
  }
}

async function episodicTrigger(d: Deps, row: any, bars5: import("../types").Bar[], s: { open: number; close: number }, now: number, lag: number): Promise<Hit | null> {
  const p: Prepared = JSON.parse(row.data);
  const firstEnd = s.open + HOUR;
  if (now - lag < firstEnd) return null;                       // erste Handelsstunde noch nicht abgeschlossen
  if (now > firstEnd + 60 * MIN) { await run(d.db, "UPDATE prepared SET state='expired', state_reason='Fenster nach der ersten Stunde verpasst' WHERE id=?", row.id); return null; }
  const first = runningHour(bars5, s.open, now, lag, 60);
  if (!first || first.elapsedMin < 60) return null;            // Stundenschluss ist Pflicht: unvollständige Stunde zählt nicht
  const hist = (await loadSeries(d.db, row.symbol, "1h")).filter((b) => nyHM(b.end) === "10:30" && b.end <= s.open);
  const vols = hist.slice(-10).map((b) => b.v).sort((a, b) => a - b);
  if (vols.length < 5) { await run(d.db, "UPDATE prepared SET state='invalid', state_reason=? WHERE id=?", `nur ${vols.length} vergleichbare Eröffnungsstunden`, row.id); return null; }
  const median = vols.length % 2 ? vols[(vols.length - 1) / 2] : (vols[vols.length / 2 - 1] + vols[vols.length / 2]) / 2;
  const reasons: string[] = [];
  if (!(first.c >= first.o)) { await run(d.db, "UPDATE prepared SET state='invalidated', state_reason='erste Stunde schloss unter der Eröffnung' WHERE id=?", row.id); return null; }
  if (!(first.v >= 2 * median)) { await run(d.db, "UPDATE prepared SET state='invalidated', state_reason=? WHERE id=?", `Volumen ${Math.round(first.v)} < 2× Median ${Math.round(median)}`, row.id); return null; }
  const gap = p.extra as any;
  reasons.push(`Gap ${(gap.gapPct as number).toFixed(1)} % zur Eröffnung (Vortagesschluss ${gap.prevClose}), Katalysator: ${gap.catalyst}`,
    `Erste Handelsstunde schloss bei ${first.c.toFixed(2)} ≥ Eröffnung ${first.o.toFixed(2)}`, `Volumen ${Math.round(first.v)} ≥ 2× Median der letzten ${vols.length} Eröffnungsstunden (${Math.round(median)})`);
  const stop = stopBelow(first.l);
  return { row, p: { ...p, trigger: first.c, stop }, reasons, stop, trigger: first.c, signalTime: first.lastEnd, dataAt: d.now() };
}
const nyHM = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
export { SETUP_LABEL, one };
