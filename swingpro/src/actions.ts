/** Ausdrücklich bestätigte Nutzeraktionen. Jede Zustandsänderung ist über idem_key idempotent. */
import type { Deps } from "./deps";
import { all, one, run, insertIgnore } from "./store";
import { fxRate } from "./config";

export class ActionError extends Error {}
const fin = (x: unknown, name: string, min = 0, strict = false): number => {
  const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
  if (!Number.isFinite(n) || (strict ? n <= min : n < min)) throw new ActionError(`${name} ist ungültig`);
  return n;
};
async function event(d: Deps, posId: string, type: string, data: unknown, idem: string): Promise<boolean> {
  return insertIgnore(d.db, "position_events", { position_id: posId, ts: d.now(), type, data: JSON.stringify(data), idem_key: idem });
}
export const getPosition = (d: Deps, id: string) => one<any>(d.db, "SELECT * FROM positions WHERE id=?", id);

export async function confirmBuy(d: Deps, posId: string, f: { price: unknown; shares: unknown; fees?: unknown; requestId: string }) {
  const p = await getPosition(d, posId);
  if (!p) throw new ActionError("Position nicht gefunden");
  if (p.status === "open") return { already: true, position: p };
  if (p.status !== "pending") throw new ActionError(`Position hat Status ${p.status}`);
  const price = fin(f.price, "Kaufkurs", 0, true), shares = Math.floor(fin(f.shares, "Stückzahl", 0, true)), fees = fin(f.fees ?? 0, "Gebühren");
  if (shares < 1) throw new ActionError("Stückzahl muss mindestens 1 sein");
  if (!(price > p.initial_stop)) throw new ActionError(`Kaufkurs liegt nicht über dem Stopp ${p.initial_stop} – 1R wäre nicht definiert`);
  if (!(await event(d, posId, "buy_confirmed", { price, shares, fees }, `buy:${posId}`))) return { already: true, position: await getPosition(d, posId) };
  // 1R = tatsächlicher Einstieg minus anfänglicher Stopp
  await run(d.db, "UPDATE positions SET status='open', entry=?, shares=?, fees=?, opened_at=?, stop=initial_stop WHERE id=? AND status='pending'", price, shares, fees, d.now(), posId);
  await run(d.db, "UPDATE signals SET status_reason=COALESCE(status_reason,'') || ' | Kauf bestätigt' WHERE id=?", p.signal_id);
  return { already: false, position: await getPosition(d, posId) };
}

export async function skipTrade(d: Deps, posId: string, requestId: string) {
  const p = await getPosition(d, posId);
  if (!p) throw new ActionError("Position nicht gefunden");
  if (p.status !== "pending") throw new ActionError("Nur ein noch nicht bestätigter Einstieg kann ausgelassen werden");
  await event(d, posId, "skipped", {}, `skip:${posId}`);
  await run(d.db, "UPDATE positions SET status='skipped', closed_at=? WHERE id=? AND status='pending'", d.now(), posId);
}

/** Verkauf (Teil oder Rest). Gemeldete Empfehlungen und tatsächliche Ausführungen sind getrennte Ereignisse. */
export async function recordSale(d: Deps, posId: string, f: { price: unknown; shares: unknown; fees?: unknown; kind: "partial" | "exit"; requestId: string; note?: string }) {
  const p = await getPosition(d, posId);
  if (!p || p.status !== "open") throw new ActionError("Keine offene Position");
  const price = fin(f.price, "Verkaufskurs", 0, true), fees = fin(f.fees ?? 0, "Gebühren");
  const left = p.shares - p.shares_sold;
  const shares = f.kind === "exit" && (f.shares === undefined || f.shares === "") ? left : Math.floor(fin(f.shares, "Stückzahl", 0, true));
  if (shares < 1 || shares > left) throw new ActionError(`Stückzahl muss zwischen 1 und ${left} liegen`);
  const idem = `sell:${posId}:${f.requestId}`;
  if (!(await event(d, posId, f.kind === "partial" ? "partial_executed" : "manual_exit", { price, shares, fees, note: f.note ?? null }, idem))) return { already: true, position: await getPosition(d, posId) };
  const pnl = (price - p.entry) * shares - fees;
  const sold = p.shares_sold + shares, closed = sold >= p.shares;
  await run(d.db, "UPDATE positions SET shares_sold=?, realized_pnl_usd=COALESCE(realized_pnl_usd,0)+?, status=?, closed_at=?, note=COALESCE(?, note) WHERE id=?",
    sold, pnl, closed ? "closed" : "open", closed ? d.now() : null, f.note ?? null, posId);
  return { already: false, position: await getPosition(d, posId) };
}

export async function positionSummary(d: Deps, posId: string) {
  const p = await getPosition(d, posId);
  if (!p) return null;
  const events = await all<any>(d.db, "SELECT ts,type,data FROM position_events WHERE position_id=? ORDER BY ts, id", posId);
  const r = p.entry && p.initial_stop ? p.entry - p.initial_stop : null;
  const entryFees = events.filter((e) => e.type === "buy_confirmed").map((e) => JSON.parse(e.data).fees).reduce((s: number, x: number) => s + x, 0);
  const pnlTotal = p.realized_pnl_usd === null ? null : p.realized_pnl_usd - entryFees;
  let pnlAccount: number | null = null;
  try { pnlAccount = pnlTotal === null ? null : pnlTotal * fxRate(d.cfg, p.currency ?? "USD", d.cfg.accountCurrency); } catch { pnlAccount = null; }   // ohne dokumentierten Kurs keine Umrechnung
  return { p, events, r, pnlTotal, pnlAccount, currency: p.currency ?? "USD" };
}
