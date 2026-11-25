import { describe, it, expect } from "vitest";
import { createDb, cfgOf, makeDeps, FakeMail } from "./helpers";
import { buildScenario, hourlyBars, dailyRaw, five, T } from "../src/replay/scenario";
import { runIntraday } from "../src/jobs/intraday";
import { runDaily } from "../src/jobs/daily";
import { runHourly } from "../src/jobs/hourly";
import { reviewPositions } from "../src/jobs/positions";
import { saveSeries, loadSeries } from "../src/series";
import { all, one, run, getMeta, upsert } from "../src/store";
import { iso, nyToUtc, HOUR, MIN } from "../src/time";
import { sessionFor } from "../src/calendar";

const S = sessionFor("2026-11-24")!;
const PREV_END = Date.parse("2026-11-23T20:30:00Z");

async function epSetup(o: { date?: string; availableAt?: number | null; v?: number; closeUnderOpen?: boolean } = {}) {
  const db = createDb(), mail = new FakeMail(), sc = buildScenario();
  const now = Date.parse("2026-11-24T14:38:00Z");
  const fmp = { income: async () => [], earningsCalendar: async () => new Map([["GAPR", { symbol: "GAPR", date: o.date ?? "2026-11-23", epsActual: 1.2, availableAt: o.availableAt === undefined ? now - 3_600_000 : o.availableAt }]]) };
  const d = makeDeps(db, cfgOf(), now, { alpaca: sc.alpaca, mail, fmp });
  await upsert(db, "metrics", "symbol", { symbol: "GAPR", asof: "2026-11-23", price: 50, adv_usd: 1e8, range_pct: 3, ret63: 0.2, rs_pct: 90, passed: 1, reason: null, updated_at: now });
  await saveSeries(db, "GAPR", "1h", hourlyBars("flat", PREV_END, 70, 50), now);
  await saveSeries(db, "QQQ", "1h", hourlyBars("up", PREV_END), now);
  const midnight = iso(nyToUtc(2026, 11, 24, 0, 0));
  sc.alpaca.snaps.set("GAPR", { dailyBar: { t: midnight, o: 55.2, h: 56.5, l: 54.9, c: 56, v: 1 } as any, prevDailyBar: { t: iso(nyToUtc(2026, 11, 23, 0, 0)), o: 50, h: 50.5, l: 49.5, c: 50, v: 1 } as any });
  const vol = o.v ?? 300;
  sc.alpaca.raw5.set("GAPR", five(S.open, S.open + HOUR + 20 * MIN, (k) => (o.closeUnderOpen ? 55.2 - 0.05 * k : 55.2 + Math.min(k, 12) * 0.07), () => vol));
  return { db, mail, d, sc };
}
const quote = (d: any, sc: any, ask: number) => sc.alpaca.snaps.set("GAPR", { ...sc.alpaca.snaps.get("GAPR"), latestQuote: { t: iso(d.clock.t - 4000), ap: ask, bp: ask - 0.05 }, latestTrade: { t: iso(d.clock.t - 3000), p: ask - 0.02 } });

describe("Episodic Pivot (nur Quartalszahlen)", () => {
  it("Gap + belegter Katalysator → Vorwarnung; Einstieg erst nach dem Schluss der ersten Handelsstunde", async () => {
    const { db, mail, d, sc } = await epSetup();
    await runIntraday(d);
    const pw = mail.sent.find((m) => m.subject === "Vorwarnung · GAPR · Episodic Pivot")!;
    expect(pw).toBeTruthy(); expect(pw.text).toMatch(/ausdrücklich Stundenschluss, kein früheres Signal/); expect(pw.text).toMatch(/Quartalszahlen vom 2026-11-23/);
    // Während der ersten Stunde (auch wenn der Kurs weit über der Eröffnung steht) kein Einstieg
    d.clock.t = Date.parse("2026-11-24T15:20:00Z"); quote(d, sc, 56); await runIntraday(d);
    expect(mail.sent.some((m) => m.subject.startsWith("Einstieg"))).toBe(false);
    // Nach 10:30 mit abgeschlossener Stunde: bestätigt
    d.clock.t = Date.parse("2026-11-24T15:32:00Z"); quote(d, sc, 56.05); await runIntraday(d);
    const m = mail.sent.find((x) => x.subject === "Einstieg bestätigt · GAPR · Episodic Pivot")!;
    expect(m).toBeTruthy(); expect(m.text).toMatch(/Gap [\d.]+ % zur Eröffnung/); expect(m.text).toMatch(/Erste Handelsstunde schloss bei/);
    expect((await one<any>(db, "SELECT status, stop_price FROM signals WHERE status='confirmed'")).stop_price).toBeCloseTo(55.14, 2);
  });
  it("bloßes Meldedatum des Gap-Tages ohne belegte Uhrzeit → kein Episodic Pivot", async () => {
    const { db, mail, d } = await epSetup({ date: "2026-11-24", availableAt: null });
    await runIntraday(d);
    expect(await all(db, "SELECT 1 FROM prepared WHERE setup='episodic_pivot'")).toHaveLength(0);
    expect(mail.sent.length).toBe(0);
    expect((await getMeta<any>(db, "ep:2026-11-24")).rejected[0]).toMatch(/unklar/);
  });
  it("zu wenig Volumen oder Schluss unter der Eröffnung → verworfen", async () => {
    for (const o of [{ v: 100 }, { closeUnderOpen: true }]) {
      const { db, mail, d, sc } = await epSetup(o);
      await runIntraday(d);
      d.clock.t = Date.parse("2026-11-24T15:32:00Z"); quote(d, sc, 56); await runIntraday(d);
      expect(mail.sent.some((m) => m.subject.startsWith("Einstieg"))).toBe(false);
      expect((await one<any>(db, "SELECT state FROM prepared WHERE setup='episodic_pivot'")).state).toBe("invalidated");
    }
  });
  it("ohne FMP-Schlüssel ist Episodic Pivot ausdrücklich deaktiviert", async () => {
    const { db, d } = await epSetup(); (d as any).fmp = null;
    await runIntraday(d);
    expect((await getMeta<any>(db, "ep:2026-11-24")).skipped).toMatch(/FMP_API_KEY/);
  });
});

describe("Universum, Symbolwechsel, Splits", () => {
  it("Symbolwechsel: gleiche Asset-ID, neues Symbol → alte Reihe wird verworfen und gemeldet", async () => {
    const db = createDb(), sc = buildScenario(); const d = makeDeps(db, cfgOf(), T.daily, { alpaca: sc.alpaca });
    await runDaily(d);
    sc.alpaca.assetList[0] = { ...sc.alpaca.assetList[0], symbol: "DEMX" };
    sc.alpaca.rawD.set("DEMX", dailyRaw("DEMX", "2026-11-24", 140, 60, 102));
    d.clock.t = Date.parse("2026-11-24T22:10:00Z");
    await runDaily(d);
    expect((await all(db, "SELECT symbol FROM assets")).map((a: any) => a.symbol)).toEqual(["DEMX"]);
    expect(await loadSeries(db, "DEMO", "1d")).toHaveLength(0);
    expect((await getMeta<any>(db, "universe_stats:US")).renamed).toEqual(["DEMO → DEMX"]);
  });
  it("Split: angepasste Historie weicht ab → Reihe neu geladen, offene Position zur Prüfung markiert, kein automatisches Nachziehen", async () => {
    const db = createDb(), sc = buildScenario(); const d = makeDeps(db, cfgOf(), T.daily, { alpaca: sc.alpaca });
    await runDaily(d);
    await run(db, "INSERT INTO positions (id,signal_id,symbol,status,entry,shares,initial_stop,stop,opened_at,created_at,partial_recommended_at) VALUES ('p1','s1','DEMO','open',100,10,95,95,?,?,1)", T.daily - 9e8, T.daily);
    const half = dailyRaw("DEMO", "2026-11-24", 141, 30, 50.5).map((r) => ({ ...r, o: r.o, h: r.h, l: r.l, c: r.c }));   // 2:1-Split: gesamte Historie halbiert
    sc.alpaca.rawD.set("DEMO", half);
    d.clock.t = Date.parse("2026-11-24T22:10:00Z");
    await runDaily(d);
    expect((await getMeta<any>(db, "universe_stats:US")).resynced).toBeGreaterThan(0);
    expect((await one<any>(db, "SELECT needs_review FROM positions WHERE id='p1'")).needs_review).toBe(1);
    const lines = await reviewPositions(d, d.markets.US);
    expect(lines[0]).toMatch(/Split erkannt/);
    expect((await one<any>(db, "SELECT stop FROM positions WHERE id='p1'")).stop).toBe(95);
  });
  it("Feiertag/Wochenende: keine Scans, keine Fehler", async () => {
    const db = createDb(), d = makeDeps(db, cfgOf(), Date.parse("2026-11-26T16:00:00Z"));   // Thanksgiving
    expect(await runHourly(d)).toMatch(/idle/); expect(await runIntraday(d)).toMatch(/idle/);
    d.clock.t = Date.parse("2026-11-28T16:00:00Z"); expect(await runIntraday(d)).toMatch(/idle/);
    expect(await all(db, "SELECT 1 FROM scan_runs")).toHaveLength(0);
  });
  it("verkürzte Sitzung: Stundenscan nur bis 12:30, danach idle", async () => {
    const db = createDb(), d = makeDeps(db, cfgOf(), Date.parse("2026-11-27T18:40:00Z"));   // 13:40 NY, Markt seit 13:00 zu
    expect(await runIntraday(d)).toMatch(/idle/);
  });
});
