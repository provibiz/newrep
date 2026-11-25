/**
 * Vom erreichten Trigger zur Mail. Drei getrennte Entscheidungen:
 *  1. Setup vorbereitet (prepared) – schon früher gefallen.
 *  2. Technischer Trigger erreicht – abgeschlossene Kerze über dem Auslöser.
 *  3. Einstieg nach den konfigurierten Markt- und Risikoregeln zulässig – hier entschieden (permission.ts, Kursprüfung, Größe).
 * Ist 3 „nein“, entsteht eine „Nur beobachten“-Mail ohne Kauf-Link und ohne Positionsvorschlag.
 */
import type { Deps } from "../deps";
import { run, insertIgnore, getMeta } from "../store";
import { MIN, nyDate } from "../time";
import { bestQuote, type Snapshot } from "../providers";
import { SETUP_LABEL, type Prepared, type SetupId } from "../types";
import { checkEntry } from "../entry";
import { sizePosition, type OpenPosition } from "../sizing";
import { entryMail, missedMail, watchMail, feedText } from "../mail";
import { enqueue } from "../outbox";
import { createToken } from "../tokens";
import type { QqqDecision } from "../market";
import { spContext, growthFor } from "./context";
import { decidePermission, getStance, type Permission } from "../permission";
import type { Regime } from "../regime";

export type Hit = { row: any; p: Prepared; reasons: string[]; stop: number; trigger: number; signalTime: number };
export type SignalOutcome = "confirmed" | "missed" | "watch_only" | "unverifiable" | "duplicate";

const originOf = (hs: Hit[]) => (hs.every((h) => h.row.origin === "idea") ? "idea" : "model") as "model" | "idea";
const sourceOf = (hs: Hit[]) => hs.find((h) => h.row.source)?.row.source as string | undefined;

export async function regimeLines(d: Deps): Promise<string[]> {
  const r = await getMeta<Regime>(d.db, "regime");
  return r?.text ?? ["Marktlage: noch nicht bewertet (Tageslauf fehlt)"];
}

/** Trigger erreicht, Einstieg nicht zulässig: protokollieren und einmal je Tag „Nur beobachten“ melden. */
export async function watchOnly(d: Deps, symbol: string, hs: Hit[], perm: Permission, extraReasons: string[], snap: Snapshot | undefined, checkedAt: number, qqq: QqqDecision): Promise<SignalOutcome> {
  const cfg = d.cfg, day = nyDate(checkedAt);
  const ids = hs.map((h) => h.row.id).sort();
  const sigId = `watch|${ids.join("+")}|${day}`;
  const reasons = [...new Set([...perm.blocked.map((b) => b.reason), ...extraReasons])];
  const currency = hs[0].p.currency ?? "USD";
  const trigger = Math.min(...hs.map((h) => h.trigger)), stop = Math.max(...hs.map((h) => h.stop));
  const quote = currency === "USD" ? bestQuote(snap, checkedAt, cfg.maxQuoteAgeSec * 1000) : null;
  const check = checkEntry(cfg, trigger, stop, quote, checkedAt, currency);
  const signalTime = Math.max(...hs.map((h) => h.signalTime));
  const preparedAt = Math.min(...hs.map((h) => h.row.created_at));
  const isNew = await insertIgnore(d.db, "signals", {
    id: sigId, symbol, setups: JSON.stringify(hs.map((h) => h.p.setup)), signal_time: signalTime, status: "watch_only", status_reason: reasons.join(" | "),
    trigger_price: trigger, stop_price: stop, observed_price: check.observed, quote_time: check.quoteTime, checked_at: checkedAt, ctx: JSON.stringify({ stance: perm.stanceText, qqq: qqq.text }),
    mode: cfg.mode, feed: cfg.feed, created_at: checkedAt, permission: "watch_only", permission_reasons: JSON.stringify(reasons), prepared_at: preparedAt, origin: originOf(hs),
  });
  if (!isNew) return "duplicate";
  for (const h of hs) await run(d.db, "UPDATE prepared SET state_reason=? WHERE id=? AND state='active'", reasons[0].slice(0, 300), h.row.id);
  if (cfg.mailWatch) {
    const m = watchMail(cfg, { symbol, setups: hs.map((h) => h.p.setup), signalTime, preparedAt, trigger, stop, currency, check: check.observed ? check : null, reasons, regime: await regimeLines(d), stance: perm.stanceText, qqqText: qqq.text, prepared: hs.map((h) => h.p), origin: originOf(hs), source: sourceOf(hs) });
    await enqueue(d, { id: `mail|${sigId}`, kind: "watch", subject: m.subject, text: m.text, sendBy: checkedAt + cfg.entryMailMaxAgeMin * MIN, signalId: sigId });
  }
  return "watch_only";
}

/** Erzeugt Signal, prüft Kurs und legt Mail an. Idempotent über die deterministische Signal-ID. */
export async function fireSignal(d: Deps, symbol: string, hs: Hit[], snap: Snapshot | undefined, checkedAt: number, open: OpenPosition[], qqq: QqqDecision, perm: Permission): Promise<SignalOutcome> {
  const cfg = d.cfg;
  const ids = hs.map((h) => h.row.id).sort();
  const sigId = `sig|${ids.join("+")}`;
  const setups = hs.map((h) => h.p.setup) as SetupId[];
  const trigger = Math.min(...hs.map((h) => h.trigger));
  const stop = Math.max(...hs.map((h) => h.stop)); // enger gemeinsamer Stopp, alle Setups werden genannt
  const currency = hs[0].p.currency ?? "USD";
  const quote = currency === "USD" ? bestQuote(snap, checkedAt, cfg.maxQuoteAgeSec * 1000) : null;   // nie ein Kurs aus einem anderen Markt/einer anderen Währung
  const check = checkEntry(cfg, trigger, stop, quote, checkedAt, currency);
  const signalTime = Math.max(...hs.map((h) => h.signalTime));
  const preparedAt = Math.min(...hs.map((h) => h.row.created_at));
  const origin = originOf(hs), source = sourceOf(hs);
  const base = { id: sigId, symbol, setups: JSON.stringify(setups), signal_time: signalTime, trigger_price: trigger, stop_price: stop,
    observed_price: check.observed, quote_time: check.quoteTime, checked_at: checkedAt, ctx: "{}", mode: cfg.mode, feed: cfg.feed, created_at: checkedAt, prepared_at: preparedAt, origin };
  const mark = async (state: string, reason: string | null) => { for (const h of hs) await run(d.db, "UPDATE prepared SET state=?, state_reason=?, signal_id=? WHERE id=?", state, reason, sigId, h.row.id); };

  if (check.status === "no_quote" || check.status === "stale_quote" || check.status === "below_trigger" || check.status === "currency_mismatch") {
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
  // Größe mit dem frischen Kurs neu berechnen (in der Marktvorgabe „selektiv“ mit deren Gewichtsgrenze)
  const size = sizePosition(cfg, check.observed!, stop, open, perm.weightCapPct ? { maxWeightPercent: perm.weightCapPct } : undefined);
  if (size.shares < 1) {
    // Kapazität/Risiko lässt keinen Einstieg zu: ebenfalls „Nur beobachten“, mit Grund
    await run(d.db, "DELETE FROM signals WHERE id=?", sigId);
    const out = await watchOnly(d, symbol, hs, { ...perm, blocked: [{ setup: setups[0], reason: `Risiko-/Kapitalregeln: ${size.note}` }] }, [], snap, checkedAt, qqq);
    return out === "duplicate" ? "duplicate" : "watch_only";
  }
  const [sp, growth, regime] = await Promise.all([spContext(d), growthFor(d, symbol), regimeLines(d)]);
  const ctx = { sp, qqq, growth, size, regime, stance: perm.stanceText, reasons: hs.map((h) => h.reasons), prepared: hs.map((h) => h.p) };
  const link = cfg.baseUrl ? `${cfg.baseUrl}/a/${await createToken(d.db, d.pepper, sigId, "buy", 3 * 86_400_000, checkedAt)}` : null;
  const m = entryMail(cfg, { symbol, setups, signalTime, trigger, stop, check, size, reasons: hs.flatMap((h) => h.reasons), sp, qqq, growth, prepared: hs.map((h) => h.p), link, feedUsed: feedText(cfg),
    regime, stance: perm.stanceText, preparedAt, origin, source });
  await run(d.db, "UPDATE signals SET status='confirmed', permission='permitted', permission_reasons=?, ctx=?, shares=?, planned_risk_usd=?, outbox_id=? WHERE id=?", JSON.stringify([perm.stanceText]), JSON.stringify(ctx), size.shares, size.plannedRiskUsd, `mail|${sigId}`, sigId);
  await insertIgnore(d.db, "positions", { id: `pos|${sigId}`, signal_id: sigId, symbol, status: "pending", initial_stop: stop, stop, shares: size.shares, entry: check.observed, fees: 0, created_at: checkedAt });
  await mark("fired", null);
  if (cfg.mailEntry) await enqueue(d, { id: `mail|${sigId}`, kind: "entry", subject: m.subject, text: m.text, sendBy: checkedAt + cfg.entryMailMaxAgeMin * MIN, signalId: sigId });
  return "confirmed";
}
export { SETUP_LABEL, getStance, decidePermission };
