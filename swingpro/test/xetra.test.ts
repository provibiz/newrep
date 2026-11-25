/** Deutschland (Xetra, EUR): Universum, Aktiengattung/ISIN, Indexabdeckung, Kalender, deutscher Vormittagsscan. Alle Daten sind TESTDATEN. */
import { describe, it, expect } from "vitest";
import { createDb, cfgOf, makeDeps, FakeMail, FakeDeData } from "./helpers";
import { sartoriusDaily, toXetra, trendBars, SRT_ISIN, SRT_ORD_ISIN, LAST } from "./fixtures/siebenhaar";
import { runDaily, runDailyAll } from "../src/jobs/daily";
import { runIntraday, runIntradayAll } from "../src/jobs/intraday";
import { xetraSession, xetraHolidays, deMarket } from "../src/markets";
import { classifyDe, shareClassOf } from "../src/universe";
import { parseIndexCsv, matchMembers, parseCsv, INDEXES } from "../src/indexes";
import { checkSupport } from "../src/instruments";
import { loadConfig } from "../src/config";
import { all, one, getMeta } from "../src/store";
import { handleRequest } from "../src/web";
import { buildMarkets } from "../src/buildMarkets";
import { MIN } from "../src/time";
import { iso } from "../src/time";
import type { Bar } from "../src/types";
import type { AssetInfo } from "../src/marketdata";

const asset = (symbol: string, name: string, over: Partial<AssetInfo> = {}): AssetInfo => ({ key: `XETR:${symbol}`, symbol, name, mic: "XETR", currency: "EUR", isin: null, type: "Common Stock", ...over });
const IDX_CSV = {
  tecdax: "Ticker,ISIN,Name\nSRT3,DE0007165631,Sartorius AG Vz.\nSAP,DE0007164600,SAP SE\nFOO,DE000A1EWWW0,Nicht erfasst AG\n",
  mdax: "Ticker,ISIN,Name\nSRT3,DE0007165631,Sartorius AG Vz.\nBAR,DE0005190003,Weiteres Mitglied\n",
};
const fetchIdx = async (url: string) => (url.includes("tecdax") ? new Response(IDX_CSV.tecdax) : url.includes("mdax") ? new Response(IDX_CSV.mdax) : new Response("", { status: 404 }));
const cfgDe = (o: Record<string, unknown> = {}) => cfgOf({ MARKETS: "US,DE", FX_USD_PER_EUR: "1.10", FX_DATE: "2026-11-20", FX_SOURCE: "EZB-Referenzkurs (Test)", MIN_RANGE_PCT: "1", MAX_STOP_PCT: "12",
  INDEX_SOURCES: JSON.stringify({ TECDAX: { url: "https://idx.example/tecdax.csv", format: "generic_csv" }, MDAX: { url: "https://idx.example/mdax.csv", format: "generic_csv" } }), ...o });

function deData() {
  const de = new FakeDeData();
  de.assetList = [
    asset("SRT3", "Sartorius AG Vz.", { type: "Preferred Stock", isin: SRT_ISIN }),
    asset("SRT", "Sartorius AG", { isin: SRT_ORD_ISIN }),
    asset("SAP", "SAP SE", { isin: "DE0007164600" }),
    asset("SAPG", "SAP SE (zweite Notierungszeile)", { isin: "DE0007164600" }),
    asset("EXS1", "iShares Core DAX UCITS ETF", { type: "ETF", isin: "DE0005933931" }),
    asset("USDX", "Dollar-Notierung", { currency: "USD", isin: "DE0005190003" }),
    asset("THIN", "Dünn gehandelt AG", { isin: "DE0006231004" }),
  ];
  de.daily.set("XETR:SRT3", sartoriusDaily().length ? toXetra(sartoriusDaily()) : []);
  de.daily.set("XETR:SRT", trendBars(LAST, 140, 100, 160));
  de.daily.set("XETR:SAP", trendBars(LAST, 140, 120, 190));
  de.daily.set("XETR:THIN", trendBars(LAST, 140, 50, 60, 10));
  for (const k of ["XETR:SAPG", "XETR:EXS1", "XETR:USDX"]) de.daily.set(k, trendBars(LAST, 140, 50, 60));
  return de;
}
const dayEnd = Date.parse("2026-11-24T17:00:00Z");            // 18:00 Berlin, nach Xetra-Schluss 17:30
async function deWorld(o: { cfg?: Record<string, unknown>; de?: FakeDeData; asof?: number } = {}) {
  const db = createDb(), mail = new FakeMail(), de = o.de ?? deData();
  const d = makeDeps(db, cfgDe(o.cfg), o.asof ?? dayEnd, { mail, de, fetch: fetchIdx });
  return { db, mail, de, d };
}
const fiveBars = (start: number, closes: number[], vol = 400): Bar[] => closes.map((c, i) => ({ end: start + (i + 1) * 5 * MIN, o: i ? closes[i - 1] : c, h: Math.max(c, i ? closes[i - 1] : c) + 0.05, l: Math.min(c, i ? closes[i - 1] : c) - 0.05, c, v: vol }));

describe("Xetra-Handelskalender", () => {
  it("handelsfreie Tage 2026/2027 laut Deutsche Börse (Neujahr, Karfreitag, Ostermontag, 1. Mai, 24./25./26./31.12.)", () => {
    for (const d of ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01", "2027-03-26", "2027-03-29", "2027-12-24", "2027-12-31"]) expect(xetraSession(d), d).toBeNull();
    for (const d of ["2026-05-14", "2026-05-25", "2026-06-04", "2026-11-26", "2026-07-03"]) expect(xetraSession(d), d).not.toBeNull();   // Himmelfahrt, Pfingstmontag, Fronleichnam, US-Thanksgiving/US-Feiertag
    expect(xetraHolidays(2026).get("2026-12-26")).toBe("2. Weihnachtstag");
  });
  it("Handelszeit 09:00–17:30 Berlin in Winter- und Sommerzeit; 30.12. verkürzt (Zeiten nicht hinterlegt)", () => {
    expect(iso(xetraSession("2026-11-24")!.open)).toBe("2026-11-24T08:00:00.000Z"); expect(iso(xetraSession("2026-11-24")!.close)).toBe("2026-11-24T16:30:00.000Z");
    expect(iso(xetraSession("2026-07-01")!.open)).toBe("2026-07-01T07:00:00.000Z");
    expect(xetraSession("2026-12-30")!.early).toBe(true);
  });
  it("letzte abgeschlossene Sitzung folgt dem Xetra-Kalender", () => {
    const mk = deMarket(null as any);
    expect(mk.lastCompletedSession(Date.parse("2026-12-24T12:00:00Z"))).toBe("2026-12-23");
    expect(mk.lastCompletedSession(Date.parse("2026-12-28T17:00:00Z"))).toBe("2026-12-28");
    expect(mk.previousSession("2026-04-07")).toBe("2026-04-02");       // Ostermontag und Karfreitag liegen dazwischen
  });
});

describe("Identität: Aktiengattung, ISIN, Währung", () => {
  const cfg = cfgDe();
  it("Vorzugsaktien (Vz.) sind eigene Instrumente; ETFs, Fremdwährung und Zertifikate sind ausgeschlossen", () => {
    expect(shareClassOf("Sartorius AG Vz.")).toBe("preferred"); expect(shareClassOf("Sartorius AG")).toBe("common");
    expect(classifyDe(asset("SRT3", "Sartorius AG Vz.", { type: "Preferred Stock", isin: SRT_ISIN }), cfg)).toMatchObject({ included: true, shareClass: "preferred", isin: SRT_ISIN });
    expect(classifyDe(asset("EXS1", "iShares DAX UCITS ETF", { type: "ETF" }), cfg).reason).toMatch(/Typ ETF/);
    expect(classifyDe(asset("ZZZ1", "Bonus Zertifikat auf X", { type: null }), cfg).reason).toMatch(/Zertifikat/);
    expect(classifyDe(asset("USDX", "x", { currency: "USD" }), cfg).reason).toMatch(/Währung USD/);
    expect(classifyDe(asset("SAP", "SAP SE", { isin: "DE0007164601" }), cfg).isin).toBeNull();                      // ungültige Prüfsumme wird nicht als ISIN geführt
    expect(classifyDe({ ...asset("SAP", "x"), mic: "XFRA" }, cfg).reason).toMatch(/Handelsplatz/);
  });
  it("jedes Instrument hat einen eindeutigen Schlüssel (MIC:Mnemonic); US-Ticker kollidieren nie mit Xetra", () => {
    expect(asset("SAP", "SAP SE").key).toBe("XETR:SAP");
    expect(checkSupport({ symbol: "SAP", venue: "XETR", currency: "EUR" }).label).toBe("Markt nicht unterstützt");   // ohne Anbieter-Zugang nie „unterstützt“
  });
});

describe("Indexquellen und Abdeckung", () => {
  it("parst iShares-/generische CSV (Vorspann, Anführungszeichen, Nicht-Aktien) und ordnet per ISIN bzw. Ticker zu", () => {
    const csv = 'Fund Holdings as of,"Nov 23, 2026"\n\nTicker,Name,Asset Class,Exchange\nAAPL,"Apple Inc.",Equity,NASDAQ\nBRKB,"Berkshire, Class B",Equity,NYSE\nUSD,"USD CASH",Cash,-\nESZ6,"E-MINI",Futures,-\n';
    const m = parseIndexCsv(csv, { format: "ishares_csv" });
    expect(m.map((x) => x.symbol)).toEqual(["AAPL", "BRKB"]); expect(m[1].name).toBe("Berkshire, Class B");
    const r = matchMembers(m, [{ key: "AAPL", symbol: "AAPL", isin: null }, { key: "BRK.B", symbol: "BRK.B", isin: null }]);
    expect([...r.matched.keys()].sort()).toEqual(["AAPL", "BRK.B"]);                                                       // BRKB ≙ BRK.B
    expect(parseCsv('a,"b,c",d\n1,2,3').length).toBe(2);
    expect(() => parseIndexCsv("x,y\n1,2", { format: "generic_csv" })).toThrow(/Kopfzeile/);
  });
  it("alle acht Indizes sind definiert; DAX/MDAX/SDAX/TecDAX gehören zu Deutschland", () => {
    expect(INDEXES.map((i) => i.id)).toEqual(["SP500", "SP400", "SP600", "NDX", "DAX", "MDAX", "SDAX", "TECDAX"]);
    expect(INDEXES.filter((i) => i.market === "DE").map((i) => i.id)).toEqual(["DAX", "MDAX", "SDAX", "TECDAX"]);
  });
});

describe("Deutscher Tageslauf: Universum, Abdeckung, Setups in EUR", () => {
  it("erfasst, filtert und prüft; Mehrfachmitgliedschaft erzeugt EIN Instrument und EINE Vorbereitung", async () => {
    const { db, d, mail } = await deWorld();
    expect(await runDaily(d, "DE")).toMatch(/ok/);
    const u = await getMeta<any>(db, "universe_stats:DE");
    expect(u).toMatchObject({ available: 7, excluded: 3 });                                           // ETF, Fremdwährung, Duplikat-ISIN
    expect(u.excludedByReason["Duplikat (gleiche ISIN)"]).toBe(1);
    expect((await all<any>(db, "SELECT symbol, share_class, currency, market FROM assets ORDER BY symbol")).map((a) => `${a.symbol}:${a.share_class}:${a.currency}:${a.market}`))
      .toEqual(["XETR:SAP:common:EUR:DE", "XETR:SRT:common:EUR:DE", "XETR:SRT3:preferred:EUR:DE", "XETR:THIN:common:EUR:DE"]);
    const cov = (await getMeta<any>(db, "coverage:DE"));
    const ix = Object.fromEntries(cov.indexes.map((i: any) => [i.id, i]));
    expect(ix.TECDAX).toMatchObject({ status: "ok", members: 3, captured: 2, unmatchedCount: 1 });     // FOO nicht erfasst → sichtbar
    expect(ix.MDAX).toMatchObject({ status: "ok", members: 2, captured: 1 });
    expect(ix.DAX.status).toBe("quelle_fehlt"); expect(ix.SDAX.status).toBe("quelle_fehlt");          // Lücke sichtbar, nicht „0 Mitglieder“
    expect(cov.indexes.find((i: any) => i.id === "TECDAX").withData).toBe(2);
    expect(cov.outside.captured).toBe(2);                                                              // SRT und THIN außerhalb der kontrollierten Indizes
    expect(ix.TECDAX.excludedByFilter).toEqual({});                                                    // SRT3 und SAP bestanden die Filter
    expect(cov.indexes.some((i: any) => i.excludedByFilter && Object.keys(i.excludedByFilter).length)).toBe(false);
    const prepared = await all<any>(db, "SELECT symbol, setup, market, state FROM prepared WHERE state='active'");
    expect(prepared.filter((p) => p.symbol === "XETR:SRT3" && p.setup === "multiweek_base")).toHaveLength(1);   // trotz zwei Indizes nur einmal
    expect(prepared.find((p) => p.symbol === "XETR:SRT3")!.market).toBe("DE");
    const pw = mail.sent.find((m) => m.subject.startsWith("Vorwarnung") && /SRT3/.test(m.subject))!;
    expect(pw.text).toMatch(/Auslösemarke: 5-Minuten-Schluss über 298\.00/); expect(pw.text).toMatch(/EUR/);
    expect((await all(db, "SELECT 1 FROM candidate_log WHERE market='DE'")).length).toBeGreaterThanOrEqual(2);
    const th = await one<any>(db, "SELECT reason FROM metrics WHERE symbol='XETR:THIN'"); expect(th.reason).toMatch(/Umsatz/);   // Liquiditätsfilter greift
  });
  it("Zugang fehlt: genaue Lücke und benötigter Tarif auf der Statusseite, nichts abgerufen, USA unberührt", async () => {
    const db = createDb(), d = makeDeps(db, cfgDe(), dayEnd, { fetch: fetchIdx });
    d.markets = buildMarkets(d.cfg, d.alpaca as any, fetchIdx as any, {});                         // Standard: Twelve-Data-Schlüssel fehlt
    expect(await runDaily(d, "DE")).toMatch(/Datenzugang fehlt/);
    const gap = await getMeta<any>(db, "data_gap:DE");
    expect(gap.plan).toMatch(/Real-time EU market data/); expect(gap.detail).toMatch(/TWELVEDATA_API_KEY/);
    const html = await (await handleRequest(new Request("https://x.example/status", { headers: { authorization: "Bearer status-token-0123456789" } }), d, { STATUS_TOKEN: "status-token-0123456789" })).text();
    expect(html).toMatch(/Datenzugang fehlt/); expect(html).toMatch(/Real-time EU market data/); expect(html).toMatch(/Ein US-Kurs ersetzt keinen EUR-Kurs/);
    expect(await all(db, "SELECT 1 FROM assets WHERE market='DE'")).toHaveLength(0);
  });
});

describe("Deutscher Vormittagsscan (Europe/Berlin, EUR)", () => {
  async function morningWorld(o: { quote?: any; cfg?: Record<string, unknown> } = {}) {
    const w = await deWorld({ cfg: o.cfg });
    await runDaily(w.d, "DE");
    const s = xetraSession("2026-11-25")!;
    w.d.clock.t = s.open + 41 * MIN + 60_000;                                   // 09:42 Berlin – die US-Börse ist noch geschlossen
    const closes = [297.2, 297.4, 297.3, 297.6, 297.5, 297.7, 297.4, 298.15];   // 5-Minuten-Schluss über dem Auslöser in der 8. Kerze
    w.de.five.set("XETR:SRT3", fiveBars(s.open, closes));
    w.de.quoteMap.set("XETR:SRT3", { quote: o.quote === undefined ? { price: 298.4, time: w.d.clock.t - 4000, kind: "last", currency: "EUR" } : o.quote, sessionOpen: 297.2 });
    return { ...w, s };
  }
  it("USA idle, Xetra löst auf Basis des EUR-Kurses aus; Größe, Risiko und Wechselkurs in der Mail", async () => {
    const w = await morningWorld();
    expect(await runIntraday(w.d, "US")).toMatch(/idle/);
    expect(await runIntraday(w.d, "DE")).toMatch(/1 bestätigt/);
    const m = w.mail.sent.find((x) => x.subject.startsWith("Einstieg"))!;
    expect(m.subject).toBe("Einstieg bestätigt · SRT3 · Mehrwöchige Basis");
    expect(m.text).toMatch(/Kurs 298\.40 EUR/); expect(m.text).toMatch(/Stopp: 291\.49 EUR/); expect(m.text).toMatch(/Wechselkurs: 1 EUR = 1\.1 USD \(EZB-Referenzkurs \(Test\)/);
    expect(m.text).toMatch(/Tagestief des Inside Days vom 2026-11-24/);
    expect(m.text).toMatch(/Kontext \(kein Trigger\): 300\.00 EUR/);                           // die runde Marke bleibt Kontext
    expect(m.text).toMatch(/QQQ-Filter: gilt nur für US-Titel/);
    const sig = await one<any>(w.db, "SELECT market, currency, shares, planned_risk_usd, data_available_at, detected_at, signal_time, checked_at FROM signals");
    expect(sig).toMatchObject({ market: "DE", currency: "EUR" });
    expect(sig.shares).toBe(6);                                               // 0,5 % von 10 000 USD = 45,45 EUR → 6 × 6,91 EUR
    expect(sig.signal_time).toBeLessThanOrEqual(sig.data_available_at); expect(sig.data_available_at).toBeLessThanOrEqual(sig.detected_at);
    expect((await one<any>(w.db, "SELECT currency, market FROM positions"))).toMatchObject({ currency: "EUR", market: "DE" });
  });
  it("Kurs in USD (z. B. US-Ersatzkurs) löst nie einen EUR-Einstieg aus", async () => {
    const w = await morningWorld({ quote: { price: 328.2, time: Date.now(), kind: "last", currency: "USD" } });
    w.de.quoteMap.get("XETR:SRT3")!.quote!.time = w.d.clock.t - 3000;
    await runIntraday(w.d, "DE");
    expect(w.mail.sent.some((m) => /^Einstieg/.test(m.subject))).toBe(false);
    expect((await one<any>(w.db, "SELECT state FROM prepared WHERE symbol='XETR:SRT3' AND setup='multiweek_base'")).state).toBe("active");   // wird erneut versucht, nicht verworfen
  });
  it("kein Kurs / alter Kurs → kein Einstieg", async () => {
    const w1 = await morningWorld({ quote: null }); await runIntraday(w1.d, "DE"); expect(w1.mail.sent.some((m) => /^Einstieg/.test(m.subject))).toBe(false);
    const w2 = await morningWorld(); w2.de.quoteMap.get("XETR:SRT3")!.quote!.time = w2.d.clock.t - 600_000; await runIntraday(w2.d, "DE"); expect(w2.mail.sent.some((m) => /^Einstieg/.test(m.subject))).toBe(false);
  });
  it("Xetra-Feiertag und verkürzter Handelstag: kein Scan; beide Märkte laufen im selben Takt, jeder mit seinem Kalender", async () => {
    const w = await deWorld();
    w.d.clock.t = Date.parse("2026-12-24T09:00:00Z"); expect(await runIntraday(w.d, "DE")).toMatch(/idle/);
    w.d.clock.t = Date.parse("2026-12-30T09:00:00Z"); expect(await runIntraday(w.d, "DE")).toMatch(/verkürzter Xetra-Handelstag/);
    w.d.clock.t = Date.parse("2026-11-26T10:00:00Z");                     // Thanksgiving: USA zu, Xetra offen
    expect(await runIntradayAll(w.d)).toMatch(/US: idle.*\| DE: (idle|ok)/);
  });
  it("EUR-Konto ohne FX ist ohne Zusatzangabe möglich, Xetra-Betrieb ohne dokumentierten Kurs nicht", () => {
    expect(() => loadConfig({ MARKETS: "US,DE" })).toThrow(/FX_USD_PER_EUR/);
    expect(loadConfig({ MARKETS: "US" }).markets).toEqual(["US"]);
    expect(() => loadConfig({ MARKETS: "FR" })).toThrow(/MARKETS/);
  });
});
