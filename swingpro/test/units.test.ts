import { describe, it, expect } from "vitest";
import { sp500Context, qqqDecision } from "../src/market";
import { growthScore } from "../src/growth";
import { catalystKnown } from "../src/catalyst";
import { sizePosition } from "../src/sizing";
import { checkEntry } from "../src/entry";
import { classifyAsset, computeMetrics, prefilter } from "../src/universe";
import { mergeSeries } from "../src/series";
import { weeklyBars, confirmedWeeklyLows, trailedStop, assessStop, partialTarget, stagnation, type Position } from "../src/positions";
import { buildHourly, bestQuote } from "../src/providers";
import { cfgOf, bar, series } from "./helpers";
import { loadConfig } from "../src/config";
import { nyToUtc, HOUR, DAY, addDays } from "../src/time";
import { sessionFor, nextSession } from "../src/calendar";

const cfg = cfgOf();

describe("S&P 500 (Baron)", () => {
  const csv = (n: number, last: string, lastVal: string) => "observation_date,SP500\n" + Array.from({ length: n }, (_, i) => `${addDays(last, -(n - 1 - i))},${100 + i}`).slice(0, n - 1).join("\n") + `\n${last},${lastVal}`;
  it("vergleicht Schluss des letzten abgeschlossenen Tages mit SMA200 und zeigt Datum", () => {
    const c = sp500Context(csv(260, "2026-11-23", "300"), "2026-11-23");
    expect(c.state).toBe("über"); expect(c.obsDate).toBe("2026-11-23"); expect(c.isLastCompleted).toBe(true);
    expect(c.text).toMatch(/Schluss 300\.00 vom 2026-11-23 \/ SMA200/);
    expect(sp500Context(csv(260, "2026-11-23", "50"), "2026-11-23").state).toBe("unter");
  });
  it("benennt, wenn der letzte Handelstag bei FRED fehlt, und nutzt nie spätere Werte", () => {
    const c = sp500Context(csv(260, "2026-11-23", "300"), "2026-11-24");
    expect(c.isLastCompleted).toBe(false); expect(c.text).toMatch(/noch nicht veröffentlicht/);
    expect(sp500Context(csv(260, "2026-11-25", "300"), "2026-11-23").obsDate).toBe("2026-11-23");
  });
  it("leere Werte (Feiertage) werden übersprungen; zu wenig Daten → unbekannt", () => {
    expect(sp500Context(csv(100, "2026-11-23", "300"), "2026-11-23").state).toBe("unbekannt");
    expect(sp500Context("observation_date,SP500\n2026-11-23,\n", "2026-11-23").state).toBe("unbekannt");
  });
});

describe("QQQ-Filter (separat geprüft)", () => {
  const down = series(Array.from({ length: 40 }, (_, i) => 120 - i * 0.5));
  const up = series(Array.from({ length: 40 }, (_, i) => 100 + i * 0.5));
  it("Modus info blockiert nichts", () => expect(qqqDecision(cfgOf({ QQQ_FILTER: "info" }), down).blocked).toEqual([]));
  it("block_all (alter Stand) blockiert auch Erholungs-Setups – der Zielkonflikt", () => expect(qqqDecision(cfgOf({ QQQ_FILTER: "block_all" }), down).blocked).toContain("undercut_rally"));
  it("Standard lässt Erholungs-Setups durch, blockiert Trend-Setups", () => {
    const d = qqqDecision(cfg, down);
    expect(d.trendOk).toBe(false);
    expect(d.blocked).not.toContain("undercut_rally"); expect(d.blocked).not.toContain("first_higher_low");
    expect(d.blocked).toContain("base_breakout"); expect(d.text).toMatch(/sperrt Trend-Setups/);
  });
  it("Aufwärtstrend blockiert nichts; fehlende Daten blockieren (außer info)", () => {
    expect(qqqDecision(cfg, up).blocked).toEqual([]);
    expect(qqqDecision(cfg, up.slice(0, 10)).dataOk).toBe(false);
    expect(qqqDecision(cfg, up.slice(0, 10)).blocked.length).toBe(7);
  });
});

describe("Wachstum (Giering)", () => {
  const cur = { symbol: "X", fiscalYear: 2026, reportedCurrency: "USD", period: "Q3", date: "2026-09-30", filingDate: "2026-10-15", revenue: 120, epsDiluted: 1.25 };
  const prev = { ...cur, fiscalYear: 2025, date: "2025-09-30", filingDate: "2025-10-15", revenue: 100, epsDiluted: 1 };
  const g = (rows: any[], today = "2026-11-24") => growthScore(rows, today, cfg);
  it("Kandidat bei ≥20 % / ≥25 % und nennt Zeitraum", () => {
    const r = g([prev, cur]); expect(r.verdict).toBe("kandidat"); expect(r.text).toMatch(/Q3 2026 \(Periodenende 2026-09-30, Filing 2026-10-15\)/);
  });
  it("Schwellen verfehlt, aber nicht unterdrückend (nur Etikett)", () => expect(g([prev, { ...cur, revenue: 119 }]).verdict).toBe("verfehlt"));
  it("offen: negatives Vorjahres-EPS, fehlende Daten, Filing am selben Tag, alte Daten, Währung", () => {
    expect(g([{ ...prev, epsDiluted: -0.5 }, cur]).reason).toMatch(/Vorjahres-EPS/);
    expect(g([]).verdict).toBe("offen");
    expect(g([prev, { ...cur, filingDate: "2026-11-24" }]).verdict).toBe("offen");
    expect(g([prev, cur], "2027-06-01").reason).toMatch(/Tage alt/);
    expect(g([prev, { ...cur, reportedCurrency: "EUR" }]).reason).toMatch(/währung/);
    expect(g([prev, { ...cur, epsDiluted: null }]).reason).toMatch(/fehlt/);
  });
});

describe("Katalysator (Episodic Pivot)", () => {
  const day = "2026-11-24", prev = "2026-11-23";
  const at = nyToUtc(2026, 11, 24, 10, 30);
  it("Datum des Vortags genügt", () => expect(catalystKnown({ symbol: "A", date: prev, epsActual: 1 }, day, at).ok).toBe(true));
  it("bloßes Datum des Gap-Tages genügt NICHT (könnte nach Börsenschluss kommen)", () => {
    const r = catalystKnown({ symbol: "A", date: day, epsActual: 1 }, day, at);
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/unklar/);
  });
  it("Gap-Tag mit belegtem Zeitpunkt vor der Entscheidung ok; amc am Gap-Tag nie", () => {
    expect(catalystKnown({ symbol: "A", date: day, epsActual: 1, timing: "bmo" }, day, at).ok).toBe(true);
    expect(catalystKnown({ symbol: "A", date: day, epsActual: 1, timing: "amc" }, day, at).ok).toBe(false);
    expect(catalystKnown({ symbol: "A", date: day, epsActual: 1, availableAt: at - 1 }, day, at).ok).toBe(true);
    expect(catalystKnown({ symbol: "A", date: day, epsActual: 1, availableAt: at + 1 }, day, at).ok).toBe(false);
  });
  it("ohne Ist-Wert, ohne Meldung oder weit zurück: kein Katalysator", () => {
    expect(catalystKnown({ symbol: "A", date: prev, epsActual: null }, day, at).ok).toBe(false);
    expect(catalystKnown(undefined, day, at).ok).toBe(false);
    expect(catalystKnown({ symbol: "A", date: "2026-11-10", epsActual: 1 }, day, at).ok).toBe(false);
  });
});

describe("Größe, Risiko, Währung", () => {
  it("Startwerte: 0,5 % Risiko, 25 % Gewicht", () => {
    const s = sizePosition(cfg, 100, 98, []);
    expect(s.shares).toBe(25); expect(s.plannedRiskUsd).toBe(50); expect(s.limitedBy).toBe("risiko");
    const w = sizePosition(cfg, 100, 99.9, []);
    expect(w.limitedBy).toBe("gewicht"); expect(w.shares).toBe(25);
  });
  it("berücksichtigt offene Positionen, Kapital, Gesamtrisiko und Positionsanzahl", () => {
    const open = (n: number, risk: number) => Array.from({ length: n }, (_, i) => ({ symbol: "S" + i, sharesRemaining: 100, entry: 50, stop: 50 - risk / 100 }));
    const big = sizePosition(cfg, 100, 99, [{ symbol: "A", sharesRemaining: 180, entry: 50, stop: 49.9 }]); // 9000 USD gebunden
    expect(big.limitedBy).toBe("kapital"); expect(big.shares).toBe(10);
    expect(sizePosition(cfg, 20, 19, open(2, 140)).shares).toBeLessThan(25);          // Gesamtrisiko 300 USD ausgeschöpft → 20 Stück
    expect(sizePosition(cfgOf({ MAX_POSITIONS: "1" }), 100, 98, open(1, 0)).limitedBy).toBe("positionen");
    expect(sizePosition(cfg, 100, 100.5, []).shares).toBe(0);
  });
  it("EUR-Depot nur mit dokumentiertem Wechselkurs", () => {
    expect(() => loadConfig({ ACCOUNT_CURRENCY: "EUR" })).toThrow(/FX_USD_PER_EUR/);
    expect(() => loadConfig({ ACCOUNT_CURRENCY: "EUR", FX_USD_PER_EUR: "1.1" })).toThrow(/FX_DATE/);
    const c = loadConfig({ ACCOUNT_CURRENCY: "EUR", FX_USD_PER_EUR: "1.10", FX_DATE: "2026-11-20", FX_SOURCE: "EZB", CAPITAL: "10000" });
    expect(sizePosition(c, 100, 98, []).riskBudgetUsd).toBeCloseTo(55, 5);   // 0,5 % von 11.000 USD
  });
  it("ungültige Konfiguration wird abgelehnt", () => {
    expect(() => loadConfig({ RISK_PERCENT: "abc" })).toThrow(); expect(() => loadConfig({ MODE: "x" })).toThrow(); expect(() => loadConfig({ DATA_FEED: "bats" })).toThrow();
  });
});

describe("Einstiegsprüfung (frischer Kurs, verpasst)", () => {
  const now = 1_000_000_000_000;
  const q = (price: number, age = 10) => ({ price, time: now - age * 1000, kind: "ask" as const });
  it("bestätigt innerhalb der Grenze", () => expect(checkEntry(cfg, 100, 98, q(100.3), now).status).toBe("confirmed"));
  it("verpasst über 0,25 R", () => { const r = checkEntry(cfg, 100, 98, q(100.6), now); expect(r.status).toBe("missed"); expect(r.chaseR).toBeCloseTo(0.3, 5); });
  it("alter oder fehlender Kurs löst keinen Einstieg aus", () => {
    expect(checkEntry(cfg, 100, 98, q(100.1, 600), now).status).toBe("stale_quote");
    expect(checkEntry(cfg, 100, 98, null, now).status).toBe("no_quote");
  });
  it("Kurs unter Auslöser / unter Stopp / Stopp zu eng", () => {
    expect(checkEntry(cfg, 100, 98, q(99.5), now).status).toBe("below_trigger");
    expect(checkEntry(cfg, 100, 98, q(97), now).status).toBe("invalid_stop");
    expect(checkEntry(cfg, 100, 99.8, q(100.1), now).status).toBe("invalid_stop");
  });
  it("bestQuote nimmt Ask, fällt auf frischen Trade zurück, meldet Alter korrekt", () => {
    const iso = (t: number) => new Date(t).toISOString();
    expect(bestQuote({ latestQuote: { t: iso(now - 5000), ap: 10.1, bp: 10 }, latestTrade: { t: iso(now - 1000), p: 10.05 } }, now, 120_000)!.kind).toBe("ask");
    expect(bestQuote({ latestQuote: { t: iso(now - 500_000), ap: 10.1, bp: 10 }, latestTrade: { t: iso(now - 1000), p: 10.05 } }, now, 120_000)!.kind).toBe("last");
    expect(bestQuote(undefined, now, 1)).toBeNull();
  });
});

describe("Universum", () => {
  const a = (symbol: string, name: string, over: any = {}) => ({ id: symbol, symbol, name, exchange: "NASDAQ", status: "active", tradable: true, class: "us_equity", ...over });
  const v = (x: any) => classifyAsset(x, cfg);
  it("nimmt Stammaktien auf, schließt Sonderinstrumente aus", () => {
    expect(v(a("AAPL", "Apple Inc. Common Stock")).included).toBe(true);
    expect(v(a("BRK.B", "Berkshire Hathaway Inc. Class B", { exchange: "NYSE" })).included).toBe(true);
    for (const [s, n] of [["SPY", "SPDR S&P 500 ETF Trust"], ["QQQ", "Invesco QQQ Trust, Series 1 ETF"], ["ABCDW", "Foo Acquisition Corp Warrants"], ["ABCDU", "Foo Units"], ["BAC.PRL", "Bank of America Preferred"], ["XYZ", "XYZ Corp 6.5% Notes due 2030"], ["SPCE1", "Foo Acquisition Corp."], ["XYZR", "XYZ Rights"]] as const)
      expect(v(a(s, n)).included, s).toBe(false);
    expect(v(a("ABCDW", "Foo Corp")).reason).toMatch(/Suffix/);
    expect(v(a("OTCX", "Foo", { exchange: "OTC" })).reason).toMatch(/Börse/);
    expect(v(a("NEW", "New Corp", { attributes: ["ipo"] })).reason).toMatch(/Neuemission/);
  });
  it("ADRs standardmäßig ausgeschlossen, per Option zugelassen", () => {
    expect(v(a("TSM", "Taiwan Semiconductor ADR", { exchange: "NYSE" })).reason).toBe("ADR");
    expect(classifyAsset(a("TSM", "Taiwan Semiconductor ADR", { exchange: "NYSE" }), cfgOf({ INCLUDE_ADRS: "true" })).included).toBe(true);
  });
  const days = (n: number, p: number, v = 1e6, step = 0) => series(Array.from({ length: n }, (_, i) => p + i * step), { range: 2, vol: v });
  it("Vorauswahl nach Preis, Dollarumsatz, Spanne, Historie und relativer Stärke; zählt Lücken", () => {
    const c = cfgOf({ MIN_PRICE: "10", MIN_DOLLAR_VOLUME: "5000000", MIN_RS_PERCENTILE: "50", MIN_HISTORY_DAYS: "100" });
    const m = new Map<string, any>([
      ["GOOD", computeMetrics("GOOD", days(120, 50, 1e6, 0.5), "d")], ["BETTER", computeMetrics("BETTER", days(120, 50, 1e6, 1), "d")], ["WEAK", computeMetrics("WEAK", days(120, 100, 1e6, -0.3), "d")],
      ["PENNY", computeMetrics("PENNY", days(120, 3, 1e7), "d")], ["THIN", computeMetrics("THIN", days(120, 50, 1000), "d")], ["IPO", computeMetrics("IPO", days(70, 50, 1e6), "d")], ["GAP", null],
    ]);
    const { rows, stats } = prefilter(c, m, { available: 100, excludedByReason: { ETF: 10, ADR: 5 } });
    const pass = rows.filter((r) => r.passed).map((r) => r.symbol).sort();
    expect(pass).toEqual(["BETTER", "GOOD"]);
    expect(rows.find((r) => r.symbol === "PENNY")!.reason).toMatch(/Kurs/); expect(rows.find((r) => r.symbol === "THIN")!.reason).toMatch(/Dollarumsatz/);
    expect(rows.find((r) => r.symbol === "IPO")!.reason).toMatch(/istorie/); expect(rows.find((r) => r.symbol === "WEAK")!.reason).toMatch(/Relative Stärke/);
    expect(stats).toMatchObject({ available: 100, excluded: 15, dataGaps: 2, watch: 2 });
  });
});

describe("Reihen: Splits und Datenlücken", () => {
  const old = [bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 101)];
  it("Überlappung mit abweichendem Schluss (Split) erzwingt Neuaufbau", () => {
    expect(mergeSeries(old, [bar(2, 50, 51, 49, 50.5), bar(3, 51, 52, 50, 51)], 100).resync).toBe(true);
    const ok = mergeSeries(old, [bar(2, 100, 101, 99, 101), bar(3, 101, 102, 100, 102)], 100);
    expect(ok.resync).toBe(false); expect(ok.merged.length).toBe(3);
  });
  it("buildHourly: nur vollständige Paare abgeschlossener Kerzen, letzte halbe Stunde entfällt", () => {
    const s = sessionFor("2026-11-24")!;
    const raw = (st: number) => ({ t: new Date(st).toISOString(), o: 10, h: 11, l: 9, c: 10, v: 100 });
    const halves = []; for (let t = s.open; t < s.close; t += 30 * 60_000) halves.push(raw(t));
    const done = buildHourly(halves, s.close + 3_600_000, 60_000);
    expect(done.length).toBe(6); expect(done[5].end).toBe(s.open + 6 * HOUR);
    expect(buildHourly(halves, s.open + HOUR + 30_000, 60_000).length).toBe(0);          // 10:30 noch nicht abgeschlossen (mit Verzögerung)
    expect(buildHourly(halves.filter((h) => Date.parse(h.t) !== s.open + 30 * 60_000), s.close, 0).length).toBe(5); // fehlende Hälfte → Stunde fehlt
  });
});

describe("Positionsbegleitung", () => {
  const pos = (over: Partial<Position> = {}): Position => ({ id: "p", symbol: "X", entry: 100, shares: 50, fees: 0, initialStop: 96, stop: 96, openedAt: nyToUtc(2026, 11, 2, 11), sharesSold: 0, partialRecommendedAt: 1, stagnationHintedAt: null, ...over });
  /** Kalenderwochen ab Mo 2026-11-02 mit je einem Wochentief (am Mittwoch) */
  function dailyFrom(weekLows: number[]) {
    const out: any[] = [];
    weekLows.forEach((lo, w) => { for (let i = 0; i < 5; i++) { const d = addDays("2026-11-02", w * 7 + i); const s = sessionFor(d); if (s) out.push(bar(s.close, lo + 3, lo + 5, i === 2 ? lo : lo + 1.5, lo + 4)); } });
    return out;
  }
  const daily = dailyFrom([100, 98, 101, 103, 105]);   // Wochen ab 02.11., 09.11., 16.11., 23.11. (Thanksgiving), 30.11.
  it("Wochentief ist erst nach zwei höheren, abgeschlossenen Folgewochen bestätigt (keine Zukunftsdaten)", () => {
    const weeks = weeklyBars(daily);
    expect(weeks.length).toBe(5);
    expect(confirmedWeeklyLows(weeks, "2026-11-20", "2026-11-02")).toEqual([]);                    // nur eine Folgewoche
    expect(confirmedWeeklyLows(weeks, "2026-11-25", "2026-11-02")).toEqual([]);                    // Woche 4 noch nicht abgeschlossen (27.11. offen)
    expect(confirmedWeeklyLows(weeks, "2026-11-27", "2026-11-02").map((x) => x.low)).toEqual([98]); // Thanksgiving-Woche endet am 27.11.
    expect(confirmedWeeklyLows(weeks, "2026-11-27", "2026-11-10")).toEqual([]);                    // Einstiegswoche zählt nicht
    // Daten nach dem Bewertungszeitpunkt ändern das Ergebnis nicht
    expect(confirmedWeeklyLows(weeklyBars(daily.slice(0, 19)), "2026-11-27", "2026-11-02")).toEqual(confirmedWeeklyLows(weeks, "2026-11-27", "2026-11-02"));
  });
  it("Schutzstopp steigt nur und erst nach dem 2R-Teilverkaufssignal", () => {
    expect(trailedStop(cfg, pos(), daily, "2026-11-27")).toMatchObject({ stop: 97.99, low: 98 });
    expect(trailedStop(cfg, pos({ partialRecommendedAt: null }), daily, "2026-11-27")).toBeNull();
    expect(trailedStop(cfg, pos({ stop: 99 }), daily, "2026-11-27")).toBeNull();     // würde senken → nichts
  });
  it("2R-Marke, Teilmenge und Stagnation", () => {
    expect(partialTarget(cfg, pos())).toEqual({ price: 108, shares: 25 });
    expect(stagnation(cfg, pos(), 101, "2026-11-24")).toMatch(/kein Fortschritt/);
    expect(stagnation(cfg, pos(), 110, "2026-11-24")).toBeNull();
    expect(stagnation(cfg, pos(), 101, "2026-11-10")).toBeNull();
  });
  it("Kursgap: kein Verkauf zum Stoppkurs behauptet", () => {
    const gap = assessStop(pos(), 93.5, 94);
    expect(gap).toMatchObject({ hit: true, gap: true }); expect((gap as any).text).toMatch(/nicht anzunehmen/);
    const normal = assessStop(pos(), 95.9, 97);
    expect(normal).toMatchObject({ hit: true, gap: false });
    expect(assessStop(pos(), 100, 99)).toEqual({ hit: false });
  });
});
