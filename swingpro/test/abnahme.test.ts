/** Abnahme: Scanner findet eigenständig (Blindlauf, Gegenproben) und das Paper-Protokoll hält Zeitpunkte getrennt fest. Alle Daten sind TESTDATEN. */
import { describe, it, expect } from "vitest";
import { createDb, cfgOf, makeDeps, FakeMail, FakeAlpaca } from "./helpers";
import { fixtureBlindRun, FIXTURE_PROV, noFormation } from "./fixtures/blindcase";
import { croxDaily, toRawDaily, CROX_EVENT, LAST } from "./fixtures/siebenhaar";
import { evaluateTargets, renderReport, evidenceLevel, clipToAsOf } from "../src/blindrun";
import { runDaily } from "../src/jobs/daily";
import { runIntraday } from "../src/jobs/intraday";
import { five } from "../src/replay/scenario";
import { all, one, run, setMeta, getMeta } from "../src/store";
import { sessionFor } from "../src/calendar";
import { iso, MIN, nyToUtc } from "../src/time";
import { handleRequest } from "../src/web";
import { saveSeries } from "../src/series";
import { hourlyBars } from "../src/replay/scenario";
import type { Bar } from "../src/types";

const ENV = { STATUS_TOKEN: "status-token-0123456789" };
const usAsset = (symbol: string, name: string) => ({ id: "id-" + symbol, symbol, name, exchange: "NASDAQ", status: "active", tradable: true, class: "us_equity" });
const fmpFor = (events: Record<string, any[]>) => ({ income: async () => [], earningsCalendar: async () => new Map(), earningsFor: async (s: string) => events[s] ?? [] });

describe("Historischer Blindlauf (nachgebaute Testdaten, Beweiswert ausdrücklich NICHT belegt)", () => {
  it("der Scanner findet Formationen ohne Suchziele; erst danach wird ausgewertet", async () => {
    const r = await fixtureBlindRun();
    const last = r.usDates[r.usDates.length - 1];
    const rep = await evaluateTargets(r.d, "US", ["CROX", "ILMN", "NOPE"], last);
    const by = Object.fromEntries(rep.map((x) => [x.key, x]));
    // Crocs: im Universum, Daten, Vorauswahl, Rang, Formation, selbst berechnete Marke
    expect(by.CROX).toMatchObject({ inUniverse: true, enoughData: true, prefilterPassed: true });
    expect(by.CROX.rank).toBeGreaterThanOrEqual(1); expect(by.CROX.total).toBe(4);
    const c = by.CROX.setups.find((s) => s.setup === "earnings_consolidation" && s.state === "active")!;
    expect(c).toMatchObject({ trigger: 160, stop: 157.39, currency: "USD" }); expect(c.evidence.join(" ")).toMatch(/Hoch der abgeschlossenen Kerze vom 2026-11-24/);
    // Illumina
    const i = by.ILMN.setups.find((s) => s.setup === "ema_reclaim" && s.state === "active")!;
    expect(i.stop).toBe(197.39); expect(i.trigger).toBeGreaterThan(204.52);
    // Formationsloser Titel: kein Setup, erster Ausschlussgrund genannt
    expect(by.NOPE.setups.filter((x) => x.state === "active")).toHaveLength(0); expect(by.NOPE.firstExclusion).toMatch(/keine Formation erfüllt am Stichtag alle Bedingungen/);
    // Xetra
    const dl = r.deDates[r.deDates.length - 1];
    const de = (await evaluateTargets(r.d, "DE", ["XETR:SRT3", "XETR:GIBTESNICHT"], dl));
    const s = de[0].setups.find((x) => x.setup === "multiweek_base" && x.state === "active")!;
    expect(s).toMatchObject({ trigger: 298, currency: "EUR" }); expect(de[1].firstExclusion).toMatch(/nicht in der Instrumentenliste/);
    const text = renderReport(rep, FIXTURE_PROV);
    expect(text).toMatch(/Beweiswert: NICHT_BELEGT – KEIN historischer Echtdaten-Nachweis/); expect(text).toMatch(/erster Ausschlussgrund/);
  });
  it("kein Zukunftswissen: am 20.11. gibt es die später entstandene Marke 160 noch nicht; ihre Vorbereitung entsteht erst am 24.11.", async () => {
    const r = await fixtureBlindRun();
    const row = await one<any>(r.db, "SELECT created_at, trigger_price FROM prepared WHERE symbol='CROX' AND setup='earnings_consolidation' AND trigger_price=160");
    expect(row.created_at).toBeGreaterThanOrEqual(sessionFor("2026-11-24")!.close);
    const early = await all<any>(r.db, "SELECT trigger_price FROM prepared WHERE symbol='CROX' AND setup='earnings_consolidation' AND created_at < ?", sessionFor("2026-11-23")!.close);
    expect(early.map((x) => x.trigger_price)).not.toContain(160);
    // der Anbieter gibt im Blindlauf keine Kerzen nach dem Stichtag und keine 5-Minuten-Kerzen/Quotes preis
    const clipped = clipToAsOf(r.d.markets.US.data, sessionFor("2026-11-20")!.close);
    const b = await clipped.dailyBars(["CROX"], "2026-10-01", Date.parse("2026-12-01T00:00:00Z"));
    expect(Math.max(...b.bars.get("CROX")!.map((x) => x.end))).toBeLessThanOrEqual(sessionFor("2026-11-20")!.close);
    expect((await clipped.bars5(["CROX"], 0, 1)).size).toBe(0); expect((await clipped.quotes(["CROX"], 0)).get("CROX")!.quote).toBeNull();
  });
  it("Beweiswert wird nie überhöht: heutiger Bestand und erfundene Kurse sind nicht belegt", () => {
    expect(evidenceLevel({ universe: "current_assets", data: "historical_real" }).level).toBe("nicht_belegt");
    expect(evidenceLevel({ universe: "point_in_time", data: "fixture" }).level).toBe("nicht_belegt");
    expect(evidenceLevel({ universe: "point_in_time", data: "historical_real" }).level).toBe("belegt");
  });
  it("Xetra ohne Datenzugang: Auswertung nennt den fehlenden Zugang als ersten Grund", async () => {
    const db = createDb(); const d = makeDeps(db, cfgOf({ MARKETS: "US,DE", FX_USD_PER_EUR: "1.1", FX_DATE: "x", FX_SOURCE: "y" }), Date.parse("2026-11-24T17:00:00Z"));
    const [t] = await evaluateTargets(d, "DE", ["XETR:SRT3"], "2026-11-24");
    expect(t.firstExclusion).toMatch(/Datenzugang fehlt/);
  });
});

describe("Gegenproben", () => {
  async function run1(symbol: string, bars: Bar[], events: any[], px: { level: number; last: number; ask: number } | null) {
    const db = createDb(), mail = new FakeMail(), alp = new FakeAlpaca();
    alp.assetList = [usAsset(symbol, "Beispiel Unternehmen Inc. Common Stock")]; alp.rawD.set(symbol, toRawDaily(bars));
    const d = makeDeps(db, cfgOf({ MIN_RANGE_PCT: "1", MAX_STOP_PCT: "12" }), Date.parse(LAST + "T22:10:00Z"), { alpaca: alp, mail, fmp: fmpFor({ [symbol]: events }) });
    await saveSeries(db, "QQQ", "1h", hourlyBars("up", Date.parse("2026-11-03T20:30:00Z")), 1);
    await runDaily(d);
    if (px) {
      const s = sessionFor("2026-11-25")!; d.clock.t = s.open + 7 * 5 * MIN + 60_000;
      alp.raw5.set(symbol, five(s.open, s.open + 35 * MIN, (k: number) => (k < 6 ? px.level - 1.2 + 0.05 * k : px.last), () => 5000));
      alp.snaps.set(symbol, { latestQuote: { t: iso(d.clock.t - 4000), ap: px.ask, bp: px.ask - 0.05 }, latestTrade: { t: iso(d.clock.t - 3000), p: px.ask - 0.02 } });
      await runIntraday(d);
    }
    return { db, mail };
  }
  it("gleiche Formation bei anderem Ticker und anderem Kursniveau wird erkannt (Kurse ×0,62, Marke folgt den Daten)", async () => {
    const k = 0.62, scaled = croxDaily().map((b) => ({ ...b, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k }));
    const ev = [{ ...CROX_EVENT, symbol: "ZQXV" }];
    const trig = 160 * k;                                           // der Scanner kennt diese Zahl nicht; sie dient nur der Prüfung
    const w = await run1("ZQXV", scaled, ev, { level: trig, last: trig + 0.15, ask: trig + 0.2 });
    const p = await one<any>(w.db, "SELECT trigger_price, stop_price FROM prepared WHERE setup='earnings_consolidation' AND state='fired'");
    expect(p.trigger_price).toBeCloseTo(trig, 1); expect(p.stop_price).toBeCloseTo(157.39 * k, 1);
    expect(w.mail.sent.some((m) => m.subject === "Einstieg bestätigt · ZQXV · Konsolidierung nach Quartalszahlen")).toBe(true);
  });
  it("bekannter Ticker ohne passende Formation löst keinen Alarm aus – auch nicht bei Ausbruch und Quartalszahlen-Meldung", async () => {
    const w = await run1("CROX", noFormation(), [CROX_EVENT], { level: 160, last: 160.5, ask: 160.6 });
    expect(await all(w.db, "SELECT 1 FROM prepared WHERE state='active'")).toHaveLength(0);
    expect(await all(w.db, "SELECT 1 FROM signals")).toHaveLength(0);
    expect(w.mail.sent.some((m) => /^(Einstieg|Nur beobachten|Vorwarnung)/.test(m.subject))).toBe(false);
  });
  it("bekannter Ticker, Formation noch nicht fertig (Konsolidierung zu kurz): kein Alarm", async () => {
    const cut = croxDaily().slice(0, croxDaily().findIndex((b) => b.o === 138) + 4);               // Gap-Tag + 3 Tage
    const w = await run1("CROX", cut, [CROX_EVENT], { level: 160, last: 160.5, ask: 160.6 });
    expect((await all<any>(w.db, "SELECT setup FROM prepared")).map((r) => r.setup)).not.toContain("earnings_consolidation");
    expect(w.mail.sent.some((m) => /^(Einstieg|Nur beobachten)/.test(m.subject))).toBe(false);
  });
});

describe("Paper-Protokoll: Zeitpunkte und Entscheidungen getrennt, vor dem weiteren Kursverlauf gespeichert", () => {
  async function paperWorld() {
    const db = createDb(), mail = new FakeMail(), alp = new FakeAlpaca();
    alp.assetList = [usAsset("CROX", "Crocs Inc. Common Stock")]; alp.rawD.set("CROX", toRawDaily(croxDaily()));
    const d = makeDeps(db, cfgOf({ MODE: "paper", MIN_RANGE_PCT: "1" }), Date.parse(LAST + "T22:10:00Z"), { alpaca: alp, mail, fmp: fmpFor({ CROX: [CROX_EVENT] }) });
    await saveSeries(db, "QQQ", "1h", hourlyBars("up", Date.parse("2026-11-03T20:30:00Z")), 1);
    await runDaily(d);
    const s = sessionFor("2026-11-25")!; d.clock.t = s.open + 35 * MIN + 60_000 + 7_000;
    alp.raw5.set("CROX", five(s.open, s.open + 35 * MIN, (k: number) => (k < 6 ? 158.8 + 0.05 * k : 160.15), () => 5000));
    alp.snaps.set("CROX", { latestQuote: { t: iso(d.clock.t - 4000), ap: 160.25, bp: 160.2 }, latestTrade: { t: iso(d.clock.t - 3000), p: 160.23 } });
    await runIntraday(d);
    return { db, mail, d, s };
  }
  it("Kerzenschluss, Datenverfügbarkeit, Triggererkennung, letzter Kurs und Mailannahme sind getrennte Zeitstempel", async () => {
    const { db, d, s } = await paperWorld();
    const sig = await one<any>(db, "SELECT signal_time, data_available_at, detected_at, quote_time, checked_at, outbox_id, mode FROM signals");
    expect(sig.mode).toBe("paper");
    expect(sig.signal_time).toBe(s.open + 35 * MIN);                                   // Kerzenschluss 10:05 NY
    expect(sig.data_available_at).toBeGreaterThanOrEqual(sig.signal_time);              // Kerzen waren erst später abrufbar
    expect(sig.detected_at).toBeGreaterThanOrEqual(sig.data_available_at); expect(sig.checked_at).toBeGreaterThanOrEqual(sig.detected_at);
    expect(sig.quote_time).toBeLessThan(sig.checked_at);                                // letzter geprüfter Kurs ist älter als die Prüfung
    const ob = await one<any>(db, "SELECT state, accepted_at, provider_id FROM outbox WHERE id=?", sig.outbox_id);
    expect(ob).toMatchObject({ state: "dry_run", accepted_at: null, provider_id: null });   // Paper: keine Annahme behauptet
    expect((await all(db, "SELECT 1 FROM positions WHERE status='open'")).length).toBe(0); // Kaufbestätigung getrennt: noch keine
    expect(d.cfg.mode).toBe("paper");
  });
  it("Kandidaten und Marken sind VOR dem Trigger protokolliert und unveränderlich", async () => {
    const { db } = await paperWorld();
    const cand = await one<any>(db, "SELECT recorded_at, rank FROM candidate_log WHERE inst_key='CROX'");
    const prep = await one<any>(db, "SELECT created_at, trigger_price FROM prepared WHERE setup='earnings_consolidation'");
    const sig = await one<any>(db, "SELECT signal_time FROM signals");
    expect(cand.recorded_at).toBeLessThan(sig.signal_time); expect(prep.created_at).toBeLessThan(sig.signal_time); expect(prep.trigger_price).toBe(160);
    await expect(run(db, "UPDATE candidate_log SET rank=99")).rejects.toThrow(/unveränderlich/);
    await expect(run(db, "DELETE FROM candidate_log")).rejects.toThrow(/unveränderlich/);
  });
  it("Statusseite zeigt das Paper-Protokoll und weist aus: Annahme durch Gmail ≠ Eingang", async () => {
    const { db, d } = await paperWorld();
    await run(db, "UPDATE outbox SET state='sent', provider_id='18c0ffee', accepted_at=? WHERE kind='entry'", d.now());
    const html = await (await handleRequest(new Request("https://x.example/status", { headers: { authorization: "Bearer " + ENV.STATUS_TOKEN } }), d, ENV)).text();
    expect(html).toMatch(/Paper-Protokoll/); expect(html).toMatch(/Kerzenschluss/); expect(html).toMatch(/Daten verfügbar/); expect(html).toMatch(/Trigger erkannt/); expect(html).toMatch(/letzter Kurs/);
    expect(html).toMatch(/von Gmail angenommen/); expect(html).toMatch(/Annahme ≠ Eingang/);
    const j: any = await (await handleRequest(new Request("https://x.example/status.json", { headers: { authorization: "Bearer " + ENV.STATUS_TOKEN } }), d, ENV)).json();
    expect(j.paper[0]).toHaveProperty("data_available_at"); expect(j.note).toMatch(/Eingang/);
  });
});

describe("Normalbetrieb ohne tägliche manuelle Freigabe (automatische Marktvorgabe)", () => {
  it("Marktlage bärisch → ‚Nur beobachten‘ mit automatischen Gründen; dreht sie, wird derselbe Trigger zulässig – ohne Formular", async () => {
    const db = createDb(), mail = new FakeMail(), alp = new FakeAlpaca();
    alp.assetList = [usAsset("CROX", "Crocs Inc. Common Stock")]; alp.rawD.set("CROX", toRawDaily(croxDaily()));
    const d = makeDeps(db, cfgOf({ AUTO_STANCE: "true", MIN_RANGE_PCT: "1" }), Date.parse(LAST + "T22:10:00Z"), { alpaca: alp, mail, fmp: fmpFor({ CROX: [CROX_EVENT] }) });
    await saveSeries(db, "QQQ", "1h", hourlyBars("up", Date.parse("2026-11-03T20:30:00Z")), 1);
    await runDaily(d);
    const bear = { asof: LAST, breadth: { asof: LAST, universe: "u", period: "p", source: "s", n: 3000, newHighs: 123, newLows: 465, above50Pct: 28, above200Pct: 40 }, leadership: { asof: LAST, source: "s", period: "p", leaders: [], growthLeading: false }, ftd: [], thinWeek: "", text: ["Marktbreite (Testdaten): 123 neue Hochs vs. 465 neue Tiefs"] };
    await setMeta(db, "regime:US", bear, 1);
    const s = sessionFor("2026-11-25")!; d.clock.t = s.open + 7 * 5 * MIN + 60_000;
    const go = (last: number, ask: number) => { alp.raw5.set("CROX", five(s.open, s.open + 35 * MIN, (k: number) => (k < 6 ? 158.8 + 0.05 * k : last), () => 5000)); alp.snaps.set("CROX", { latestQuote: { t: iso(d.clock.t - 4000), ap: ask, bp: ask - 0.05 }, latestTrade: { t: iso(d.clock.t - 3000), p: ask - 0.02 } }); };
    go(160.15, 160.25); await runIntraday(d);
    const w = mail.sent.find((m) => m.subject.startsWith("Nur beobachten"))!;
    expect(w.text).toMatch(/Marktvorgabe \(automatisch aus der Marktlage/); expect(w.text).toMatch(/neue Hochs\/Tiefs 123\/465/); expect(w.text).not.toMatch(/\/a\//);
    await setMeta(db, "regime:US", { ...bear, breadth: { ...bear.breadth, newHighs: 500, newLows: 60, above50Pct: 71 }, leadership: { ...bear.leadership, growthLeading: true } }, 2);
    await setMeta(db, "sp_context", { at: d.now(), ctx: { state: "über", obsDate: "2026-11-23", close: 7237.17, sma200: 6700, lastCompleted: "2026-11-24", isLastCompleted: false, text: "S&P 500 über SMA200" } }, 3);
    d.clock.t += 10 * MIN; go(160.2, 160.3); await runIntraday(d);
    expect(mail.sent.filter((m) => m.subject.startsWith("Einstieg bestätigt"))).toHaveLength(1);
  });
  it("veraltete Marktlage → Standard Cash, ausdrücklich begründet", async () => {
    const db = createDb(), d = makeDeps(db, cfgOf({ AUTO_STANCE: "true" }), Date.parse("2026-11-25T15:00:00Z"));
    await setMeta(db, "regime:US", { asof: "2026-11-10", breadth: null, leadership: null, ftd: [], thinWeek: "", text: [] }, 1);
    const { getStance, stanceText } = await import("../src/permission");
    const st = await getStance(d, "US");
    expect(st).toMatchObject({ stance: "cash", source: "stale_default" }); expect(stanceText(d.cfg, st)).toMatch(/fehlenden\/veralteten Marktdaten/);
  });
});
