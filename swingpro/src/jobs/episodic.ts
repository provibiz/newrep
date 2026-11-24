/**
 * Episodic Pivot (nur Quartalszahlen als Katalysator). Entdeckung nach der Eröffnung per Snapshot-Gap;
 * der Auslöser ist ausdrücklich der Schluss der ersten Handelsstunde und wird in intraday.ts geprüft.
 */
import type { Deps } from "../deps";
import { all, getMeta, setMeta, insertIgnore } from "../store";
import { MIN, HOUR, iso, nyDate } from "../time";
import { previousSession } from "../calendar";
import { catalystKnown } from "../catalyst";
import { stopBelow } from "../patterns";
import type { Prepared } from "../types";
import { notifyPrewarn } from "./prewarn";

export const EP_MIN_GAP_PCT = 8;

export async function episodicStage(d: Deps, s: { open: number; close: number }) {
  const now = d.now(), day = nyDate(now);
  if (await getMeta(d.db, `ep:${day}`)) return;
  if (now < s.open + 6 * MIN + d.cfg.barLagSec * 1000) return;
  if (now > s.open + 50 * MIN) { await setMeta(d.db, `ep:${day}`, { skipped: "Fenster verpasst" }, now); return; }
  if (!d.fmp) { await setMeta(d.db, `ep:${day}`, { skipped: "FMP_API_KEY fehlt – Episodic Pivot nicht möglich" }, now); return; }
  const watch = (await all<{ symbol: string }>(d.db, "SELECT symbol FROM metrics WHERE passed=1")).map((x) => x.symbol);
  const gappers: { symbol: string; gapPct: number; prevClose: number; open: number; low: number }[] = [];
  for (let i = 0; i < watch.length; i += 200) {
    const snaps = await d.alpaca.snapshots(watch.slice(i, i + 200), d.cfg.feed);
    for (const [symbol, sn] of snaps) {
      if (!sn.dailyBar || !sn.prevDailyBar || nyDate(Date.parse(sn.dailyBar.t) + 6 * HOUR) !== day) continue;
      const gap = (sn.dailyBar.o / sn.prevDailyBar.c - 1) * 100;
      if (gap >= EP_MIN_GAP_PCT) gappers.push({ symbol, gapPct: gap, prevClose: sn.prevDailyBar.c, open: sn.dailyBar.o, low: sn.dailyBar.l });
    }
  }
  const stats = { gappers: gappers.length, withCatalyst: 0, rejected: [] as string[] };
  if (gappers.length) {
    const cal = await d.fmp.earningsCalendar(previousSession(day), day, now);
    for (const g of gappers) {
      const c = catalystKnown(cal.get(g.symbol), day, now);
      if (!c.ok) { stats.rejected.push(`${g.symbol}: ${c.reason}`); continue; }
      stats.withCatalyst++;
      const p: Prepared = {
        setup: "episodic_pivot", timeframe: "1h", armedAt: s.open, trigger: g.open, stop: stopBelow(g.low), invalidateBelow: g.low, ttlBars: 2, needsHourClose: true,
        conditions: [`Gap ${g.gapPct.toFixed(1)} % (Eröffnung ${g.open.toFixed(2)} vs. Vortagesschluss ${g.prevClose.toFixed(2)}) mit Katalysator Quartalszahlen: ${c.evidence}`],
        pending: ["Schluss der ersten Handelsstunde ≥ Eröffnung", "Volumen der ersten Stunde ≥ doppeltes Median der letzten 5–10 Eröffnungsstunden"],
        extra: { gapPct: g.gapPct, prevClose: g.prevClose, catalyst: c.evidence },
      };
      await insertIgnore(d.db, "prepared", { id: `${g.symbol}|episodic_pivot|1h|${s.open}`, symbol: g.symbol, setup: "episodic_pivot", timeframe: "1h", armed_at: s.open,
        expires_at: s.open + 2 * HOUR, trigger_price: p.trigger, stop_price: p.stop, state: "active", data: JSON.stringify(p), created_at: now });
    }
  }
  await setMeta(d.db, `ep:${day}`, { at: iso(now), ...stats }, now);
  await notifyPrewarn(d, `ep:${day}`);
}
