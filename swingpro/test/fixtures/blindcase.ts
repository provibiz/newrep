/** TESTDATEN: Blindlauf-Fall. Die drei Beispiele werden dem Scanner nicht als Suchziele übergeben; Ziele kennt nur die Auswertung danach. */
import { createDb, cfgOf, makeDeps, FakeMail, FakeAlpaca, FakeDeData } from "../../src/replay/fakes";
import { runBlind, type Provenance } from "../../src/blindrun";
import { croxDaily, illuminaDaily, sartoriusDaily, toRawDaily, toXetra, trendBars, CROX_EVENT, SRT_ISIN, SRT_ORD_ISIN, LAST, sessionsEnding } from "./siebenhaar";
import { sessionFor } from "../../src/calendar";
import { xetraSession } from "../../src/markets";
import type { Bar } from "../../src/types";

export const FIXTURE_PROV: Provenance = { universe: "fixture", data: "fixture", note: "Nachgebaute Kurse; kein Echtdaten-Nachweis." };
const usAsset = (symbol: string, name: string, id: string) => ({ id, symbol, name, exchange: "NASDAQ", status: "active", tradable: true, class: "us_equity" });

/** Erfundene, formationslose Gegenprobe: gleichmäßiger Rückgang ohne Basis, Inside Day, Rücklauf oder EMA-Rückeroberung. */
export const noFormation = (scale = 1): Bar[] => sessionsEnding(LAST, 130).map((d, i) => {
  const c = (150 - 0.35 * i) * scale, o = c + 0.6 * scale * Math.cos(i);
  return { end: sessionFor(d)!.close, o, h: Math.max(o, c) * 1.012, l: Math.min(o, c) * 0.988, c, v: 1_000_000 };
});

export async function fixtureBlindRun(extra: Record<string, unknown> = {}) {
  const db = createDb(), mail = new FakeMail(), alp = new FakeAlpaca();
  alp.assetList = [usAsset("CROX", "Crocs Inc. Common Stock", "id1"), usAsset("ILMN", "Illumina Inc. Common Stock", "id2"), usAsset("NOPE", "Beispiel Ohne Formation Inc. Common Stock", "id3"), usAsset("ABCD", "Beispiel Hersteller Inc. Common Stock", "id4")];
  alp.rawD.set("CROX", toRawDaily(croxDaily())); alp.rawD.set("ILMN", toRawDaily(illuminaDaily())); alp.rawD.set("NOPE", toRawDaily(noFormation()));
  alp.rawD.set("ABCD", toRawDaily(trendBars(LAST, 130, 40, 90, 900_000, "us")));
  const de = new FakeDeData();
  de.assetList = [{ key: "XETR:SRT3", symbol: "SRT3", name: "Sartorius AG Vz.", mic: "XETR", currency: "EUR", isin: SRT_ISIN, type: "Preferred Stock" }, { key: "XETR:SRT", symbol: "SRT", name: "Sartorius AG", mic: "XETR", currency: "EUR", isin: SRT_ORD_ISIN, type: "Common Stock" }];
  de.daily.set("XETR:SRT3", toXetra(sartoriusDaily())); de.daily.set("XETR:SRT", trendBars(LAST, 140, 100, 160));
  const fmp = { income: async () => [], earningsCalendar: async () => new Map(), earningsFor: async (s: string) => (s === "CROX" ? [CROX_EVENT] : []) };
  const cfg = cfgOf({ MARKETS: "US,DE", FX_USD_PER_EUR: "1.10", FX_DATE: "2026-11-20", FX_SOURCE: "Test", MIN_RANGE_PCT: "1", MAX_STOP_PCT: "12", ...extra });
  const d = makeDeps(db, cfg, Date.parse("2026-11-16T12:00:00Z"), { alpaca: alp, mail, fmp, de });
  const usDates = sessionsEnding(LAST, 6).filter((x) => sessionFor(x));            // 17.–24.11.
  const deDates = sessionsEnding(LAST, 6).filter((x) => xetraSession(x));
  const us = await runBlind(d, "US", usDates, FIXTURE_PROV);
  const de_ = await runBlind(d, "DE", deDates, FIXTURE_PROV);
  return { d, db, mail, us, de: de_, usDates, deDates };
}
