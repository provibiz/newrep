/**
 * Historische Abnahmefälle aus dem Report vom 25.11.2026: Crocs, Sartorius, Illumina – plus die drei Entscheidungsstufen,
 * Marktlage und „Trigger erreicht, Depot bleibt in Cash“. Alle Kursmarken stehen in test/fixtures/siebenhaar.ts.
 */
import { describe, it, expect } from "vitest";
import { createDb, cfgOf, makeDeps, FakeMail } from "./helpers";
import { buildScenario, hourlyBars, five, T } from "../src/replay/scenario";
import { croxDaily, sartoriusDaily, illuminaDaily, toRawDaily, CROX_EVENT, SRT_ISIN, CROX_GAP_DAY, LAST } from "./fixtures/siebenhaar";
import { prepare, dailyParams, checkTrigger, checkDayCloseTrigger, emaReclaimProgress, emaSeries, stopBelow, runningHour } from "../src/patterns";
import { runDaily } from "../src/jobs/daily";
import { runIntraday } from "../src/jobs/intraday";
import { saveSeries } from "../src/series";
import { all, one, run } from "../src/store";
import { iso, MIN, HOUR, nyToUtc } from "../src/time";
import { sessionFor } from "../src/calendar";
import { checkSupport, isValidIsin, CAPABILITIES } from "../src/instruments";
import { checkEntry } from "../src/entry";
import { importIdea } from "../src/ideas";
import { decidePermission, setStance, getStance } from "../src/permission";
import { qqqDecision } from "../src/market";
import { breadthFrom, leadership, followThroughDay, thinWeek, describeRegime, REGIME_ETFS } from "../src/regime";
import { updateRegime } from "../src/jobs/regime";
import { sizePosition } from "../src/sizing";
import { handleRequest } from "../src/web";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunningBar } from "../src/types";

const base = (over: Record<string, unknown> = {}) => cfgOf({ MAX_STOP_PCT: "12", ...over });
const P = dailyParams(base());
const run0 = (o: Partial<RunningBar> = {}): RunningBar => ({ start: 0, o: 100, h: 100, l: 100, c: 100, v: 0, elapsedMin: 30, lastEnd: 0, periodMin: 390, ...o });

// ─────────────────────────── Welt für End-zu-Ende-Tests ───────────────────────────
async function world(o: { symbol: string; name: string; bars: ReturnType<typeof croxDaily>; asof: string; cfg?: Record<string, unknown>; events?: any[] }) {
  const db = createDb(), mail = new FakeMail(), sc = buildScenario();
  sc.alpaca.assetList = [{ id: "id-" + o.symbol, symbol: o.symbol, name: o.name, exchange: "NASDAQ", status: "active", tradable: true, class: "us_equity" }];
  sc.alpaca.rawD.clear(); sc.alpaca.rawD.set(o.symbol, toRawDaily(o.bars));
  const fmp = { income: async () => [], earningsCalendar: async () => new Map(), earningsFor: async () => o.events ?? [] };
  const d = makeDeps(db, base(o.cfg), Date.parse(o.asof + "T22:10:00Z"), { alpaca: sc.alpaca, mail, fmp });
  await saveSeries(db, "QQQ", "1h", hourlyBars("up", Date.parse("2026-11-03T20:30:00Z")), 1);
  await runDaily(d);
  return { db, mail, sc, d };
}
const morning = (day: string, n = 7) => { const s = sessionFor(day)!; return { s, now: s.open + n * 5 * MIN + 60_000 }; };
function breakout5(symbol: string, sc: any, day: string, level: number, last: number, ask: number, d: any) {
  const { s } = morning(day);
  sc.alpaca.raw5.set(symbol, five(s.open, s.open + 35 * MIN, (k: number) => (k < 6 ? level - 1.2 + 0.05 * k : last), () => 5000));
  sc.alpaca.snaps.set(symbol, { latestQuote: { t: iso(d.clock.t - 4000), ap: ask, bp: ask - 0.05 }, latestTrade: { t: iso(d.clock.t - 3000), p: ask - 0.02 } });
}

// ═══════════════════════════════ CROCS ═══════════════════════════════
describe("Crocs – Konsolidierung nach Quartalszahlen mit Inside Day", () => {
  const H = croxDaily();
  it("weder Zahlenmeldung noch erste Kurslücke noch die Tage danach bereiten den Einstieg vor", () => {
    const gapIdx = H.findIndex((b) => b.o === 138.0);
    expect(new Date(H[gapIdx].end - 8 * HOUR).toISOString().slice(0, 10)).toBe(CROX_GAP_DAY);
    for (let k = gapIdx; k <= gapIdx + 4; k++) {      // Gap-Tag bis Tag 4: Mindest-Konsolidierung (5 Tage) fehlt
      expect(prepare(H.slice(0, k + 1), "1d", P, { events: [CROX_EVENT] }).map((x) => x.setup), `Tag ${k - gapIdx}`).not.toContain("earnings_consolidation");
    }
    expect(prepare(H.slice(0, gapIdx), "1d", P, { events: [CROX_EVENT] }).map((x) => x.setup)).not.toContain("earnings_consolidation");   // vor der Lücke: nur Zahlenmeldung bekannt
  });
  it("ohne belegten Katalysator oder mit unklarer Uhrzeit am Gap-Tag keine Vorbereitung", () => {
    expect(prepare(H, "1d", P, { events: [] }).map((x) => x.setup)).not.toContain("earnings_consolidation");
    expect(prepare(H, "1d", P).map((x) => x.setup)).not.toContain("earnings_consolidation");
    const unclear = { ...CROX_EVENT, date: CROX_GAP_DAY, timing: null };          // nur Datum am Gap-Tag
    expect(prepare(H, "1d", P, { events: [unclear] }).map((x) => x.setup)).not.toContain("earnings_consolidation");
  });
  it("vorbereitet: Trigger über 160 am Inside Day, Stopp-Bezug eindeutig (Tagestief des Inside Days, Modellannahme dokumentiert)", () => {
    const p = prepare(H, "1d", P, { events: [CROX_EVENT] }).find((x) => x.setup === "earnings_consolidation")!;
    expect(p.trigger).toBe(160);
    expect(p.stop).toBe(157.39);
    expect(p.stopBasis).toMatch(/Tagestief des Inside Days vom 2026-11-24 \(157\.40\)/);
    expect(p.stopBasis).toMatch(/Modellannahme/);
    expect(p.conditions.join(" ")).toMatch(/lösen keinen Einstieg aus/);
    expect(checkTrigger(p, run0({ c: 160.15, l: 158.9 })).fired).toBe(true);
    expect(checkTrigger(p, run0({ c: 159.9, l: 158.9 })).fired).toBe(false);
  });
  it("Stopp-Basis konfigurierbar: Tagestief des Ausbruchstags statt Inside Day", () => {
    const p = prepare(H, "1d", dailyParams(base({ ERC_STOP_BASIS: "breakout_day" })), { events: [CROX_EVENT] }).find((x) => x.setup === "earnings_consolidation")!;
    expect(checkTrigger(p, run0({ c: 160.15, l: 158.9 })).stop).toBe(stopBelow(158.9));
  });
  it("Zahlenmeldung/Gap-Tag lösen im Gesamtlauf nichts aus (Tageslauf am Gap-Tag, Ausbruch am Folgetag)", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: croxDaily("2026-11-03"), asof: "2026-11-03", events: [CROX_EVENT] });
    w.d.clock.t = morning("2026-11-04").now;
    breakout5("CROX", w.sc, "2026-11-04", 170, 171, 171.2, w.d);
    await runIntraday(w.d);
    expect(await all(w.db, "SELECT 1 FROM prepared WHERE setup='earnings_consolidation'")).toHaveLength(0);
    expect(await all(w.db, "SELECT 1 FROM signals WHERE setups LIKE '%earnings_consolidation%'")).toHaveLength(0);
    expect(w.mail.sent.some((m) => /Konsolidierung nach Quartalszahlen/.test(m.subject))).toBe(false);
  });

  it("Gesamtlauf: Ausbruch über 160 → ‚Einstieg bestätigt‘ mit drei Stufen, Stopp-Bezug und Modell-Kennzeichnung", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: H, asof: LAST, events: [CROX_EVENT] });
    expect(await all(w.db, "SELECT setup, trigger_price, stop_price FROM prepared WHERE setup='earnings_consolidation'")).toMatchObject([{ trigger_price: 160, stop_price: 157.39 }]);
    expect(w.mail.sent.some((m) => m.subject.startsWith("Vorwarnung") && /Konsolidierung nach Quartalszahlen/.test(m.subject))).toBe(true);
    w.d.clock.t = morning("2026-11-25").now;
    breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d);
    await runIntraday(w.d);
    const m = w.mail.sent.find((x) => x.subject.startsWith("Einstieg"))!;
    expect(m.subject).toBe("Einstieg bestätigt · CROX · Konsolidierung nach Quartalszahlen");
    expect(m.text).toMatch(/1\. Setup vorbereitet: .* – ja/); expect(m.text).toMatch(/2\. Technischer Trigger erreicht: .* – ja/); expect(m.text).toMatch(/3\. Einstieg nach Markt- und Risikoregeln zulässig: JA/);
    expect(m.text).toMatch(/Stopp-Bezug: Tagestief des Inside Days vom 2026-11-24/);
    expect(m.text).toMatch(/Modellentscheidung des Bots/); expect(m.text).toMatch(/keine ausgeführte Order/);
    expect(m.text).toMatch(/\/a\/[A-Za-z0-9_-]+/);                                       // Kaufbestätigung nur bei zulässigem Einstieg
    const sig = (await all<any>(w.db, "SELECT * FROM signals"))[0];
    expect(sig).toMatchObject({ status: "confirmed", permission: "permitted", origin: "model" });
    expect(sig.prepared_at).toBeLessThan(sig.signal_time);                               // Stufe 1 liegt vor Stufe 2, getrennt gespeichert
  });

  it("‚Trigger erreicht, Depot bleibt in Cash‘: Betreff „Nur beobachten“, Grund genannt, KEIN Kauf-Link, keine Position", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: H, asof: LAST, events: [CROX_EVENT], cfg: { MARKET_STANCE: "cash", STANCE_NOTE: "Erholungsversuch im Abwärtstrend, Breite und Führung fehlen" } });
    w.d.clock.t = morning("2026-11-25").now;
    breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d);
    await runIntraday(w.d);
    const m = w.mail.sent.find((x) => x.subject.startsWith("Nur beobachten"))!;
    expect(m.subject).toBe("Nur beobachten · CROX · Konsolidierung nach Quartalszahlen");
    expect(m.text.split("\n")[0]).toMatch(/NUR BEOBACHTEN – kein Einstieg/);
    expect(m.text).toMatch(/Grund: Marktvorgabe: Cash/); expect(m.text).toMatch(/Erholungsversuch im Abwärtstrend/); expect(m.text).toMatch(/Depot bleibt in Cash/);
    expect(m.text).toMatch(/3\. Einstieg nach Markt- und Risikoregeln zulässig: NEIN/);
    expect(m.text).not.toMatch(/\/a\/|Kaufbestätigung bestätigen|Gekauft\?|Stückzahl:/);
    expect(m.text).toMatch(/keine Stückzahl, kein Kauf-Link/);
    expect(w.mail.sent.some((x) => x.subject.startsWith("Einstieg"))).toBe(false);
    expect(await all(w.db, "SELECT 1 FROM positions")).toHaveLength(0);
    expect(await all(w.db, "SELECT 1 FROM tokens")).toHaveLength(0);
    expect((await one<any>(w.db, "SELECT status, permission FROM signals"))).toMatchObject({ status: "watch_only", permission: "watch_only" });
    const n = w.mail.sent.length; w.d.clock.t += 5 * MIN; breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d); await runIntraday(w.d);
    expect(w.mail.sent.length).toBe(n);                                                   // keine Wiederholung am selben Tag
    // Marktvorgabe später auf „offen“: derselbe vorbereitete Trigger kann zulässig werden
    await setStance(w.d, "open", "Marktlage gedreht", { hours: 24 });
    w.d.clock.t += 5 * MIN; breakout5("CROX", w.sc, "2026-11-25", 160, 160.2, 160.3, w.d); await runIntraday(w.d);
    expect(w.mail.sent.some((x) => x.subject.startsWith("Einstieg bestätigt"))).toBe(true);
  });
});

// ═══════════════════════════════ SARTORIUS ═══════════════════════════════
describe("Sartorius – mehrwöchige Basis im Tageschart, EUR, Xetra", () => {
  const H = sartoriusDaily();
  it("Trigger liegt über 298 EUR (Hoch des Inside Days); 300 EUR bleibt Kontext", () => {
    const ps = prepare(H, "1d", P);
    const p = ps.find((x) => x.setup === "multiweek_base")!;
    expect(p).toBeTruthy();
    expect(p.trigger).toBe(298);
    expect(p.trigger).toBeGreaterThanOrEqual(298);
    expect(p.contextLevels).toEqual([{ level: 300, label: "Basishoch/Marke – Kontext, KEIN Trigger" }]);
    expect(p.stopBasis).toMatch(/Tagestief des Inside Days vom 2026-11-24 \(291\.50\)/);
    expect(ps.map((x) => x.setup)).not.toContain("base_breakout");                       // generischer Basisausbruch (Trigger ≈ 300) wird ersetzt
    expect(checkTrigger(p, run0({ c: 298.1, l: 296 })).fired).toBe(true);
    expect(checkTrigger(p, run0({ c: 297.9, l: 296 })).fired).toBe(false);
  });
  it("mehrwöchig = konfigurierbare Mindestdauer: strengere Vorgabe verwirft die Basis", () => {
    expect(prepare(H, "1d", dailyParams(base({ MWB_MIN_DAYS: "40" }))).map((x) => x.setup)).not.toContain("multiweek_base");
  });
  it("Datenabdeckung: Anbieter, Wertpapierkennung, Handelsplatz, Kalender, Währung → „Markt nicht unterstützt“", () => {
    expect(isValidIsin(SRT_ISIN)).toBe(true);
    const s = checkSupport({ symbol: "SRT3", name: "Sartorius AG Vz.", isin: SRT_ISIN, venue: "XETR", currency: "EUR" });
    expect(s.label).toBe("Markt nicht unterstützt"); expect(s.supported).toBe(false);
    expect(s.checks.map((c) => c.name)).toEqual(["Datenanbieter", "Wertpapierkennung", "Handelsplatz", "Handelskalender", "Währung"]);
    expect(s.checks.every((c) => !c.ok)).toBe(true);
    expect(s.summary).toMatch(/Xetra/); expect(s.summary).toMatch(/Handelskalender/); expect(s.summary).toMatch(/EUR/);
    expect(checkSupport({ symbol: "AAPL", venue: "XNAS", currency: "USD" }).label).toBe("Markt unterstützt");
    expect(CAPABILITIES.provider.venues).not.toContain("XETR");
  });
  it("kein US-Ersatzkurs für einen EUR-Trigger", () => {
    const cfg = base(); const now = 1_000_000_000_000;
    expect(checkEntry(cfg, 298, 291.49, { price: 321.4, time: now - 2000, kind: "ask", currency: "USD" }, now, "EUR").status).toBe("currency_mismatch");
    expect(checkEntry(cfg, 298, 291.49, { price: 298.4, time: now - 2000, kind: "ask", currency: "EUR" }, now, "EUR").status).toBe("confirmed");
  });
  it("als Watchlist-Idee importiert: ‚Markt nicht unterstützt‘, nie ein Trigger, sichtbar in der Statusansicht", async () => {
    const db = createDb(), mail = new FakeMail(), d = makeDeps(db, base(), Date.parse(LAST + "T22:10:00Z"), { mail });
    const r = await importIdea(d, { instrument: { symbol: "SRT3", name: "Sartorius AG Vz.", isin: SRT_ISIN, venue: "XETR", currency: "EUR" }, setup: "multiweek_base", trigger: 298, stop: 291.49, stopBasis: "Tagestief des Inside Days (Quelle lässt den Tag offen)", source: "TraderMacher-Report vom 25.11.2026", publishedAt: Date.parse("2026-11-25T08:38:35Z") });
    expect(r.state).toBe("unsupported"); expect(r.support.label).toBe("Markt nicht unterstützt");
    d.clock.t = morning("2026-11-25").now;
    expect(await runIntraday(d)).toMatch(/0 Kandidaten/);
    expect(await all(db, "SELECT 1 FROM signals")).toHaveLength(0);
    const html = await (await handleRequest(new Request("https://x.example/status", { headers: { authorization: "Bearer status-token-0123456789" } }), d, { STATUS_TOKEN: "status-token-0123456789" })).text();
    expect(html).toMatch(/Markt nicht unterstützt/); expect(html).toMatch(/keine Bot-Entscheidung, kein Trade/);
  });
});

// ═══════════════════════════════ ILLUMINA ═══════════════════════════════
describe("Illumina – EMA-Reclaim (getrennt vom EMA-Crossback)", () => {
  const H = illuminaDaily();
  const idx = (d: string) => H.findIndex((b) => new Date(b.end - 8 * HOUR).toISOString().slice(0, 10) === d);
  it("Der Rücktest aufs alte Niveau erzeugt die VORWARNUNG – der Einstieg bleibt bis zur Stabilisierung gesperrt", () => {
    const retest = H.slice(0, idx("2026-11-18") + 1);
    const pr = emaReclaimProgress(retest, P);
    expect(pr).toMatchObject({ retest: true, belowEmas: true }); expect(pr.level).toBeCloseTo(200.8, 5); expect(pr.sidewaysDays).toBeLessThan(P.reclaim.minSideways);
    const p = prepare(retest, "1d", P).find((x) => x.setup === "ema_reclaim")!;
    expect(p).toBeTruthy(); expect(p.extra!.stabilizing).toBe(true);
    expect(p.conditions.join(" ")).toMatch(/nur die Vorbereitung \(Vorwarnung\)/); expect(p.pending.join(" ")).toMatch(/ist der Einstieg gesperrt/);
    expect(checkTrigger(p, run0({ c: p.trigger + 5, l: 203 })).blocked).toMatch(/Stabilisierung/);                    // selbst ein Schluss über den EMAs löst noch nichts aus
    expect(checkDayCloseTrigger({ ...p, needsDayClose: true }, run0({ c: p.trigger + 5, l: 203 })).blocked).toMatch(/Stabilisierung/);
  });
  it("nach der Seitwärtsphase vorbereitet: Trigger = Rückeroberung von EMA10/EMA20, Stopp unter dem Konsolidierungstief", () => {
    const p = prepare(H, "1d", P).find((x) => x.setup === "ema_reclaim")!;
    expect(p).toBeTruthy();
    const c = H.map((b) => b.c), e10 = emaSeries(c, 10).at(-1)!, e20 = emaSeries(c, 20).at(-1)!;
    expect(p.trigger).toBeCloseTo(Math.max(e10, e20), 8);
    expect(H.at(-1)!.c).toBeLessThan(Math.min(e10, e20));
    expect(p.stop).toBe(stopBelow(197.4));                                              // Tief der Konsolidierung, nicht das Rücklauf-Niveau 200
    expect(p.stopBasis).toMatch(/Tief der Konsolidierung vom 2026-11-18 \(197\.40\)/);
    expect(p.conditions.join(" ")).toMatch(/nur die Vorbereitung/); expect(p.conditions.join(" ")).toMatch(/Modellannahme: mindestens 3 Tage/);
    expect(p.pending.join(" ")).toMatch(/legt keine Schlusskursbestätigung fest/);
  });
  it("Anzahl Seitwärtstage ist konfigurierbar", () => {
    const get = (n: string) => prepare(H, "1d", dailyParams(base({ EMA_RECLAIM_MIN_SIDEWAYS_DAYS: n }))).find((x) => x.setup === "ema_reclaim")!;
    expect(get("5").extra!.stabilizing).toBe(false);                    // 5 Seitwärtstage vorhanden → Einstieg möglich
    expect(get("6").extra!.stabilizing).toBe(true);                     // strengere Vorgabe: noch nicht stabil → gesperrt, aber vorgewarnt
  });
  it("Bestätigungsart konfigurierbar: 5-Minuten-Schluss (Standard) oder Tagesschluss", () => {
    const intraday = prepare(H, "1d", P).find((x) => x.setup === "ema_reclaim")!;
    expect(intraday.needsDayClose).toBe(false);
    expect(checkTrigger(intraday, run0({ c: intraday.trigger + 0.2, l: 203 })).fired).toBe(true);
    const daily = prepare(H, "1d", dailyParams(base({ EMA_RECLAIM_CONFIRM: "daily_close" }))).find((x) => x.setup === "ema_reclaim")!;
    expect(daily.needsDayClose).toBe(true);
    expect(checkTrigger(daily, run0({ c: daily.trigger + 5, l: 203 })).fired).toBe(false);                    // intraday zählt nicht
    expect(checkDayCloseTrigger(daily, run0({ c: daily.trigger + 0.1, l: 203 })).fired).toBe(true);
    expect(checkDayCloseTrigger(daily, run0({ c: daily.trigger - 0.1, l: 203 })).fired).toBe(false);
    expect(daily.pending.join(" ")).toMatch(/Tagesschluss/);
  });
  it("EMA-Reclaim und EMA-Crossback schließen sich aus", () => {
    expect(prepare(H, "1d", P).map((x) => x.setup)).not.toContain("ema_crossback");
    const up = Array.from({ length: 70 }, (_, i) => 100 + 0.4 * i);
    for (let k = 0; k < 40; k++) up[69] = emaSeries(up, 20).at(-1)! * 1.01;
    const bars = up.map((c, i) => ({ end: Date.parse("2026-01-02T21:00:00Z") + i * 86_400_000, o: i ? up[i - 1] : c, h: Math.max(c, i ? up[i - 1] : c) + 0.1, l: Math.min(c, i ? up[i - 1] : c) - 0.1, c, v: 1000 }));
    const names = prepare(bars, "1d", P).map((x) => x.setup);
    expect(names).toContain("ema_crossback"); expect(names).not.toContain("ema_reclaim");
  });
  it("Gesamtlauf (Standard): 5-Minuten-Schluss über EMA10/EMA20 → Einstieg; die Rückkehr aufs alte Niveau davor löst nichts aus", async () => {
    const w = await world({ symbol: "ILMN", name: "Illumina Inc. Common Stock", bars: H, asof: LAST });
    const prep = await one<any>(w.db, "SELECT trigger_price FROM prepared WHERE setup='ema_reclaim'");
    expect(prep.trigger_price).toBeGreaterThan(204.52);
    w.d.clock.t = morning("2026-11-25").now;
    breakout5("ILMN", w.sc, "2026-11-25", prep.trigger_price - 1, 203, 203.1, w.d);          // bleibt unter den EMAs
    await runIntraday(w.d); expect(w.mail.sent.some((m) => m.subject.startsWith("Einstieg"))).toBe(false);
    w.d.clock.t += 5 * MIN; breakout5("ILMN", w.sc, "2026-11-25", prep.trigger_price - 1, prep.trigger_price + 0.2, prep.trigger_price + 0.3, w.d);
    await runIntraday(w.d);
    expect(w.mail.sent.some((m) => m.subject === "Einstieg bestätigt · ILMN · EMA-Reclaim")).toBe(true);
  });
  it("Gesamtlauf (Tagesschluss-Modus): erst die vollständige Tageskerze über den EMAs bestätigt", async () => {
    const w = await world({ symbol: "ILMN", name: "Illumina Inc. Common Stock", bars: H, asof: LAST, cfg: { EMA_RECLAIM_CONFIRM: "daily_close" } });
    const trig = (await one<any>(w.db, "SELECT trigger_price FROM prepared WHERE setup='ema_reclaim'")).trigger_price;
    const s = sessionFor("2026-11-25")!;
    w.sc.alpaca.raw5.set("ILMN", five(s.open, s.close, (k: number) => (k < 60 ? trig + 1 : trig + 0.4), () => 5000));    // intraday weit darüber, Schluss knapp darüber
    w.d.clock.t = morning("2026-11-25", 30).now;
    w.sc.alpaca.snaps.set("ILMN", { latestQuote: { t: iso(w.d.clock.t - 3000), ap: trig + 1.1, bp: trig + 1 } });
    await runIntraday(w.d); expect(w.mail.sent.some((m) => /^(Einstieg bestätigt|Nur beobachten)/.test(m.subject))).toBe(false);   // mittags kein Signal
    w.d.clock.t = s.close + 70_000;
    w.sc.alpaca.snaps.set("ILMN", { latestQuote: { t: iso(w.d.clock.t - 3000), ap: trig + 0.45, bp: trig + 0.4 }, latestTrade: { t: iso(w.d.clock.t - 3000), p: trig + 0.42 } });
    await runIntraday(w.d);
    expect(w.mail.sent.some((m) => m.subject === "Einstieg bestätigt · ILMN · EMA-Reclaim")).toBe(true);
  });
});

// ═══════════════════════════════ MARKTLAGE ═══════════════════════════════
describe("Marktzustand getrennt vom einzelnen Chart", () => {
  it("Breite: Zahlen mit Universum, Zeitraum und Datenquelle; kein Freigabe-Schwellenwert", () => {
    const b = breadthFrom({ n: 3100, nh: 123, nl: 465, a50: 900, a200: 1100 }, "2026-11-24", "Alpaca-Tageskerzen (SIP, Split-bereinigt)")!;
    const text = describeRegime({ breadth: b, leadership: null, ftd: [], thinWeek: thinWeek("2026-11-25") }).join("\n");
    expect(text).toMatch(/123 neue 52-Wochen-Hochs vs\. 465 neue Tiefs/); expect(text).toMatch(/Universum: Nasdaq-\/NYSE-Stammaktien/); expect(text).toMatch(/Zeitraum: 52 Wochen/); expect(text).toMatch(/Quelle: Alpaca-Tageskerzen/);
    expect(text).not.toMatch(/Schwelle|Freigabe ab|ab \d+ neuen/i);
    expect(breadthFrom({ n: 0, nh: 0, nl: 0, a50: 0, a200: 0 }, "x", "y")).toBeNull();
  });
  it("verkürzte Handelstage der Thanksgiving-Woche", () => {
    const t = thinWeek("2026-11-25");
    expect(t).toMatch(/Do 26\.11\. geschlossen \(Thanksgiving\)/); expect(t).toMatch(/Fr 27\.11\. verkürzt/);
    expect(thinWeek("2026-11-17")).toMatch(/keine verkürzten/);
  });
  it("Führungsgruppen: Wachstumsgruppen führen nicht, wenn Defensive vorn liegen", () => {
    const mk = (r: number) => Array.from({ length: 70 }, (_, i) => ({ end: i, o: 1, h: 1, l: 1, c: 100 * (1 + (r * i) / 69), v: 1 }));
    const m = new Map([["SPY", mk(0.02)], ["XLV", mk(0.12)], ["XLU", mk(0.1)], ["XLP", mk(0.08)], ["XLK", mk(0.0)], ["XLY", mk(-0.02)], ["XLC", mk(0.01)], ["XLF", mk(0.02)]]);
    const l = leadership(m, base(), "2026-11-24", "Test")!;
    expect(l.leaders.slice(0, 3).map((x) => x.symbol)).toEqual(["XLV", "XLU", "XLP"]); expect(l.growthLeading).toBe(false);
  });
  it("Follow-Through-Day wird erfasst, ist aber ausdrücklich nicht allein maßgeblich", () => {
    const closes = [...Array.from({ length: 30 }, (_, i) => 100 - i * 0.3), 91.5, 92, 92.4, 92.2, 94.0];
    const bars = closes.map((c, i) => ({ end: i, o: c, h: c, l: c, c, v: i === closes.length - 1 ? 2000 : 1000 }));
    const f = followThroughDay("QQQ", [...Array.from({ length: 10 }, () => bars[0]), ...bars], base());
    expect(f.state).toBe("Follow-Through-Day"); expect(f.text).toMatch(/allein kein Freigabe-Signal/);
  });
  it("Tageslauf speichert die Marktlage; Mail zeigt sie, die Marktvorgabe bleibt eine Nutzerentscheidung", async () => {
    const db = createDb(), sc = buildScenario(), d = makeDeps(db, base(), T.daily, { alpaca: sc.alpaca });
    for (let i = 0; i < 12; i++) await run(db, "INSERT INTO metrics (symbol,asof,price,passed,updated_at,nh,nl,a50,a200,n252) VALUES (?,?,?,?,?,?,?,?,?,?)", "S" + i, "2026-11-23", 50, 0, 1, i < 1 ? 1 : 0, i < 5 ? 1 : 0, 3, 4, 260);
    const etf = (r: number) => Array.from({ length: 160 }, (_, i) => { const t = nyToUtc(2026, 8, 3 + i, 0, 0); return { t: iso(t), o: 100, h: 101, l: 99, c: 100 * (1 + (r * i) / 159), v: 1000 }; });
    for (const s of REGIME_ETFS) sc.alpaca.rawD.set(s, etf(s === "XLV" ? 0.1 : 0.01) as any);
    const reg = await updateRegime(d, d.markets.US, "2026-11-23", T.daily);
    expect(reg.breadth).toMatchObject({ n: 12, newHighs: 1, newLows: 5 }); expect(reg.leadership?.leaders[0].symbol).toBe("XLV");
    expect(reg.text.join("\n")).toMatch(/Marktbreite[\s\S]*Führung[\s\S]*Handelswoche/);
    expect((await one<any>(db, "SELECT asof FROM regime")).asof).toBe("US:2026-11-23");
  });
});

// ═══════════════════════════ DREI ENTSCHEIDUNGEN, MODELL & IDEEN ═══════════════════════════
describe("Drei getrennte Entscheidungen und Kennzeichnung", () => {
  const qqqOk = qqqDecision(base(), Array.from({ length: 40 }, (_, i) => ({ end: i, o: 1, h: 1, l: 1, c: 100 + i, v: 1 })));
  it("Marktvorgabe selektiv: nur erlaubte Setups (z. B. höheres Tief), Gewichtsgrenze gilt", async () => {
    const cfg = base({ MARKET_STANCE: "selective", STANCE_SELECTIVE_SETUPS: "first_higher_low", STANCE_WEIGHT_MIN: "20", STANCE_WEIGHT_MAX: "25", STANCE_NOTE: "Test" });
    const st = { stance: "selective" as const, note: "Test", setAt: null, source: "config" as const };
    const p = decidePermission(cfg, st, ["first_higher_low", "base_breakout"], qqqOk);
    expect(p.allowed).toEqual(["first_higher_low"]); expect(p.blocked[0].setup).toBe("base_breakout"); expect(p.weightCapPct).toBe(25);
    expect(p.stanceText).toMatch(/erlaubt nur: First Higher Low, geplanter Einsatz 20–25 %/);
    expect(sizePosition(cfgOf({ MAX_WEIGHT_PERCENT: "50" }), 100, 99, [], { maxWeightPercent: 20 }).shares).toBe(20);
    expect(decidePermission(base(), { ...st, stance: "open" }, ["base_breakout"], qqqOk).permitted).toBe(true);
    expect(decidePermission(base(), { ...st, stance: "cash" }, ["first_higher_low"], qqqOk).permitted).toBe(false);
  });
  it("Marktvorgabe lässt sich über die geschützte Statusseite setzen (nur gleiche Herkunft)", async () => {
    const db = createDb(), d = makeDeps(db, base(), T.daily); const env = { STATUS_TOKEN: "status-token-0123456789" };
    const post = (origin?: string) => handleRequest(new Request("https://x.example/admin/stance", { method: "POST", body: new URLSearchParams({ stance: "cash", note: "Erholungsversuch", hours: "24", market: "ALL" }), headers: { authorization: "Bearer " + env.STATUS_TOKEN, ...(origin ? { origin } : {}) } }), d, env);
    expect((await post("https://evil.example")).status).toBe(403);
    expect((await post()).status).toBe(303);
    expect(await getStance(d)).toMatchObject({ stance: "cash", note: "Erholungsversuch", source: "manual" });
  });
  it("veröffentlichte Watchlist-Idee: externe Herkunft, kein Trade, Kennzeichnung in Vorwarnung und Signal", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: croxDaily(), asof: LAST, events: [] });   // Bot findet selbst nichts (keine Katalysator-Daten)
    expect(await all(w.db, "SELECT 1 FROM prepared WHERE setup='earnings_consolidation'")).toHaveLength(0);
    const r = await importIdea(w.d, { instrument: { symbol: "CROX", venue: "XNAS", currency: "USD" }, setup: "earnings_consolidation", trigger: 160, stop: 157.39, stopBasis: "Tagestief (Quelle lässt den Tag offen; Modellannahme: Inside Day)", source: "TraderMacher-Report vom 25.11.2026", publishedAt: Date.parse("2026-11-25T08:38:35Z") });
    expect(r.state).toBe("active");
    expect(await all(w.db, "SELECT 1 FROM positions")).toHaveLength(0);                       // Idee ≠ Trade
    w.d.clock.t = morning("2026-11-25").now;
    breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d);
    await runIntraday(w.d);
    const m = w.mail.sent.find((x) => x.subject.startsWith("Einstieg"))!;
    expect(m.text).toMatch(/veröffentlichte Watchlist-Idee \(TraderMacher-Report vom 25\.11\.2026\)/); expect(m.text).toMatch(/Eine veröffentlichte Watchlist-Idee ist kein ausgeführter Trade/);
    expect((await one<any>(w.db, "SELECT origin FROM signals")).origin).toBe("idea");
    expect((await one<any>(w.db, "SELECT status FROM positions")).status).toBe("pending");    // erst die Kaufbestätigung macht daraus eine Position
  });
  it("Kursmarken der Abnahmefälle stehen nur in den Testdaten, nicht im Programmcode", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
    for (const f of walk(join(import.meta.dirname, "../src"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\b(Crocs|CROX|Sartorius|Illumina|ILMN)\b/);
      expect(src, f).not.toMatch(/(?<![\d.])(298|159[.,]24|292[.,]80|204[.,]52)(?![\d])/);
    }
  });
});

// ═════════════ Herkunft der Marken, Kandidatenliste, Regelstatus, automatische Marktvorgabe ═════════════
import { deriveAutoStance, getOverride } from "../src/permission";
import { roundLevelAbove } from "../src/patterns";
import type { Regime } from "../src/regime";
import { setMeta } from "../src/store";
import { usMarket } from "../src/markets";

const REG_BEAR: Regime = { asof: "2026-11-24", breadth: { asof: "2026-11-24", universe: "u", period: "p", source: "s", n: 3000, newHighs: 123, newLows: 465, above50Pct: 28, above200Pct: 40 },
  leadership: { asof: "2026-11-24", source: "s", period: "p", leaders: [], growthLeading: false }, ftd: [], thinWeek: "", text: ["Marktbreite …"] };
const REG_BULL: Regime = { ...REG_BEAR, breadth: { ...REG_BEAR.breadth!, newHighs: 500, newLows: 60, above50Pct: 71 }, leadership: { ...REG_BEAR.leadership!, growthLeading: true } };
const SP_BELOW: any = { state: "unter", obsDate: "2026-11-23", close: 6500, sma200: 6700, lastCompleted: "2026-11-24", isLastCompleted: false, text: "" };
const SP_ABOVE: any = { ...SP_BELOW, state: "über", close: 7237, sma200: 6700 };
const mkUs = { id: "US" as const, previousSession: (d: string) => usMarket(null as any).previousSession(d) };
const NOW = Date.parse("2026-11-24T21:00:00Z");

describe("Automatische Marktentscheidung (ohne tägliche manuelle Freigabe)", () => {
  const cfg = base({ AUTO_STANCE: "true" });
  it("schwache Breite, fehlende Wachstumsführung und S&P unter SMA200 → Cash; ein Merkmal → selektiv; keines → offen", () => {
    expect(deriveAutoStance(cfg, mkUs, REG_BEAR, SP_BELOW, NOW, "2026-11-24")).toMatchObject({ stance: "cash", source: "auto", flags: 4 });
    const one = deriveAutoStance(cfg, mkUs, { ...REG_BULL, leadership: { ...REG_BULL.leadership!, growthLeading: false } }, SP_ABOVE, NOW, "2026-11-24");
    expect(one).toMatchObject({ stance: "selective", flags: 1 }); expect(one.reasons!.join(" ")).toMatch(/Wachstumsgruppen führen nicht/);
    expect(deriveAutoStance(cfg, mkUs, REG_BULL, SP_ABOVE, NOW, "2026-11-24")).toMatchObject({ stance: "open", flags: 0 });
  });
  it("Follow-Through-Day gibt allein nichts frei", () => {
    const r = { ...REG_BEAR, ftd: [{ index: "QQQ", state: "Follow-Through-Day" as const, day: 5, date: "2026-11-24", text: "" }] };
    const s = deriveAutoStance(cfg, mkUs, r, SP_BELOW, NOW, "2026-11-24");
    expect(s.stance).toBe("cash"); expect(s.reasons!.join(" ")).toMatch(/nur zur Information/);
  });
  it("veraltete oder fehlende Marktdaten → Standard Cash (konfigurierbar), nie Freigabe", () => {
    expect(deriveAutoStance(cfg, mkUs, null, null, NOW, "2026-11-24")).toMatchObject({ stance: "cash", source: "stale_default" });
    const old = deriveAutoStance(cfg, mkUs, { ...REG_BULL, asof: "2026-11-16" }, SP_ABOVE, NOW, "2026-11-24");
    expect(old).toMatchObject({ stance: "cash", source: "stale_default" }); expect(old.reasons!.join(" ")).toMatch(/Sitzungen alt/);
    expect(deriveAutoStance(base({ AUTO_STALE_STANCE: "selective" }), mkUs, null, null, NOW, "2026-11-24").stance).toBe("selective");
  });
  it("Schwellen sind Modellannahmen und konfigurierbar", () => {
    expect(deriveAutoStance(base({ AUTO_MIN_ABOVE50_PCT: "20" }), mkUs, REG_BEAR, SP_ABOVE, NOW, "2026-11-24").flags).toBe(2);        // Breite-Anteil über SMA50 greift nicht mehr
    expect(deriveAutoStance(base({ AUTO_BEARISH_FLAGS_CASH: "5" }), mkUs, REG_BEAR, SP_BELOW, NOW, "2026-11-24").stance).toBe("selective");
  });
  it("manuelle Vorgabe braucht Begründung und Ablaufzeit, gilt bis dahin und fällt dann auf die automatische Entscheidung zurück", async () => {
    const db = createDb(); const d = makeDeps(db, base({ AUTO_STANCE: "true" }), NOW);
    await expect(setStance(d, "open", "", { hours: 24 })).rejects.toThrow(/Begründung/);
    await expect(setStance(d, "open", "Grund", {})).rejects.toThrow(/Ablaufzeit/);
    await expect(setStance(d, "open", "Grund", { hours: 24 * 30 })).rejects.toThrow(/höchstens 14 Tage/);
    await setStance(d, "open", "Ich beobachte die Lage selbst", { hours: 24, market: "US" });
    expect(await getStance(d, "US")).toMatchObject({ stance: "open", source: "manual", note: "Ich beobachte die Lage selbst" });
    expect((await getStance(d, "US")).until).toBe(NOW + 24 * 3_600_000);
    d.clock.t = NOW + 25 * 3_600_000;
    expect((await getStance(d, "US")).source).toBe("stale_default");                  // abgelaufen → automatisch (hier ohne Marktdaten → Standard Cash)
    expect((await getOverride(d, "US")).expired).toMatchObject({ stance: "open" });
  });
});

describe("Herkunft der Marken und Kandidatenliste", () => {
  it("Trigger, Stopp und Struktur nennen die abgeschlossenen Kerzen, aus denen sie stammen", () => {
    const p = prepare(croxDaily(), "1d", P, { events: [CROX_EVENT] }).find((x) => x.setup === "earnings_consolidation")!;
    expect(p.evidence!.join(" | ")).toMatch(/Auslösemarke 160\.00 = Hoch der abgeschlossenen Kerze vom 2026-11-24/);
    expect(p.evidence!.join(" | ")).toMatch(/Stopp 157\.39 = Tief 157\.40 der abgeschlossenen Kerze vom 2026-11-24 minus 1 Cent/);
    const r = prepare(illuminaDaily(), "1d", P).find((x) => x.setup === "ema_reclaim")!;
    expect(r.evidence!.join(" | ")).toMatch(/höherer Wert aus EMA10 und EMA20 am Schluss der Kerze vom 2026-11-24/);
    expect(r.evidence!.join(" | ")).toMatch(/Stopp 197\.39 = Tief 197\.40 der abgeschlossenen Kerze vom 2026-11-18/);
  });
  it("runde Marke ist nur Kontext und überschreibt die aus dem Chart abgeleitete Marke nie", () => {
    expect(roundLevelAbove(298)).toBe(300); expect(roundLevelAbove(160)).toBeNull(); expect(roundLevelAbove(98.6)).toBe(100);
    const flat = Array.from({ length: 20 }, () => ({ end: 0, o: 100, h: 100.2, l: 99.8, c: 100, v: 1000 })).map((b, i) => ({ ...b, end: i * 3_600_000 }));
    flat.push({ end: 20 * 3_600_000, o: 98.4, h: 98.6, l: 96.5, c: 98.5, v: 1000 }, { end: 21 * 3_600_000, o: 98.5, h: 98.6, l: 96.4, c: 98.5, v: 1000 });
    const ps = prepare(flat.slice(0, 21), "1h");
    const u = ps.find((x) => x.setup === "undercut_rally");
    if (u) { expect(u.trigger).toBe(98.6 > 0 ? u.trigger : 0); expect(u.trigger).not.toBe(100); }
    const ctx = prepare(sartoriusDaily(), "1d", P).find((x) => x.setup === "multiweek_base")!;
    expect(ctx.trigger).toBe(298); expect(ctx.contextLevels!.map((c) => c.level)).toEqual([300]);
  });
  it("Vorwarnung und Einstieg nennen den Grund für die Kandidatenliste (Rang, Relative Stärke, Liquidität, Spanne)", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: croxDaily(), asof: LAST, events: [CROX_EVENT] });
    const pw = w.mail.sent.find((m) => m.subject.startsWith("Vorwarnung"))!;
    expect(pw.text).toMatch(/Warum auf der Kandidatenliste: Rang 1 von 1 im Markt/); expect(pw.text).toMatch(/Relative Stärke: 63-Tage-Rendite/); expect(pw.text).toMatch(/Herkunft der Marken:/);
    w.d.clock.t = morning("2026-11-25").now; breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d); await runIntraday(w.d);
    const m = w.mail.sent.find((x) => x.subject.startsWith("Einstieg"))!;
    expect(m.text).toMatch(/Warum auf der Kandidatenliste: Rang 1 von 1/); expect(m.text).toMatch(/Herkunft der Marken:/);
    expect(await all(w.db, "SELECT 1 FROM candidate_log")).toHaveLength(1);
  });
});

describe("Regelstatus: Sperre, Kontext, fehlende Daten", () => {
  it("Einstiegsmail trennt Sperren, Kontext und fehlende Daten; Baron/Giering sperren nie", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: croxDaily(), asof: LAST, events: [CROX_EVENT] });
    w.d.clock.t = morning("2026-11-25").now; breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d); await runIntraday(w.d);
    const t = w.mail.sent.find((x) => x.subject.startsWith("Einstieg"))!.text;
    expect(t).toMatch(/Sperren: keine – alle sperrenden Regeln/); expect(t).toMatch(/Nur Kontext \(sperrt nicht\): Baron: S&P 500/); expect(t).toMatch(/Giering: Wachstum/);
    expect(t).toMatch(/Fehlende Daten: .*S&P-500-Daten \(FRED\).*Wachstumsdaten/);
  });
  it("gesperrt durch Marktvorgabe: Sperre benannt, Kontext getrennt", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: croxDaily(), asof: LAST, events: [CROX_EVENT], cfg: { MARKET_STANCE: "cash" } });
    w.d.clock.t = morning("2026-11-25").now; breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d); await runIntraday(w.d);
    const t = w.mail.sent.find((x) => x.subject.startsWith("Nur beobachten"))!.text;
    expect(t).toMatch(/Sperren: Marktvorgabe/); expect(t).toMatch(/Nur Kontext \(sperrt nicht\)/);
  });
});

describe("Entscheidender Test: Trigger in „cash“, später „offen“", () => {
  async function cashWorld() {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: croxDaily(), asof: LAST, events: [CROX_EVENT], cfg: { MARKET_STANCE: "cash" } });
    w.d.clock.t = morning("2026-11-25").now; breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d); await runIntraday(w.d);
    expect(w.mail.sent.filter((m) => m.subject.startsWith("Nur beobachten"))).toHaveLength(1);
    return w;
  }
  it("Kurs inzwischen weggelaufen → ‚Einstieg verpasst‘ (genau eine Mail, kein Kauf-Link, keine Position)", async () => {
    const w = await cashWorld();
    await setStance(w.d, "open", "Marktlage gedreht", { hours: 24 });
    w.d.clock.t += 10 * MIN; breakout5("CROX", w.sc, "2026-11-25", 160, 163.9, 164.0, w.d);      // 1,5 R über dem Auslöser
    await runIntraday(w.d);
    const m = w.mail.sent.filter((x) => x.subject.startsWith("Einstieg verpasst"));
    expect(m).toHaveLength(1); expect(m[0].subject).toBe("Einstieg verpasst · CROX · Konsolidierung nach Quartalszahlen"); expect(m[0].text).not.toMatch(/\/a\//);
    expect(w.mail.sent.some((x) => x.subject.startsWith("Einstieg bestätigt"))).toBe(false);
    expect(await all(w.db, "SELECT 1 FROM positions")).toHaveLength(0);
    w.d.clock.t += 5 * MIN; await runIntraday(w.d); await runIntraday(w.d);
    expect(w.mail.sent.filter((x) => /^Einstieg/.test(x.subject))).toHaveLength(1);              // keine Wiederholung
  });
  it("Setup weiterhin gültig und Kurs handelbar → genau EINE Einstiegsmail, auch bei mehreren Läufen", async () => {
    const w = await cashWorld();
    await setStance(w.d, "open", "Marktlage gedreht", { hours: 24 });
    for (let i = 0; i < 3; i++) { w.d.clock.t += 5 * MIN; breakout5("CROX", w.sc, "2026-11-25", 160, 160.2, 160.3, w.d); await runIntraday(w.d); }
    expect(w.mail.sent.filter((x) => x.subject.startsWith("Einstieg bestätigt"))).toHaveLength(1);
    expect(w.mail.sent.filter((x) => x.subject.startsWith("Nur beobachten"))).toHaveLength(1);
    expect(await all(w.db, "SELECT 1 FROM positions")).toHaveLength(1);
  });
  it("fiel der Kurs inzwischen unter die Invalidierungsmarke, entsteht keine Mail", async () => {
    const w = await cashWorld();
    await setStance(w.d, "open", "Marktlage gedreht", { hours: 24 });
    w.d.clock.t += 10 * MIN; breakout5("CROX", w.sc, "2026-11-25", 160, 156.0, 156.1, w.d);       // Schluss unter dem Auslöser
    await runIntraday(w.d);
    expect(w.mail.sent.filter((x) => /^Einstieg/.test(x.subject))).toHaveLength(0);
  });
});

describe("Stoppweite und Risikoregeln", () => {
  it("Standard 10 %: der Illumina-Test mit größerem Abstand bleibt „Nur beobachten“ mit Begründung, ohne Kauf-Link", async () => {
    const w = await world({ symbol: "ILMN", name: "Illumina Inc. Common Stock", bars: illuminaDaily(), asof: LAST, cfg: { MAX_STOP_PCT: "10" } });
    const trig = (await one<any>(w.db, "SELECT trigger_price FROM prepared WHERE setup='ema_reclaim'")).trigger_price;
    w.d.clock.t = morning("2026-11-25").now; breakout5("ILMN", w.sc, "2026-11-25", trig - 1, trig + 0.2, trig + 0.3, w.d);
    await runIntraday(w.d);
    const m = w.mail.sent.find((x) => x.subject.startsWith("Nur beobachten"))!;
    expect(m.subject).toBe("Nur beobachten · ILMN · EMA-Reclaim");
    expect(m.text).toMatch(/Risikoregel Stopp: Stopp 1[01]\.\d % entfernt \(Maximum 10 %\)/); expect(m.text).not.toMatch(/\/a\/|Stückzahl:/);
    expect(await all(w.db, "SELECT 1 FROM positions")).toHaveLength(0);
    w.d.clock.t += 5 * MIN; breakout5("ILMN", w.sc, "2026-11-25", trig - 1, trig + 0.2, trig + 0.3, w.d); await runIntraday(w.d);
    expect(w.mail.sent.filter((x) => x.subject.startsWith("Nur beobachten"))).toHaveLength(1);   // einmal je Setup
  });
  it("USD/EUR: ein offenes EUR-Konto-Positionsvolumen mindert das verfügbare Kapital für US-Titel (dokumentierter Kurs)", () => {
    const cfg = cfgOf({ FX_USD_PER_EUR: "1.10", FX_DATE: "2026-11-20", FX_SOURCE: "Test", CAPITAL: "10000" });
    const r = sizePosition(cfg, 100, 99, [{ symbol: "XETR:ABC", sharesRemaining: 100, entry: 50, stop: 49.9, currency: "EUR" }], { currency: "USD" });
    expect(r.available).toBeCloseTo(10000 - 5500, 6); expect(r.shares).toBe(25);                  // 5000 EUR = 5500 USD gebunden → 4500 USD frei; Gewichtsgrenze 25 % begrenzt
    expect(() => sizePosition(cfgOf(), 100, 99, [{ symbol: "XETR:ABC", sharesRemaining: 1, entry: 50, stop: 49, currency: "EUR" }])).toThrow(/Wechselkurs/);   // ohne Kurs keine Umrechnung
  });
  it("verlorener Swing: Ausstiegsmail deutet ihn nicht zum Langfristinvestment um, der Stopp wird nicht gesenkt/gelockert", async () => {
    const w = await world({ symbol: "CROX", name: "Crocs Inc. Common Stock", bars: croxDaily(), asof: LAST, events: [CROX_EVENT] });
    w.d.clock.t = morning("2026-11-25").now; breakout5("CROX", w.sc, "2026-11-25", 160, 160.15, 160.25, w.d); await runIntraday(w.d);
    const tok = w.mail.sent.find((x) => x.subject.startsWith("Einstieg"))!.text.match(/\/a\/([A-Za-z0-9_-]+)/)![1];
    await handleRequest(new Request(`https://x.example/a/${tok}`, { method: "POST", body: new URLSearchParams({ action: "buy", price: "160.30", shares: "10", fees: "0", request_id: "buy-aaaaaaaa", confirm: "yes" }) }), w.d, { STATUS_TOKEN: "x".repeat(20) });
    w.d.clock.t += 20 * MIN;
    w.sc.alpaca.snaps.set("CROX", { latestQuote: { t: iso(w.d.clock.t - 2000), ap: 156.9, bp: 156.8 }, latestTrade: { t: iso(w.d.clock.t - 1000), p: 156.85 }, dailyBar: { t: iso(nyToUtc(2026, 11, 25, 0, 0)), o: 159, h: 160.3, l: 156.7, c: 156.85, v: 1 } as any });
    await runIntraday(w.d);
    const ex = w.mail.sent.find((x) => x.subject.startsWith("Ausstieg"))!;
    expect(ex.text).toMatch(/nicht nachträglich zu einem Langfristinvestment umgedeutet/); expect(ex.text).not.toMatch(/Stopp nachziehen|auf Langfrist|halten/);
    expect((await one<any>(w.db, "SELECT stop, initial_stop, status FROM positions"))).toMatchObject({ stop: 157.39, initial_stop: 157.39, status: "open" });   // wird nicht automatisch geschlossen oder verschoben
  });
});
