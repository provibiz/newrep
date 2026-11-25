/**
 * Xetra (EUR) über Twelve Data. NICHT live verifiziert: Endpunkte und Felder entsprechen der öffentlichen API-Beschreibung, ob der gebuchte
 * Tarif Xetra-Intraday in Echtzeit liefert, prüft die Berechtigungsprobe (probe.ts). Laut Preisseite (Stand 25.11.2026): Grow = „EOD global equities“,
 * Pro = „Real-time EU market data“. Für den deutschen Vormittagsscan ist mindestens ein Tarif mit Echtzeit-/Intraday-Rechten für XETR nötig.
 * Kurse bleiben in EUR; ein US-Kurs ist nie Ersatz.
 */
import type { Fetch } from "./providers";
import { HttpError } from "./providers";
import type { Bar } from "./types";
import { MIN, zonedToUtc, parseDateKey } from "./time";
import { xetraSession } from "./markets";
import { type MarketData, type AssetInfo, type QuoteInfo, RateLimited } from "./marketdata";

const BASE = "https://api.twelvedata.com";
const mnemonic = (key: string) => key.replace(/^XETR:/, "");

function parseDt(s: string): number {                      // "YYYY-MM-DD HH:MM:SS" in Börsenzeit (Europe/Berlin) oder "YYYY-MM-DD"
  const [d, t = "00:00:00"] = s.split(" "); const { y, m, d: dd } = parseDateKey(d); const [h, mi] = t.split(":").map(Number);
  return zonedToUtc("Europe/Berlin", y, m, dd, h, mi);
}

export function twelveDataXetra(f: Fetch, apiKey: string, o: { maxQuoteAgeSec: number }): MarketData {
  const call = async (path: string, q: Record<string, string>) => {
    const url = `${BASE}/${path}?${new URLSearchParams({ ...q, apikey: apiKey })}`;
    const res = await f(url, { headers: { "User-Agent": "SwingPro/1.0" } });
    if (res.status === 429) throw new RateLimited();
    if (!res.ok) throw new HttpError(res.status, "api.twelvedata.com", "");
    const body: any = await res.json();
    if (body?.status === "error" || body?.code) {
      if (Number(body.code) === 429) throw new RateLimited();
      throw new HttpError(Number(body.code) || 400, "api.twelvedata.com", String(body.message ?? "Fehler").replace(apiKey, "***"));
    }
    return body;
  };
  /** Mehrere Symbole: Antwort ist ein Objekt je Symbol; bei einem Symbol direkt das Ergebnis. */
  const multi = (body: any, syms: string[]): Record<string, any> => (syms.length === 1 && body?.values ? { [syms[0]]: body } : body);
  const bars = (vals: any[], len: "day" | "5m"): Bar[] => vals.map((v) => {
    const start = parseDt(v.datetime);
    const dayClose = len === "day" ? xetraSession(String(v.datetime).slice(0, 10))?.close : undefined;
    return { end: len === "day" ? dayClose ?? start + 17.5 * 3_600_000 : start + 5 * MIN, o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +v.volume || 0 };
  }).filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite)).sort((a, b) => a.end - b.end);

  return {
    id: "twelvedata-xetr",
    feedLabel: "Twelve Data Xetra (EUR; Echtzeit nur mit passendem Tarif)",
    async assets() {
      const body = await call("stocks", { exchange: "XETR", mic_code: "XETR" });
      return (body.data ?? []).filter((r: any) => r.symbol).map((r: any): AssetInfo => ({ key: `XETR:${r.symbol}`, symbol: r.symbol, name: r.name ?? "", mic: "XETR", currency: r.currency ?? "EUR", isin: r.isin ?? null, type: r.type ?? null, raw: r }));
    },
    async dailyBars(keys, startDate) {
      const out = new Map<string, Bar[]>(); let requests = 0;
      for (let i = 0; i < keys.length; i += 40) {
        const part = keys.slice(i, i + 40).map(mnemonic);
        const body = multi(await call("time_series", { symbol: part.join(","), exchange: "XETR", mic_code: "XETR", interval: "1day", start_date: startDate, order: "asc", outputsize: "5000", timezone: "Europe/Berlin" }), part);
        requests++;
        for (const sym of part) { const r = body[sym]; if (r?.values?.length && r.status !== "error") out.set(`XETR:${sym}`, bars(r.values, "day")); }
      }
      return { bars: out, requests };
    },
    async bars5(keys, startMs) {
      const out = new Map<string, Bar[]>();
      for (let i = 0; i < keys.length; i += 40) {
        const part = keys.slice(i, i + 40).map(mnemonic);
        const start = new Date(startMs).toISOString().slice(0, 10) + " 00:00:00";
        const body = multi(await call("time_series", { symbol: part.join(","), exchange: "XETR", mic_code: "XETR", interval: "5min", start_date: start, order: "asc", outputsize: "5000", timezone: "Europe/Berlin" }), part);
        for (const sym of part) { const r = body[sym]; if (r?.values?.length && r.status !== "error") out.set(`XETR:${sym}`, bars(r.values, "5m").filter((b) => b.end - 5 * MIN >= startMs)); }
      }
      return out;
    },
    async quotes(keys, now) {
      const out = new Map<string, QuoteInfo>(); const part = keys.map(mnemonic);
      for (let i = 0; i < part.length; i += 40) {
        const sl = part.slice(i, i + 40);
        const body = multi(await call("quote", { symbol: sl.join(","), exchange: "XETR", mic_code: "XETR" }), sl);
        for (const sym of sl) {
          const r = body[sym]; if (!r || r.status === "error") continue;
          const t = r.timestamp ? Number(r.timestamp) * 1000 : parseDt(String(r.datetime));
          out.set(`XETR:${sym}`, { quote: +r.close > 0 && r.currency === "EUR" ? { price: +r.close, time: t, kind: "last", currency: "EUR" } : null, sessionOpen: +r.open > 0 ? +r.open : null });
        }
      }
      for (const k of keys) if (!out.has(k)) out.set(k, { quote: null, sessionOpen: null });
      void now; void o;
      return out;
    },
  };
}
