import type { Deps } from "../deps";
import { all, run, one, batchRun } from "../store";
import { enqueue } from "../outbox";
import { prewarnMail, type PrewarnItem } from "../mail";
import type { Prepared, SetupId, Bar } from "../types";
import { loadSeries } from "../series";
import { qqqDecision } from "../market";

export const preparedId = (symbol: string, p: Prepared) => `${symbol}|${p.setup}|${p.timeframe}|${p.armedAt}`;

/** Gleicher Ausbruch läuft noch: letzter Signal-Auslöser wurde seither nie per Stundenschluss unterschritten. */
export async function isSameBreakout(d: Deps, symbol: string, hourly: Bar[]): Promise<boolean> {
  const sig = await one<{ signal_time: number; trigger_price: number }>(d.db,
    "SELECT signal_time, trigger_price FROM signals WHERE symbol=? AND status IN ('confirmed','missed') ORDER BY signal_time DESC LIMIT 1", symbol);
  if (!sig) return false;
  const since = hourly.filter((b) => b.end > sig.signal_time);
  if (d.now() - sig.signal_time > 7 * 86_400_000) return false;
  return since.every((b) => b.c >= sig.trigger_price);
}

/** Eine Sammelmail für alle noch nicht gemeldeten vorbereiteten Setups. */
export async function notifyPrewarn(d: Deps, key: string): Promise<number> {
  const rows = await all<any>(d.db, "SELECT * FROM prepared WHERE state='active' AND prewarn_outbox_id IS NULL AND expires_at > ? ORDER BY created_at", d.now());
  if (!rows.length) return 0;
  const qqq = qqqDecision(d.cfg, await loadSeries(d.db, "QQQ", "1h"));
  const metrics = new Map((await all<any>(d.db, "SELECT symbol, rs_pct FROM metrics WHERE passed=1")).map((m) => [m.symbol, m.rs_pct as number]));
  const bySym = new Map<string, PrewarnItem>();
  for (const r of rows) {
    const p: Prepared = JSON.parse(r.data);
    if (qqq.blocked.includes(p.setup as SetupId)) continue;
    const it: PrewarnItem = bySym.get(r.symbol) ?? { symbol: r.symbol, prepared: [], rsPct: metrics.get(r.symbol), expiresAt: r.expires_at };
    it.prepared.push(p); it.expiresAt = Math.max(it.expiresAt, r.expires_at);
    bySym.set(r.symbol, it);
  }
  const items = [...bySym.values()].sort((a, b) => (b.rsPct ?? 0) - (a.rsPct ?? 0)).slice(0, 15);
  const id = `prewarn:${key}`;
  if (d.cfg.mailPrewarn && items.length) {
    const m = prewarnMail(d.cfg, items, d.now());
    await enqueue(d, { id, kind: "prewarn", subject: m.subject, text: m.text, sendBy: d.now() + 30 * 60_000 });
  }
  await batchRun(d.db, rows.map((r) => ({ sql: "UPDATE prepared SET prewarn_outbox_id=? WHERE id=? AND prewarn_outbox_id IS NULL", args: [d.cfg.mailPrewarn ? id : "off", r.id] })), 40);
  return items.length;
}

/** Dieselbe Struktur wird Stunde für Stunde neu erkannt: gibt es schon ein aktives Setup mit fast gleichem Auslöser, entsteht keine zweite Vorwarnung. */
export async function similarActive(d: Deps, symbol: string, setup: string, tf: string, trigger: number): Promise<boolean> {
  const r = await all<{ trigger_price: number }>(d.db, "SELECT trigger_price FROM prepared WHERE symbol=? AND setup=? AND timeframe=? AND state IN ('active','fired')", symbol, setup, tf);
  return r.some((x) => Math.abs(x.trigger_price / trigger - 1) <= 0.01);
}

/**
 * Sammelt neu erkannte Setups eines Laufs im Speicher und schreibt sie gebündelt (D1 zählt jede Abfrage als Subrequest).
 * Entscheidet vorab über „gleicher Ausbruch läuft noch“ und „ähnliches Setup schon aktiv“.
 */
export class PreparedBook {
  private active: { symbol: string; setup: string; tf: string; trigger: number }[] = [];
  private lastSig = new Map<string, { signal_time: number; trigger_price: number }>();
  private ids = new Set<string>();
  private stmts: { sql: string; args: unknown[] }[] = [];
  stats = { added: 0, suppressed: 0 };
  constructor(private d: Deps) {}
  async load() {
    const d = this.d;
    this.active = (await all<any>(d.db, "SELECT symbol, setup, timeframe tf, trigger_price trigger FROM prepared WHERE state IN ('active','fired')"));
    for (const r of await all<any>(d.db, "SELECT symbol, signal_time, trigger_price FROM signals WHERE status IN ('confirmed','missed') AND signal_time > ? ORDER BY signal_time", d.now() - 7 * 86_400_000)) this.lastSig.set(r.symbol, r);
    for (const r of await all<{ id: string }>(d.db, "SELECT id FROM prepared WHERE armed_at > ?", d.now() - 4 * 86_400_000)) this.ids.add(r.id);
  }
  add(symbol: string, hourly: Bar[], preps: Prepared[], expiresAt: (p: Prepared) => number, _daily = false) {
    if (!preps.length) return;
    const sig = this.lastSig.get(symbol);
    const same = !!sig && hourly.filter((b) => b.end > sig.signal_time).every((b) => b.c >= sig.trigger_price);
    for (const p of preps) {
      const id = preparedId(symbol, p);
      if (this.ids.has(id)) continue;
      const similar = this.active.some((a) => a.symbol === symbol && a.setup === p.setup && a.tf === p.timeframe && Math.abs(a.trigger / p.trigger - 1) <= 0.01);
      if (!same && p.refresh) {
        // wandernde Level (z. B. EMA): bestehende aktive Vorbereitung aktualisieren statt neue anlegen
        const hasActive = this.active.some((a) => a.symbol === symbol && a.setup === p.setup && a.tf === p.timeframe);
        if (hasActive) {
          this.stmts.push({ sql: "UPDATE prepared SET trigger_price=?, stop_price=?, data=?, armed_at=?, expires_at=? WHERE symbol=? AND setup=? AND timeframe=? AND state='active'", args: [p.trigger, p.stop, JSON.stringify(p), p.armedAt, expiresAt(p), symbol, p.setup, p.timeframe] });
          continue;
        }
      }
      if (!same && similar) continue;
      this.ids.add(id);
      same ? this.stats.suppressed++ : this.stats.added++;
      if (!same) this.active.push({ symbol, setup: p.setup, tf: p.timeframe, trigger: p.trigger });
      this.stmts.push({ sql: "INSERT OR IGNORE INTO prepared (id,symbol,setup,timeframe,armed_at,expires_at,trigger_price,stop_price,state,state_reason,data,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [id, symbol, p.setup, p.timeframe, p.armedAt, expiresAt(p), p.trigger, p.stop, same ? "suppressed" : "active", same ? "gleicher Ausbruch läuft noch" : null, JSON.stringify(p), this.d.now()] });
    }
  }
  async flush() { await batchRun(this.d.db, this.stmts, 40); this.stmts = []; }
}
