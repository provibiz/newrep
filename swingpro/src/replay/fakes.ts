/** TESTDATEN-Werkzeuge (Replay und Tests): Attrappen für Marktdaten, Mail und eine SQLite-Datenbank mit D1-Schnittstelle. Nie im Worker eingebunden. */
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Db, Stmt } from "../store";
import { loadConfig, type Config } from "../config";
import type { Deps } from "../deps";
import type { Bar } from "../types";
import { HOUR, MIN, nyToUtc, iso } from "../time";
import { sessionFor, hourlyBoundaries } from "../calendar";
import type { RawBar, Snapshot, AssetRaw } from "../providers";
import { HttpError } from "../providers";
import { usMarket, deMarket } from "../markets";
import { alpacaUsData } from "../usdata";
import { missingData, type MarketData, type AssetInfo, type QuoteInfo } from "../marketdata";
export { HttpError };

export function createDb(): Db {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(import.meta.dirname, "../../migrations")).sort()) sql.exec(readFileSync(join(import.meta.dirname, "../../migrations", f), "utf8"));
  const mk = (q: string, args: unknown[] = []): Stmt => ({
    bind: (...a: unknown[]) => mk(q, a),
    run: async () => { const r = sql.prepare(q).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
    first: async () => ((sql.prepare(q).get(...(args as any[])) as any) ?? null),
    all: async () => ({ results: sql.prepare(q).all(...(args as any[])) as any[] }),
  });
  return { prepare: (q: string) => mk(q), batch: async (ss: Stmt[]) => { const out = []; for (const s of ss) out.push(await s.run()); return out; } };
}

export const cfgOf = (over: Record<string, unknown> = {}): Config => loadConfig({ AUTO_STANCE: "false", MODE: "live", MAIL_FROM: "a@b.de", MAIL_TO: "c@d.de", BASE_URL: "https://x.example", CAPITAL: "10000", MIN_RS_PERCENTILE: "0", MIN_DOLLAR_VOLUME: "1000", MIN_PRICE: "1", MIN_HISTORY_DAYS: "70", ...over });

/** Deterministische Pseudo-Zufallszahlen */
export function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export const bar = (end: number, o: number, h: number, l: number, c: number, v = 1000): Bar => ({ end, o, h, l, c, v });
/** Reihe aus Schlusskursen; Hoch/Tief ±range% um Open/Close. */
export function series(closes: number[], opt: { range?: number; vol?: number; start?: number } = {}): Bar[] {
  const r = opt.range ?? 0.4, start = opt.start ?? 1_700_000_000_000;
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return bar(start + (i + 1) * HOUR, o, Math.max(o, c) * (1 + r / 100), Math.min(o, c) * (1 - r / 100), c, opt.vol ?? 1000);
  });
}

export class FakeMail {
  sent: any[] = []; fail: Error | null = null; keys = new Map<string, string>();
  send = async (m: any) => {
    if (this.fail) throw this.fail;
    if (this.keys.has(m.id)) return { id: this.keys.get(m.id)! };   // Anbieter-seitige Idempotenz
    const id = "msg_" + (this.sent.length + 1);
    this.keys.set(m.id, id); this.sent.push(m);
    return { id };
  };
}

/** Marktdaten-Attrappe: 30-Min-/5-Min-/Tageskerzen je Symbol, Snapshots je Symbol. */
export class FakeAlpaca {
  raw30 = new Map<string, RawBar[]>(); raw5 = new Map<string, RawBar[]>(); rawD = new Map<string, RawBar[]>();
  snaps = new Map<string, Snapshot>(); assetList: AssetRaw[] = []; open = true; calls: string[] = []; starts: string[] = [];
  forbiddenSip = false;
  async assets() { return this.assetList; }
  async clock() { return { is_open: this.open, timestamp: "", next_open: "", next_close: "" }; }
  async bars(symbols: string[], tf: string, start: string, end: string, feed: string) {
    this.calls.push(`${tf}:${symbols.length}:${feed}`); this.starts.push(`${tf}|${start}`);
    if (feed === "sip" && this.forbiddenSip && tf !== "1Day") throw new HttpError(403, "data.alpaca.markets", "subscription does not permit");
    const src = tf === "30Min" ? this.raw30 : tf === "5Min" ? this.raw5 : this.rawD;
    const out = new Map<string, RawBar[]>();
    const s = Date.parse(start.length === 10 ? start + "T00:00:00Z" : start), e = Date.parse(end.length === 10 ? end + "T23:59:59Z" : end);
    for (const sym of symbols) { const rows = (src.get(sym) ?? []).filter((b) => Date.parse(b.t) >= s && Date.parse(b.t) <= e); if (rows.length) out.set(sym, rows); }
    return { bars: out, pages: 1, truncated: false };
  }
  async snapshots(symbols: string[]) { return new Map(symbols.filter((s) => this.snaps.has(s)).map((s) => [s, this.snaps.get(s)!])); }
}

/** Erzeugt 30-Min-Rohkerzen aus Stundenkerzen (je Stunde zwei Hälften, erste mit Open/Hoch-Anteil). */
export function hourlyToRaw30(bars: Bar[]): RawBar[] {
  const out: RawBar[] = [];
  for (const b of bars) {
    const st = b.end - HOUR, mid = (b.o + b.c) / 2;
    out.push({ t: iso(st), o: b.o, h: Math.max(b.o, mid, b.h * 0.0 + Math.max(b.o, mid)), l: Math.min(b.o, mid), c: mid, v: b.v / 2 });
    out.push({ t: iso(st + 30 * MIN), o: mid, h: Math.max(mid, b.c), l: Math.min(mid, b.c), c: b.c, v: b.v / 2 });
    // Extremwerte der Stunde der zweiten Hälfte zuschlagen, damit Hoch/Tief der Stundenkerze erhalten bleiben
    const a = out[out.length - 2], z = out[out.length - 1];
    a.h = Math.max(a.h, b.h); z.l = Math.min(z.l, b.l);
  }
  return out;
}

/** Stundenraster der letzten n Handelsstunden bis einschließlich Grenze `lastEnd`. */
export function hourEnds(lastEnd: number, n: number): number[] {
  const out: number[] = [];
  let day = new Date(lastEnd).toISOString().slice(0, 10);
  const all: number[] = [];
  for (let i = 0; i < 40; i++) {
    const s = sessionFor(new Date(Date.parse(day + "T12:00:00Z") - i * 86_400_000).toISOString().slice(0, 10));
    if (s) all.unshift(...hourlyBoundaries(s));
  }
  const upto = all.filter((e) => e <= lastEnd);
  return upto.slice(-n).concat(out);
}

/** Xetra-Attrappe (TESTDATEN): Instrumente, Tages-/5-Minuten-Kerzen und Quotes in EUR. */
export class FakeDeData implements MarketData {
  id = "fake-xetr"; feedLabel = "Xetra-Attrappe (TESTDATEN, EUR)";
  assetList: AssetInfo[] = []; daily = new Map<string, Bar[]>(); five = new Map<string, Bar[]>(); quoteMap = new Map<string, QuoteInfo>(); calls: string[] = [];
  async assets() { this.calls.push("assets"); return this.assetList; }
  async dailyBars(keys: string[], startDate: string, endMs: number) {
    this.calls.push("daily:" + keys.length);
    const out = new Map<string, Bar[]>(); const s = Date.parse(startDate + "T00:00:00Z");
    for (const k of keys) { const b = (this.daily.get(k) ?? []).filter((x) => x.end >= s && x.end <= endMs); if (b.length) out.set(k, b); }
    return { bars: out, requests: 1 };
  }
  async bars5(keys: string[], startMs: number, endMs: number) {
    this.calls.push("bars5:" + keys.length);
    return new Map(keys.filter((k) => this.five.has(k)).map((k) => [k, this.five.get(k)!.filter((b) => b.end - 300_000 >= startMs && b.end - 300_000 <= endMs)]));
  }
  async quotes(keys: string[]) { return new Map(keys.map((k) => [k, this.quoteMap.get(k) ?? { quote: null, sessionOpen: null }])); }
}

export function makeDeps(db: Db, cfg: Config, now: number, o: { alpaca?: FakeAlpaca; mail?: FakeMail; fred?: string; fmp?: any; de?: MarketData; fetch?: any } = {}): Deps & { alpaca: FakeAlpaca; mail: FakeMail; clock: { t: number } } {
  const mail = o.mail ?? new FakeMail(), alpaca = o.alpaca ?? new FakeAlpaca(), clock = { t: now };
  return { db, cfg, now: () => clock.t, alpaca: alpaca as any, fmp: o.fmp ?? null, fred: async () => o.fred ?? "observation_date,SP500\n", sendMail: mail.send, markets: { US: usMarket(alpacaUsData(alpaca as any, cfg)), DE: deMarket(o.de ?? missingData({ what: "Xetra-Kursdaten", provider: "Twelve Data", plan: "Tarif mit Xetra-Intraday", detail: "Zugang fehlt (Test)" })) }, fetch: o.fetch ?? (async () => { throw new Error("kein Netzwerk im Test"); }), pepper: "pepper-test-pepper", checkClock: false, log: () => {}, mail, clock } as any;
}
export { nyToUtc };
