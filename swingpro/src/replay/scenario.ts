/**
 * TESTDATEN – erfundene Kurse zur Funktionsprüfung (Replay). Sie belegen keine Handelsqualität.
 * Szenario: DEMO bildet eine Stundenbasis (Base Breakout) und bricht am 24.11.2026 gegen 11:00 New York aus.
 * GAPR springt nach Quartalszahlen und bestätigt die erste Handelsstunde (Episodic Pivot).
 */
import { FakeAlpaca, hourEnds, hourlyToRaw30, series as mkSeries } from "./fakes";
import type { Bar } from "../types";
import { HOUR, MIN, iso, nyToUtc } from "../time";
import { sessionFor, previousSession } from "../calendar";
import type { RawBar } from "../providers";

export const T = {
  daily: Date.parse("2026-11-23T22:10:00Z"),   // 17:10 New York, nach Handelsschluss
  hourly: Date.parse("2026-11-24T15:36:00Z"),  // 10:36 New York, Stundenkerze 09:30–10:30 abgeschlossen
  intraday: Date.parse("2026-11-24T16:06:00Z"),// 11:06 New York
  boundary: Date.parse("2026-11-24T15:30:00Z"),
};

const raw = (t: number, o: number, h: number, l: number, c: number, v: number): RawBar => ({ t: iso(t), o, h, l, c, v });

export function hourlyBars(kind: "base" | "up" | "flat", end: number, n = 70, level = 100): Bar[] {
  const ends = hourEnds(end, n);
  return ends.map((e, i) => {
    const k = n - i;                        // 1 = letzte Kerze
    let o: number, c: number, h: number, l: number;
    if (kind === "up") { c = 400 + (i * 40) / n; o = c - 0.3; h = c + 0.5; l = o - 0.4; }
    else if (kind === "flat") { c = level + (i % 2) * 0.1; o = level; h = level + 0.4; l = level - 0.4; }
    else if (k > 8) { c = 80 + ((level - 80) * i) / (n - 9); o = c - 0.1; h = c + 0.2; l = o - 0.15; }   // Anstieg bis 100
    else { const j = 8 - k; o = 101.5; c = 101.5 + 0.2 * (j % 3); h = 102.1 + 0.1 * (j % 2); l = 100.9; } // Basis
    return { end: e, o, h, l, c, v: k > 8 ? 900 : 1000 };
  });
}

export function dailyRaw(symbol: string, last: string, n: number, from: number, to: number, vol = 2_000_000): RawBar[] {
  const out: RawBar[] = []; let d = last; const days: string[] = [];
  while (days.length < n) { days.unshift(d); d = previousSession(d); }
  days.forEach((day, i) => {
    const c = from + ((to - from) * i) / (n - 1), [y, m, dd] = day.split("-").map(Number);
    out.push(raw(nyToUtc(y, m, dd, 0, 0), c - 0.2, c * 1.015, c * 0.985, c, vol));
  });
  return out;
}

/** 5-Minuten-Kerzen: Preise je Kerze aus einer Funktion. */
export function five(from: number, to: number, px: (k: number, start: number) => number, vol: (k: number) => number): RawBar[] {
  const out: RawBar[] = [];
  for (let t = from, k = 0; t < to; t += 5 * MIN, k++) { const c = px(k, t), o = k ? px(k - 1, t - 5 * MIN) : c; out.push(raw(t, o, Math.max(o, c) + 0.05, Math.min(o, c) - 0.05, c, vol(k))); }
  return out;
}

export function buildScenario(): { alpaca: FakeAlpaca; trigger: number } {
  const a = new FakeAlpaca();
  const demo = hourlyBars("base", T.boundary), qqq = hourlyBars("up", T.boundary);
  a.raw30.set("DEMO", hourlyToRaw30(demo)); a.raw30.set("QQQ", hourlyToRaw30(qqq));
  a.rawD.set("DEMO", dailyRaw("DEMO", "2026-11-23", 140, 60, 101));
  a.assetList = [
    { id: "id-demo", symbol: "DEMO", name: "Demo Corp. Common Stock", exchange: "NASDAQ", status: "active", tradable: true, class: "us_equity" },
    { id: "id-spy", symbol: "SPY", name: "SPDR S&P 500 ETF Trust", exchange: "NYSE", status: "active", tradable: true, class: "us_equity" },
    { id: "id-wrnt", symbol: "ABCDW", name: "Foo Warrants", exchange: "NASDAQ", status: "active", tradable: true, class: "us_equity" },
  ];
  const trigger = Math.max(...demo.slice(-8).map((b) => b.h));
  const s = sessionFor("2026-11-24")!;
  // 10:30–11:05: ruhig unter dem Auslöser, Kerze 11:00–11:05 schließt darüber
  a.raw5.set("DEMO", five(s.open + HOUR, s.open + HOUR + 35 * MIN, (k) => (k < 6 ? 101.7 + 0.05 * k : trigger + 0.15), () => 130));
  a.snaps.set("DEMO", { latestQuote: { t: iso(T.intraday - 5000), ap: trigger + 0.2, bp: trigger + 0.15 }, latestTrade: { t: iso(T.intraday - 4000), p: trigger + 0.17 }, dailyBar: raw(nyToUtc(2026, 11, 24, 0, 0), 101.5, trigger + 0.3, 100.9, trigger + 0.17, 5000) });
  return { alpaca: a, trigger };
}
export { mkSeries };
