import { describe, it, expect } from "vitest";
import { prepare, checkTrigger, runningHour, ema, stopBelow, invalidatedByBar, HOURLY } from "../src/patterns";
import type { Bar, RunningBar } from "../src/types";
import { bar } from "./helpers";
import { HOUR, MIN } from "../src/time";

const T0 = Date.parse("2026-11-02T15:30:00Z");
const mk = (rows: readonly (readonly [number, number, number, number, number?])[]): Bar[] => rows.map((r, i) => bar(T0 + i * HOUR, r[0], r[1], r[2], r[3], r[4] ?? 1000));
/** ruhige Auffüllung um 100 */
const flat = (n: number, c = 100): [number, number, number, number][] => Array.from({ length: n }, () => [c, c + 0.2, c - 0.2, c]);
const run = (o: Partial<RunningBar>): RunningBar => ({ start: 0, o: 100, h: 100, l: 100, c: 100, v: 0, elapsedMin: 30, lastEnd: T0, periodMin: 60, ...o });
const names = (b: Bar[]) => prepare(b, "1h").map((p) => p.setup);

describe("Undercut & Rally", () => {
  const base = flat(20);
  it("positiv: Unterschreitung, Schluss darüber und über Vorschluss; Auslöser = Hoch der Undercut-Kerze", () => {
    const b = mk([...base, [100, 101.5, 98, 101]]);
    const p = prepare(b, "1h").find((x) => x.setup === "undercut_rally")!;
    expect(p).toBeTruthy();
    expect(p.trigger).toBe(101.5);
    expect(p.stop).toBe(stopBelow(98));
    expect(checkTrigger(p, run({ c: 101.6, l: 101 })).fired).toBe(true);
    expect(checkTrigger(p, run({ c: 101.4, l: 101 })).fired).toBe(false);
    expect(checkTrigger(p, run({ c: 102, l: 97.9 })).blocked).toMatch(/Invalidierung/);
  });
  it("negativ: kein neues Tief / Schluss nicht über Vorschluss", () => {
    expect(names(mk([...base, [100, 101.5, 99.9, 101]]))).not.toContain("undercut_rally");
    expect(names(mk([...base, [100, 101, 98, 99.9]]))).not.toContain("undercut_rally");
  });
});

describe("First Higher Low", () => {
  const lows = [120, 119, 118, 117, 116, 115, 114, 113, 112, 111, 110, 105, 100, 105, 110, 112, 114, 116, 115, 113, 111, 109, 108, 107, 106, 104, 102, 104, 105, 105];
  const rows = (l: number[]): [number, number, number, number][] => l.map((x) => [x + 0.5, x + 1.5, x, x + 1]);
  it("positiv: höheres zweites Tief, Auslöser = höchstes Hoch der zweiten Tiefkerze und zwei Folgekerzen", () => {
    const p = prepare(mk(rows(lows)), "1h").find((x) => x.setup === "first_higher_low")!;
    expect(p).toBeTruthy();
    expect(p.trigger).toBe(Math.max(103.5, 105.5, 106.5)); // Hochs von Index 26..28 → 103.5/105.5/106.5
    expect(p.invalidateBelow).toBe(102);
    expect(checkTrigger(p, run({ c: p.trigger + 0.1, l: 103 })).fired).toBe(true);
    expect(checkTrigger(p, run({ c: p.trigger + 0.1, l: 101.9 })).fired).toBe(false); // zweites Tief unterschritten
  });
  it("negativ: zweites Tief nicht höher", () => {
    const l2 = [...lows]; l2[26] = 99;
    expect(names(mk(rows(l2)))).not.toContain("first_higher_low");
  });
  it("negativ: Ausbruch war schon per Stundenschluss erfolgt", () => {
    const b = mk(rows(lows)); b[29] = bar(b[29].end, 106, 120, 106, 119);
    expect(names(b)).not.toContain("first_higher_low");
  });
});

describe("Wedge Pop", () => {
  const left = [[105, 110, 100, 106], [106, 110, 101, 105], [105, 109, 100.5, 104], [104, 110, 100, 105]] as const;
  const right = [[105, 108, 99.5, 104], [104, 107, 100, 103], [103, 108, 99.8, 104], [104, 107.5, 100, 105]] as const;
  const b = mk([...flat(20), ...left, ...right]);
  it("positiv mit Volumentempo", () => {
    const p = prepare(b, "1h").find((x) => x.setup === "wedge_pop")!;
    expect(p).toBeTruthy();
    expect(p.trigger).toBe(108);
    expect(checkTrigger(p, run({ c: 108.2, v: 400, elapsedMin: 20 })).fired).toBe(true);
    expect(checkTrigger(p, run({ c: 108.2, v: 300, elapsedMin: 20 })).blocked).toMatch(/Volumentempo/);
    expect(checkTrigger(p, run({ c: 108.2, v: 900, elapsedMin: 5 })).blocked).toMatch(/zu früh/);
  });
  it("negativ: Spanne wird nicht kleiner", () => {
    const b2 = mk([...flat(20), ...left, [105, 109.5, 99, 104], [104, 107, 99.2, 103], [103, 108, 99, 104], [104, 107.5, 99, 105]]);
    expect(names(b2)).not.toContain("wedge_pop");
  });
});

describe("EMA-Crossback", () => {
  function build() {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + 0.4 * i);
    for (let k = 0; k < 40; k++) { const avg = ema(closes, 20); closes[29] = avg * 1.01; }
    return mk(closes.map((c, i) => [i ? closes[i - 1] : c, Math.max(c, i ? closes[i - 1] : c) + 0.1, Math.min(c, i ? closes[i - 1] : c) - 0.1, c]));
  }
  it("positiv: EMA steigt, Schluss knapp darüber; Auslöser braucht Berührung in der laufenden Stunde", () => {
    const b = build();
    const p = prepare(b, "1h").find((x) => x.setup === "ema_crossback")!;
    expect(p).toBeTruthy();
    expect(p.trigger).toBe(b[29].h);
    const touch = p.touchLevel!;
    expect(checkTrigger(p, run({ c: p.trigger + 0.1, l: touch - 0.05 })).fired).toBe(true);
    expect(checkTrigger(p, run({ c: p.trigger + 0.1, l: touch + 0.5 })).blocked).toMatch(/EMA nicht berührt/);
  });
  it("negativ: Schluss unter dem EMA oder EMA fällt", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 130 - 0.4 * i);
    expect(names(mk(closes.map((c) => [c, c + 0.1, c - 0.1, c])))).not.toContain("ema_crossback");
  });
});

describe("Base’n Break vs. Base Breakout sind unterscheidbar", () => {
  const rise = (from: number, to: number, n: number): [number, number, number, number][] => Array.from({ length: n }, (_, i) => { const c = from + ((to - from) * (i + 1)) / n; return [c, c + 0.15, c - 0.15, c] as [number, number, number, number]; });
  // Schub: H[-9]=100, danach 103.0–103.9 in engem Sockel
  const shelf: [number, number, number, number][] = [[103, 104.2, 103.0, 103.5], [103.5, 104.2, 103.1, 103.8], [103.8, 104.2, 103.2, 103.6], [103.6, 104.2, 103.3, 103.9]];
  it("Schub + kurzer Sockel → nur Base’n Break, obwohl auch die 8-Kerzen-Basis ≤3 % ist", () => {
    const b = mk([...rise(80, 95, 18), [95, 95.2, 94.8, 95], [95, 100.2, 94.9, 100], [100, 103.4, 99.9, 103.1], [103.1, 103.6, 102.8, 103.2], [103.2, 104, 103, 103.6], [103.6, 104, 103.3, 103.5], ...shelf]);
    const n = names(b);
    expect(n).toContain("base_n_break");
    expect(n).not.toContain("base_breakout");
    const p = prepare(b, "1h").find((x) => x.setup === "base_n_break")!;
    expect(p.trigger).toBe(104.2);
    expect(checkTrigger(p, run({ c: 104.3, l: 104 })).fired).toBe(true);
  });
  it("langsame Basis ohne Schub → nur Base Breakout, mit Volumenanforderung", () => {
    const b = mk([...rise(80, 100, 22), ...Array.from({ length: 8 }, (_, i) => [101.5, 102.1 + (i % 2) * 0.1, 100.9, 101.5 + (i % 3) * 0.2] as [number, number, number, number])]);
    const n = names(b);
    expect(n).toContain("base_breakout");
    expect(n).not.toContain("base_n_break");
    const p = prepare(b, "1h").find((x) => x.setup === "base_breakout")!;
    expect(checkTrigger(p, run({ c: p.trigger + 0.2, l: p.trigger - 0.2, v: 500, elapsedMin: 30 })).blocked).toMatch(/Volumentempo/);
    expect(checkTrigger(p, run({ c: p.trigger + 0.2, l: p.trigger - 0.2, v: 700, elapsedMin: 30 })).fired).toBe(true); // 1400/h ≥ 1,2 × 1000
  });
  it("negativ: Basis breiter als 3 %", () => {
    const b = mk([...rise(80, 100, 22), ...Array.from({ length: 8 }, (_, i) => [103, 105 + (i % 2), 101, 103] as [number, number, number, number])]);
    expect(names(b)).not.toContain("base_breakout");
  });
});

describe("Kein Zukunftswissen", () => {
  it("laufende, noch nicht abgeschlossene 5-Minuten-Kerzen zählen nicht", () => {
    const hs = T0;
    const mk5 = (i: number, c: number) => bar(hs + (i + 1) * 5 * MIN, c, c + 0.1, c - 0.1, c, 100);
    const bars = [mk5(0, 100), mk5(1, 101), mk5(2, 120)];
    const now = hs + 15 * MIN + 30_000; // 3. Kerze endet 15:00 → noch nicht abgeschlossen mit 60 s Verzögerung
    const r = runningHour(bars, hs, now, 60_000)!;
    expect(r.c).toBe(101);
    expect(r.elapsedMin).toBe(10);
    expect(runningHour(bars, hs, hs + 15 * MIN + 61_000, 60_000)!.c).toBe(120);
  });
  it("Invalidierung nur durch bereits abgeschlossene Stundenkerzen", () => {
    const p = prepare(mk([...flat(20), [100, 101.5, 98, 101]]), "1h")[0];
    expect(invalidatedByBar(p, bar(T0, 100, 100, 97.9, 99))).toBe(true);
    expect(invalidatedByBar(p, bar(T0, 100, 101, 98.5, 100))).toBe(false);
  });
  it("Stundenschluss-Setups liefern keinen 5-Minuten-Auslöser", () => {
    const p = { ...prepare(mk([...flat(20), [100, 101.5, 98, 101]]), "1h")[0], needsHourClose: true };
    expect(checkTrigger(p, run({ c: 999 }), HOURLY).fired).toBe(false);
  });
});
