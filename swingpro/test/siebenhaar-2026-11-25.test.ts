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
  it("Rücklauf aufs alte Niveau allein ist nur Vorbereitung: ohne Seitwärtsphase kein Setup", () => {
    const retest = H.slice(0, idx("2026-11-18") + 1);
    const pr = emaReclaimProgress(retest, P);
    expect(pr).toMatchObject({ retest: true, belowEmas: true }); expect(pr.level).toBeCloseTo(200.8, 5); expect(pr.sidewaysDays).toBeLessThan(P.reclaim.minSideways);
    expect(prepare(retest, "1d", P).map((x) => x.setup)).not.toContain("ema_reclaim");
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
    expect(prepare(H, "1d", dailyParams(base({ EMA_RECLAIM_MIN_SIDEWAYS_DAYS: "5" }))).map((x) => x.setup)).toContain("ema_reclaim");
    expect(prepare(H, "1d", dailyParams(base({ EMA_RECLAIM_MIN_SIDEWAYS_DAYS: "6" }))).map((x) => x.setup)).not.toContain("ema_reclaim");
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
