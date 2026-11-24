/** Datenanbieter (Alpaca, FMP, FRED) und Resend. Alle Netzwerkaufrufe gehen über eine injizierbare fetch-Funktion. */
import type { Bar } from "./types";
import { HOUR, MIN, iso, nyDate } from "./time";
import { sessionFor } from "./calendar";
import { scrub } from "./store";
import type { EarningsEvent } from "./catalyst";
import type { IncomeRow } from "./growth";
import type { Quote } from "./entry";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(public status: number, public host: string, msg: string, public retryAfter?: number) { super(`${host} HTTP ${status}: ${scrub(msg).slice(0, 200)}`); this.name = "HttpError"; }
}
async function getJson(f: Fetch, url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await f(url, { headers: { "User-Agent": "SwingPro/1.0", ...headers } });
  if (!res.ok) throw new HttpError(res.status, new URL(url).host, await res.text().catch(() => ""), Number(res.headers.get("retry-after")) || undefined);
  return res.json();
}

// ───────────────────────── Alpaca ─────────────────────────
export interface RawBar { t: string; o: number; h: number; l: number; c: number; v: number }
export interface AssetRaw { id: string; symbol: string; name: string; exchange: string; status: string; tradable: boolean; class: string; attributes?: string[] }
export interface Snapshot {
  latestTrade?: { t: string; p: number }; latestQuote?: { t: string; ap: number; bp: number };
  dailyBar?: RawBar; prevDailyBar?: RawBar; minuteBar?: RawBar;
}
export type Feed = "iex" | "sip";

export class Alpaca {
  constructor(private f: Fetch, private id: string, private secret: string) {}
  private h() { return { "APCA-API-KEY-ID": this.id, "APCA-API-SECRET-KEY": this.secret }; }

  assets() {
    return getJson(this.f, "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity", this.h()) as Promise<AssetRaw[]>;
  }
  async clock(): Promise<{ is_open: boolean; timestamp: string; next_open: string; next_close: string }> {
    return getJson(this.f, "https://paper-api.alpaca.markets/v2/clock", this.h());
  }
  /** Mehrseitiger Bars-Abruf. maxPages schützt das Subrequest-Budget. */
  async bars(symbols: string[], timeframe: string, startIso: string, endIso: string, feed: Feed, maxPages = 20): Promise<{ bars: Map<string, RawBar[]>; pages: number; truncated: boolean }> {
    const out = new Map<string, RawBar[]>();
    let token: string | null = null, pages = 0;
    do {
      const q = new URLSearchParams({ symbols: symbols.join(","), timeframe, start: startIso, end: endIso, limit: "10000", adjustment: "split", feed, sort: "asc" });
      if (token) q.set("page_token", token);
      const body = await getJson(this.f, `https://data.alpaca.markets/v2/stocks/bars?${q}`, this.h());
      for (const [s, arr] of Object.entries(body.bars ?? {})) { const a = out.get(s) ?? []; a.push(...(arr as RawBar[])); out.set(s, a); }
      token = body.next_page_token ?? null; pages++;
    } while (token && pages < maxPages);
    return { bars: out, pages, truncated: !!token };
  }
  async snapshots(symbols: string[], feed: Feed): Promise<Map<string, Snapshot>> {
    const body = await getJson(this.f, `https://data.alpaca.markets/v2/stocks/snapshots?${new URLSearchParams({ symbols: symbols.join(","), feed })}`, this.h());
    return new Map(Object.entries((body.snapshots ?? body) as Record<string, Snapshot>));
  }
}

export const ms = (t: string) => Date.parse(t);

/** 5-Minuten-Rohkerzen -> Bar (end = Beginn + 5 min). */
export const toBars = (raw: RawBar[], lenMs: number): Bar[] => raw.map((r) => ({ end: ms(r.t) + lenMs, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));

/** Tageskerzen: Alpaca-Zeit = Mitternacht NY; end = regulärer Sitzungsschluss (13:00 bei verkürzten Tagen). */
export function dailyBars(raw: RawBar[]): Bar[] {
  const out: Bar[] = [];
  for (const r of raw) {
    const s = sessionFor(nyDate(ms(r.t) + 6 * HOUR));
    if (s) out.push({ end: s.close, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
  }
  return out.sort((a, b) => a.end - b.end);
}

/**
 * Zwei 30-Minuten-Kerzen -> Stundenkerze (09:30–10:30 …). Nur vollständige Paare, nur abgeschlossene Kerzen.
 * Die letzte halbe Stunde einer Sitzung (15:30–16:00) bleibt unberücksichtigt, wie im Original.
 */
export function buildHourly(raw30: RawBar[], now: number, lagMs: number): Bar[] {
  const byStart = new Map(raw30.map((r) => [ms(r.t), r]));
  const out: Bar[] = [];
  const days = new Set(raw30.map((r) => nyDate(ms(r.t))));
  for (const d of [...days].sort()) {
    const s = sessionFor(d);
    if (!s) continue;
    for (let st = s.open; st + HOUR <= s.close; st += HOUR) {
      const a = byStart.get(st), b = byStart.get(st + 30 * MIN);
      if (!a || !b || st + HOUR > now - lagMs) continue;
      out.push({ end: st + HOUR, o: a.o, h: Math.max(a.h, b.h), l: Math.min(a.l, b.l), c: b.c, v: a.v + b.v });
    }
  }
  return out;
}

/** Bester verfügbarer, frischer Preis: Ask der Quote, sonst letzter Trade. */
export function bestQuote(s: Snapshot | undefined, now: number, maxAgeMs: number): Quote | null {
  if (!s) return null;
  const cands: Quote[] = [];
  const q = s.latestQuote;
  if (q && q.ap > 0 && q.bp > 0 && q.ap >= q.bp && (q.ap - q.bp) / q.ap < 0.05) cands.push({ price: q.ap, time: ms(q.t), kind: "ask" });
  if (s.latestTrade && s.latestTrade.p > 0) cands.push({ price: s.latestTrade.p, time: ms(s.latestTrade.t), kind: "last" });
  const fresh = cands.filter((c) => now - c.time <= maxAgeMs);
  if (fresh.length) return fresh.sort((a, b) => (a.kind === "ask" ? -1 : 1) - (b.kind === "ask" ? -1 : 1))[0];
  return cands.sort((a, b) => b.time - a.time)[0] ?? null;
}

// ───────────────────────── FMP ─────────────────────────
export class Fmp {
  constructor(private f: Fetch, private key: string) {}
  private url(ep: string, p: Record<string, string>) { return `https://financialmodelingprep.com/stable/${ep}?${new URLSearchParams({ ...p, apikey: this.key })}`; }
  async income(symbol: string): Promise<IncomeRow[]> {
    const rows = await getJson(this.f, this.url("income-statement", { symbol, period: "quarter", limit: "8" }));
    if (!Array.isArray(rows)) throw new Error("FMP income-statement: unerwartetes Format");
    return rows;
  }
  /** Earnings-Kalender für ein Datumsfenster (ein Aufruf für alle Titel). */
  async earningsCalendar(from: string, to: string, fetchedAt: number): Promise<Map<string, EarningsEvent>> {
    const rows = await getJson(this.f, this.url("earnings-calendar", { from, to }));
    if (!Array.isArray(rows)) throw new Error("FMP earnings-calendar: unerwartetes Format");
    const m = new Map<string, EarningsEvent>();
    for (const r of rows) {
      if (!r.symbol || !r.date) continue;
      const eps = typeof r.epsActual === "number" ? r.epsActual : null;
      // Live: ein vorhandener Ist-Wert beim Abruf belegt, dass die Meldung vor fetchedAt öffentlich war.
      m.set(r.symbol, { symbol: r.symbol, date: r.date, epsActual: eps, timing: null, availableAt: eps !== null ? fetchedAt : null });
    }
    return m;
  }
}

// ───────────────────────── FRED ─────────────────────────
export async function fetchFredSp500(f: Fetch, from: string, to: string): Promise<string> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?${new URLSearchParams({ id: "SP500", cosd: from, coed: to })}`;
  const res = await f(url, { headers: { "User-Agent": "SwingPro/1.0" } });
  if (!res.ok) throw new HttpError(res.status, "fred.stlouisfed.org", "");
  return res.text();
}

// ───────────────────────── Resend ─────────────────────────
export interface MailMsg { id: string; from: string; to: string; subject: string; text: string; html?: string | null }
export async function sendResend(f: Fetch, apiKey: string, m: MailMsg): Promise<{ id: string }> {
  const res = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.id.slice(0, 256), "User-Agent": "SwingPro/1.0" },
    body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }),
  });
  if (!res.ok) throw new HttpError(res.status, "api.resend.com", await res.text().catch(() => ""), Number(res.headers.get("retry-after")) || undefined);
  const body: any = await res.json();
  if (!body?.id) throw new Error("Resend: keine Nachrichten-ID in der Antwort");
  return { id: String(body.id) };
}
export { iso };
