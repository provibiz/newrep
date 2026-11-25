/**
 * Historischer Blindlauf (siehe src/blindrun.ts). Ziel-Titel werden dem Scanner NICHT übergeben – nur die Auswertung NACH dem Lauf kennt sie.
 *
 *   npx tsx scripts/blindrun.ts --fixture
 *       Lauf mit nachgebauten TESTDATEN (Funktionsprüfung, ausdrücklich KEIN Echtdaten-Nachweis).
 *
 *   ALPACA_KEY_ID=… ALPACA_SECRET=… npx tsx scripts/blindrun.ts --live --market US --from 2026-09-01 --to 2026-11-24 --targets TICKER1,TICKER2
 *       Echtdaten-Lauf mit Alpaca-Historie. Das Universum ist der HEUTIGE Bestand (Survivorship-Verzerrung): der Bericht weist das aus
 *       und behauptet deshalb KEINEN historischen Echtdaten-Nachweis. Für einen Nachweis wäre ein archivierter Zeitpunkt-Bestand nötig.
 *       Schlüssel nur als Umgebungsvariablen im eigenen Terminal – nie im Chat oder in Dateien.
 */
import { createDb, cfgOf, makeDeps, FakeMail, FakeAlpaca } from "../src/replay/fakes";
import { runBlind, evaluateTargets, renderReport, type Provenance } from "../src/blindrun";
import { Alpaca } from "../src/providers";
import { buildMarkets } from "../src/buildMarkets";
import { sessionFor } from "../src/calendar";
import { addDays } from "../src/time";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const market = (arg("--market") ?? "US") as "US" | "DE";

if (process.argv.includes("--live")) {
  const id = process.env.ALPACA_KEY_ID, secret = process.env.ALPACA_SECRET;
  if (!id || !secret) { console.error("ALPACA_KEY_ID und ALPACA_SECRET als Umgebungsvariablen setzen."); process.exit(1); }
  const from = arg("--from"), to = arg("--to"), targets = (arg("--targets") ?? "").split(",").filter(Boolean);
  if (!from || !to) { console.error("--from und --to (YYYY-MM-DD) angeben."); process.exit(1); }
  const f = (u: string, i?: RequestInit) => fetch(u, i);
  const cfg = cfgOf({ MODE: "paper", MARKETS: market, ...(market === "DE" ? { FX_USD_PER_EUR: "1.10", FX_DATE: "2026-11-20", FX_SOURCE: "nur Blindlauf" } : {}) });
  const d = makeDeps(createDb(), cfg, Date.parse(from), { mail: new FakeMail() });
  d.markets = buildMarkets(cfg, new Alpaca(f, id, secret), f, { TWELVEDATA_API_KEY: process.env.TWELVEDATA_API_KEY });
  d.checkClock = false;
  const dates: string[] = []; for (let x = from; x <= to; x = addDays(x, 1)) if (d.markets[market].sessionFor(x)) dates.push(x);
  const prov: Provenance = { universe: "current_assets", data: "historical_real", note: "Universum = heutiger Bestand der Anbieter-Instrumentenliste." };
  const res = await runBlind(d, market, dates, prov);
  console.log(res.log.join("\n"));
  console.log(renderReport(await evaluateTargets(d, market, targets, dates[dates.length - 1]), prov));
} else if (process.argv.includes("--fixture")) {
  const { fixtureBlindRun, FIXTURE_PROV } = await import("../test/fixtures/blindcase");
  const r = await fixtureBlindRun();
  console.log([...r.us.log, ...r.de.log].join("\n") + "\n");
  console.log("USA:\n" + renderReport(await evaluateTargets(r.d, "US", ["CROX", "ILMN", "NOPE"], r.usDates[r.usDates.length - 1]), FIXTURE_PROV));
  console.log("\nXetra:\n" + renderReport(await evaluateTargets(r.d, "DE", ["XETR:SRT3"], r.deDates[r.deDates.length - 1]), FIXTURE_PROV));
} else {
  console.log("Nutze --fixture oder --live (siehe Kopfkommentar).");
  void FakeAlpaca; void sessionFor;
}
