/**
 * TESTDATEN – historische Abnahmefälle aus dem TraderMacher-Report vom 25.11.2026 (Crocs, Sartorius, Illumina).
 * Die Kursmarken (Crocs 160 USD, Sartorius 298 EUR / 300 EUR, Illumina 200 USD, Schlusskurse 159,24 / 292,80 / 204,52) stehen
 * AUSSCHLIESSLICH hier. Die Kurse sind nachgebaut/erfunden, nur so geformt, dass die beschriebenen Formationen entstehen.
 * Sie belegen die Programmfunktion, keine Handelsqualität.
 */
import type { Bar } from "../../src/types";
import { sessionFor, previousSession } from "../../src/calendar";
import type { RawBar } from "../../src/providers";
import { iso, nyToUtc } from "../../src/time";
import type { EarningsEvent } from "../../src/catalyst";

export const LAST = "2026-11-24";
export const sessionsEnding = (last: string, n: number): string[] => { const out: string[] = []; let d = last; while (out.length < n) { out.unshift(d); d = previousSession(d); } return out; };
const bar = (date: string, o: number, h: number, l: number, c: number, v: number): Bar => ({ end: sessionFor(date)!.close, o, h, l, c, v });
const lerp = (a: number, b: number, i: number, n: number) => a + ((b - a) * i) / Math.max(1, n - 1);
/** ruhige Tageskerzen um einen Verlauf von Schlusskursen */
function fromCloses(dates: string[], closes: number[], vol = 1_000_000, rng = 0.8): Bar[] {
  return dates.map((d, i) => { const c = closes[i], o = i ? closes[i - 1] : c; return bar(d, o, Math.max(o, c) * (1 + rng / 100), Math.min(o, c) * (1 - rng / 100), c, vol); });
}
type OHLC = [number, number, number, number];
const explicit = (dates: string[], rows: OHLC[], vol = 1_000_000): Bar[] => dates.map((d, i) => bar(d, rows[i][0], rows[i][1], rows[i][2], rows[i][3], vol));

// ───────── Crocs (CROX, Nasdaq, USD): Quartalszahlen, Gap, Konsolidierung, Inside Day ─────────
export const CROX_GAP_DAY = "2026-11-03";
export const CROX_EVENT: EarningsEvent = { symbol: "CROX", date: "2026-11-02", epsActual: 3.1, timing: "amc", availableAt: null };  // Zahlen nach Börsenschluss am Vortag der Lücke
export function croxDaily(last = LAST): Bar[] {
  const all = sessionsEnding(LAST, 130);
  const gapIdx = all.indexOf(CROX_GAP_DAY);
  const pre = all.slice(0, gapIdx);
  const preBars = fromCloses(pre, pre.map((_, i) => lerp(100, 108, i, pre.length)), 900_000, 1.2);
  const post = all.slice(gapIdx);
  const rows: OHLC[] = [
    [138.0, 148.0, 137.5, 146.0],     // 03.11. Zahlen-Gap-Tag: Eröffnung +27,8 % über dem Vortagesschluss 108,0
    [146.5, 150.0, 145.0, 147.5],     // 04.11.
    [147.5, 152.0, 147.0, 150.2],     // 05.11.
    [150.2, 151.5, 148.4, 149.8],     // 06.11.
    [149.8, 154.0, 149.0, 153.1],     // 09.11.
    [153.1, 155.9, 152.0, 154.5],     // 10.11.
    [154.5, 157.0, 153.5, 156.0],     // 11.11.
    [156.0, 158.5, 155.0, 157.6],     // 12.11.
    [157.6, 162.8, 157.0, 160.9],     // 13.11.
    [160.9, 163.4, 158.2, 159.1],     // 16.11.
    [159.1, 162.0, 158.4, 160.7],     // 17.11. Inside Day (früher Kandidat, vor Ablauf der Mindest-Konsolidierung geprüft)
    [160.7, 162.9, 158.0, 159.6],     // 18.11.
    [159.6, 161.9, 156.8, 158.4],     // 19.11.
    [158.4, 161.5, 155.3, 160.4],     // 20.11.
    [160.4, 161.8, 156.2, 157.9],     // 23.11.
    [158.0, 160.0, 157.4, 159.24],    // 24.11. Inside Day, Hoch 160,00 = vorbereiteter Trigger
  ];
  const postBars = explicit(post, rows.slice(0, post.length), 1_100_000);
  return [...preBars, ...postBars].filter((b) => b.end <= sessionFor(last)!.close);
}

// ───────── Sartorius (Xetra, EUR): mehrwöchige Basis unter 300 EUR, Inside Day ─────────
export const SRT_ISIN = "DE0007165631";
export function sartoriusDaily(): Bar[] {
  const dates = sessionsEnding(LAST, 80);
  const closes: number[] = [];
  for (let i = 0; i < 59; i++) closes.push(i < 41 ? lerp(230, 255, i, 41) : lerp(255, 296, i - 40, 19));
  const baseCloses = [295.0, 293.0, 296.2, 293.6, 291.8, 297.0, 294.6, 292.4, 295.6, 293.9, 298.0, 295.2, 293.2, 295.9, 293.4, 292.0, 294.6, 292.8, 296.4, 291.0, 292.8];
  closes.push(...baseCloses);
  const bars = fromCloses(dates, closes, 100_000, 0.5);
  // Basishoch 300,00 (Kontext, „psychologische Marke“), Basistief 284,0
  bars[bars.length - 11] = { ...bars[bars.length - 11], h: 300.0 };
  bars[bars.length - 12] = { ...bars[bars.length - 12], l: 284.0 };
  bars[bars.length - 3] = bar(dates[77], 295.0, 299.2, 289.0, 298.0, 100_000);   // Vortag des Inside Days
  bars[bars.length - 2] = bar(dates[78], 298.0, 299.2, 289.0, 291.0, 100_000);   // 23.11.
  bars[bars.length - 1] = bar(dates[79], 292.5, 298.0, 291.5, 292.8, 100_000);   // 24.11.: Inside Day, Hoch 298,00, Tief 291,50
  return bars;
}

// ───────── Illumina (ILMN, Nasdaq, USD): Rücklauf aufs alte Niveau, Seitwärts, EMA-Reclaim ─────────
export function illuminaDaily(last = LAST): Bar[] {
  const dates = sessionsEnding(LAST, 140);
  const idx = (d: string) => dates.indexOf(d);
  const closes: number[] = new Array(140).fill(0);
  const iHigh = idx("2026-08-14");             // altes Ausbruchsniveau: lokales Hoch um 200,8
  for (let i = 0; i <= iHigh; i++) closes[i] = lerp(168, 199.5, i, iHigh + 1);
  const iPeak = idx("2026-10-02");
  for (let i = iHigh + 1; i <= iPeak; i++) closes[i] = lerp(200, 301, i - iHigh, iPeak - iHigh);
  const iGap = idx("2026-11-03");
  for (let i = iPeak + 1; i < iGap; i++) closes[i] = lerp(300, 252, i - iPeak, iGap - iPeak);
  const iRetest = idx("2026-11-18"), iMid = idx("2026-11-10");
  for (let i = iGap; i <= iMid; i++) closes[i] = lerp(234, 213, i - iGap, iMid - iGap + 1);
  for (let i = iMid + 1; i < iRetest; i++) closes[i] = lerp(213, 207, i - iMid, iRetest - iMid);
  const bars = fromCloses(dates, closes, 1_200_000, 0.9);
  bars[iHigh] = { ...bars[iHigh], h: 200.8 };
  for (let i = iHigh - 5; i <= iHigh + 5; i++) if (i !== iHigh) bars[i] = { ...bars[i], h: Math.min(bars[i].h, 199.6) };
  const tail: OHLC[] = [
    [206.0, 207.2, 197.4, 201.0],      // 18.11.: Rücklauf auf das alte Niveau (≈ 200) – nur die Vorbereitung
    [201.0, 206.5, 200.1, 205.0],      // 19.11.
    [205.0, 207.8, 201.2, 203.2],      // 20.11.
    [203.2, 208.5, 201.6, 205.5],      // 23.11.
    [205.5, 207.4, 202.2, 204.52],     // 24.11.
  ];
  tail.forEach((r, k) => { bars[iRetest + k] = bar(dates[iRetest + k], r[0], r[1], r[2], r[3], 1_100_000); });
  bars[iRetest - 1] = bar(dates[iRetest - 1], 209.0, 211.0, 205.5, 207.0, 1_200_000);
  return bars.filter((b) => b.end <= sessionFor(last)!.close);
}

/** Tageskerzen als Alpaca-Rohdaten (Mitternacht New York) für die Attrappe. */
export function toRawDaily(bars: Bar[]): RawBar[] {
  return bars.map((b) => { const [y, m, d] = new Date(b.end - 1).toISOString().slice(0, 10).split("-").map(Number); return { t: iso(nyToUtc(y, m, d, 0, 0)), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; });
}
export const dateOf = (b: Bar) => new Date(b.end - 3_600_000 * 8).toISOString().slice(0, 10);
