/**
 * Stufe 2 (5 Minuten): nur vorbereitete Kandidaten werden anhand abgeschlossener 5-Minuten-Kerzen geprüft.
 * Ablauf je Auslöser: Trigger-Prüfung → Marktfilter → frischer Kurs → Stopp/Stückzahl neu → bestätigt | verpasst | nicht prüfbar.
 */
import type { Deps } from "../deps";
import { all, run, one, insertIgnore, logError } from "../store";
import { sessionFor, previousSession } from "../calendar";
import { MIN, HOUR, iso, nyDate } from "../time";
import { toBars, bestQuote, ms, type RawBar, type Snapshot } from "../providers";
import { checkTrigger, runningHour, HOURLY, DAILY, stopBelow } from "../patterns";
import { SETUP_LABEL, type Prepared, type SetupId } from "../types";
import { loadSeries } from "../series";
import { qqqDecision } from "../market";
import { checkEntry } from "../entry";
import { sizePosition, type OpenPosition } from "../sizing";
import { entryMail, missedMail, feedText } from "../mail";
import { enqueue, flushOutbox } from "../outbox";
import { createToken } from "../tokens";
import { spContext, growthFor } from "./context";
import { startRun, finishRun } from "./runs";
import { watchPositions } from "./positions";
import { episodicStage } from "./episodic";
import { assertFeed } from "./probe";

type Hit = { row: any; p: Prepared; reasons: string[]; stop: number; trigger: number; signalTime: number };

export interface IntradayStats { candidates: number; symbols: number; fired: number; confirmed: number; missed: number; unverifiable: number; blocked: number; noCapacity: number; mails: number }

export async function openPositions(d: Deps): Promise<OpenPosition[]> {
  const rows = await all<any>(d.db, "SELECT symbol, entry, stop, shares, shares_sold FROM positions WHERE status='open'");
  return rows.map((r) => ({ symbol: r.symbol, entry: r.entry, stop: r.stop, sharesRemaining: r.shares - r.shares_sold }));
}

export async function runIntraday(d: Deps): Promise<string> {
  const now = d.now(), lag = d.cfg.barLagSec * 1000;
  const day = nyDate(now), s = sessionFor(day);
  if (!s || now < s.open + 5 * MIN + lag || now > s.close + 10 * MIN) return "idle: außerhalb der regulären Handelszeit";
  if (d.checkClock) {
    try {
      const c = await d.alpaca.clock();
      if (!c.is_open && now < s.close) return "idle: Alpaca meldet Börse geschlossen (außerplanmäßig?)";
    } catch (e) { await logError(d.db, "clock", e, now); }
  }
  const feedBlock = await assertFeed(d);
  if (feedBlock) { await logError(d.db, "feed", new Error(feedBlock), now); return "gesperrt: " + feedBlock; }
  const slot = Math.floor(now / (5 * MIN)) * 5 * MIN;
  const r = await startRun(d, "intraday", `intraday:${iso(slot)}`, 4 * MIN);
  if (!r) return "bereits erledigt";
  const st: IntradayStats = { candidates: 0, symbols: 0, fired: 0, confirmed: 0, missed: 0, unverifiable: 0, blocked: 0, noCapacity: 0, mails: 0 };
  const errors: string[] = [];
  try {
    await run(d.db, "UPDATE prepared SET state='expired', state_reason='Verfall' WHERE state='active' AND expires_at <= ?", now);
    try { await episodicStage(d, s); } catch (e) { errors.push("episodic: " + (e instanceof Error ? e.message : e)); await logError(d.db, "episodic", e, now); }

    const rows = await all<any>(d.db, "SELECT * FROM prepared WHERE state='active' AND setup!='episodic_pivot'");
    const epRows = await all<any>(d.db, "SELECT * FROM prepared WHERE state='active' AND setup='episodic_pivot'");
    st.candidates = rows.length + epRows.length;
    const lastEntryEnd = s.open + Math.floor((s.close - s.open) / HOUR) * HOUR; // Ende der letzten vollen Stunde: danach keine neuen Einstiege
    if (now <= lastEntryEnd + lag + 5 * MIN && (rows.length || epRows.length)) {
      const lastFive = s.open + Math.floor((now - lag - s.open) / (5 * MIN)) * 5 * MIN; // Ende der jüngsten abgeschlossenen 5-Minuten-Kerze
      const hourStart = s.open + Math.floor((lastFive - s.open - 1) / HOUR) * HOUR;  // Stunde, die diese Kerze enthält
      const syms = [...new Set([...rows, ...epRows].map((x) => x.symbol))];
      st.symbols = syms.length;
      const earliest = Math.min(hourStart, s.open);
      const res = await d.alpaca.bars(syms, "5Min", new Date(earliest).toISOString(), new Date(now).toISOString(), d.cfg.feed);
      const five = new Map<string, ReturnType<typeof toBars>>();
      for (const [k, v] of res.bars) five.set(k, toBars(v as RawBar[], 5 * MIN));

      // 1) Auslöser prüfen
      const hits = new Map<string, Hit[]>();
      for (const row of rows) {
        const p: Prepared = JSON.parse(row.data);
        const bars = five.get(row.symbol) ?? [];
        const daily = p.timeframe === "1d";
        const run5 = daily ? runningHour(bars, s.open, now, lag, 390) : runningHour(bars, hourStart, now, lag, 60);
        if (!run5) continue;
        const t = checkTrigger(p, run5, daily ? DAILY : HOURLY);
        if (!t.fired) continue;
        (hits.get(row.symbol) ?? hits.set(row.symbol, []).get(row.symbol)!).push({ row, p, reasons: t.reasons, stop: t.stop, trigger: p.trigger, signalTime: run5.lastEnd });
      }
      for (const row of epRows) {
        const hit = await episodicTrigger(d, row, five.get(row.symbol) ?? [], s, now, lag);
        if (hit) (hits.get(row.symbol) ?? hits.set(row.symbol, []).get(row.symbol)!).push(hit);
      }
      if (hits.size) {
        const qqq = qqqDecision(d.cfg, await loadSeries(d.db, "QQQ", "1h"));
        const snaps = await d.alpaca.snapshots([...hits.keys()], d.cfg.feed);
        const checkedAt = d.now();
        const open = await openPositions(d);
        for (const [symbol, hs] of hits) {
          st.fired++;
          const allowed = hs.filter((h) => !qqq.blocked.includes(h.p.setup));
          if (!allowed.length) { st.blocked++; await recordBlocked(d, symbol, hs, qqq.text); continue; }
          const sig = await fireSignal(d, symbol, allowed, snaps.get(symbol), checkedAt, open, qqq, s.open);
          if (sig === "confirmed") { st.confirmed++; st.mails++; } else if (sig === "missed") { st.missed++; } else if (sig === "no_capacity") st.noCapacity++; else if (sig === "unverifiable") st.unverifiable++;
        }
      }
    }
    try { await watchPositions(d, s); } catch (e) { errors.push("positions: " + (e instanceof Error ? e.message : e)); await logError(d.db, "positions", e, now); }
    await flushOutbox(d);
    await finishRun(d, r.id, errors.length ? "partial" : "ok", { ...st, errors });
    return `ok: ${st.candidates} Kandidaten, ${st.fired} ausgelöst, ${st.confirmed} bestätigt, ${st.missed} verpasst`;
  } catch (e) {
    await logError(d.db, "intraday", e, now);
    await finishRun(d, r.id, "failed", st, e instanceof Error ? e.message : String(e));
    return `fehlgeschlagen: ${e instanceof Error ? e.message : e}`;
  }
}

/** Marktfilter blockiert: Kandidat bleibt aktiv (der Filter ist eine Vorbedingung zum Zeitpunkt des Einstiegs), die blockierende Regel wird einmal je Tag protokolliert. */
async function recordBlocked(d: Deps, symbol: string, hs: Hit[], why: string) {
  const day = nyDate(d.now());
  for (const h of hs) {
    await run(d.db, "UPDATE prepared SET state_reason=? WHERE id=? AND state='active'", why, h.row.id);
    await insertIgnore(d.db, "signals", { id: `blk|${h.row.id}|${day}`, symbol, setups: JSON.stringify([h.p.setup]), signal_time: h.signalTime, status: "blocked", status_reason: why,
      trigger_price: h.trigger, stop_price: h.stop, ctx: "{}", mode: d.cfg.mode, feed: d.cfg.feed, created_at: d.now() });
  }
}

/** Erzeugt Signal, prüft Kurs und legt Mail an. Idempotent über die deterministische Signal-ID. */
export async function fireSignal(d: Deps, symbol: string, hs: Hit[], snap: Snapshot | undefined, checkedAt: number, open: OpenPosition[], qqq: ReturnType<typeof qqqDecision>, sessionOpen: number): Promise<"confirmed" | "missed" | "no_capacity" | "unverifiable" | "duplicate"> {
  const cfg = d.cfg;
  const ids = hs.map((h) => h.row.id).sort();
  const sigId = `sig|${ids.join("+")}`;
  const setups = hs.map((h) => h.p.setup) as SetupId[];
  const trigger = Math.min(...hs.map((h) => h.trigger));
  const stop = Math.max(...hs.map((h) => h.stop)); // enger gemeinsamer Stopp, alle Setups werden genannt
  const quote = bestQuote(snap, checkedAt, cfg.maxQuoteAgeSec * 1000);
  const check = checkEntry(cfg, trigger, stop, quote, checkedAt);
  const signalTime = Math.max(...hs.map((h) => h.signalTime));
  const base = { id: sigId, symbol, setups: JSON.stringify(setups), signal_time: signalTime, trigger_price: trigger, stop_price: stop,
    observed_price: check.observed, quote_time: check.quoteTime, checked_at: checkedAt, ctx: "{}", mode: cfg.mode, feed: cfg.feed, created_at: checkedAt };
  const mark = async (state: string, reason: string | null) => { for (const h of hs) await run(d.db, "UPDATE prepared SET state=?, state_reason=?, signal_id=? WHERE id=?", state, reason, sigId, h.row.id); };

  if (check.status === "no_quote" || check.status === "stale_quote" || check.status === "below_trigger") {
    // Daten-/Kursproblem: kein Signal. Kandidat bleibt aktiv, wird aber nach 3 Fehlversuchen aufgegeben.
    for (const h of hs) {
      const p = h.p; const n = ((p.extra?.attempts as number) ?? 0) + 1;
      p.extra = { ...(p.extra ?? {}), attempts: n, lastReason: check.reason };
      if (check.status !== "below_trigger" && n >= 3) await run(d.db, "UPDATE prepared SET state='unverifiable', state_reason=?, data=? WHERE id=?", check.reason, JSON.stringify(p), h.row.id);
      else await run(d.db, "UPDATE prepared SET data=? WHERE id=?", JSON.stringify(p), h.row.id);
    }
    return "unverifiable";
  }
  if (check.status === "invalid_stop") { await mark("invalid", check.reason); return "unverifiable"; }

  const isNew = await insertIgnore(d.db, "signals", { ...base, status: check.status === "missed" ? "missed" : "pending_eval", status_reason: check.reason || null });
  if (!isNew) return "duplicate";

  if (check.status === "missed") {
    await mark("missed", check.reason);
    if (cfg.mailMissed) {
      const m = missedMail(cfg, symbol, setups, trigger, stop, check, signalTime);
      await enqueue(d, { id: `mail|${sigId}`, kind: "missed", subject: m.subject, text: m.text, sendBy: checkedAt + cfg.entryMailMaxAgeMin * MIN, signalId: sigId });
    }
    return "missed";
  }
  // bestätigt: Größe mit dem frischen Kurs neu berechnen
  const size = sizePosition(cfg, check.observed!, stop, open);
  if (size.shares < 1) {
    await run(d.db, "UPDATE signals SET status='no_capacity', status_reason=? WHERE id=?", size.note, sigId);
    await mark("no_capacity", size.note);
    return "no_capacity";
  }
  const [sp, growth] = await Promise.all([spContext(d), growthFor(d, symbol)]);
  const ctx = { sp, qqq, growth, size, reasons: hs.map((h) => h.reasons), prepared: hs.map((h) => h.p) };
  const link = cfg.baseUrl ? `${cfg.baseUrl}/a/${await createToken(d.db, d.pepper, sigId, "buy", 3 * 86_400_000, checkedAt)}` : null;
  const m = entryMail(cfg, { symbol, setups, signalTime, trigger, stop, check, size, reasons: hs.flatMap((h) => h.reasons), sp, qqq, growth, prepared: hs.map((h) => h.p), link, feedUsed: feedText(cfg) });
  await run(d.db, "UPDATE signals SET status='confirmed', ctx=?, shares=?, planned_risk_usd=?, outbox_id=? WHERE id=?", JSON.stringify(ctx), size.shares, size.plannedRiskUsd, `mail|${sigId}`, sigId);
  await insertIgnore(d.db, "positions", { id: `pos|${sigId}`, signal_id: sigId, symbol, status: "pending", initial_stop: stop, stop, shares: size.shares, entry: check.observed, fees: 0, created_at: checkedAt });
  await mark("fired", null);
  if (cfg.mailEntry) await enqueue(d, { id: `mail|${sigId}`, kind: "entry", subject: m.subject, text: m.text, sendBy: checkedAt + cfg.entryMailMaxAgeMin * MIN, signalId: sigId });
  return "confirmed";
}

async function episodicTrigger(d: Deps, row: any, bars5: ReturnType<typeof toBars>, s: { open: number; close: number }, now: number, lag: number): Promise<Hit | null> {
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
  return { row, p: { ...p, trigger: first.c, stop }, reasons, stop, trigger: first.c, signalTime: first.lastEnd };
}
const nyHM = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
export { SETUP_LABEL, one, previousSession, ms };
