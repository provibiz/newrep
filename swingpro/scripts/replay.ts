/**
 * Lokaler Replay-Modus mit erfundenen TESTDATEN (src/replay/scenario.ts). Kein Netzwerk, keine Schlüssel, keine echte Mail.
 *   npm run replay                 → Ablauf in der Konsole
 *   npm run replay -- --write docs/BEISPIELMAILS.md
 * Der Lauf belegt die Funktion der Software, nicht die Profitabilität der Regeln.
 */
import { writeFileSync } from "node:fs";
import { createDb, cfgOf, makeDeps, FakeMail } from "../src/replay/fakes";
import { buildScenario, T } from "../src/replay/scenario";
import { runDaily } from "../src/jobs/daily";
import { runHourly } from "../src/jobs/hourly";
import { runIntraday } from "../src/jobs/intraday";
import { handleRequest } from "../src/web";
import { one, run } from "../src/store";
import { iso, MIN, nyToUtc } from "../src/time";

const ENV = { STATUS_TOKEN: "replay-status-token-000" };
const out: string[] = [];
const say = (s: string) => { console.log(s); out.push(s); };
const block = (title: string, m: { subject: string; text: string }) => say(`\n### ${title}\n\n**Betreff:** ${m.subject}\n\n\`\`\`\n${m.text}\n\`\`\``);

async function scenario(kind: "normal" | "missed") {
  const db = createDb(), sc = buildScenario(), mail = new FakeMail();
  const d = makeDeps(db, cfgOf({ MODE: "live" }), T.daily, { alpaca: sc.alpaca, mail });
  const post = (path: string, o: Record<string, string>) => handleRequest(new Request("https://swingpro.example" + path, { method: "POST", body: new URLSearchParams({ confirm: "yes", ...o }) }), d, ENV);
  say(`[TESTDATEN] ${kind}: ${await runDaily(d)}`);
  d.clock.t = T.hourly; say(`[TESTDATEN] Stundenscan: ${await runHourly(d)}`);
  d.clock.t = T.intraday;
  if (kind === "missed") {
    const sn = sc.alpaca.snaps.get("DEMO")!;
    sn.latestQuote = { t: iso(T.intraday - 3000), ap: sc.trigger + 1.2, bp: sc.trigger + 1.1 }; sn.latestTrade = { t: iso(T.intraday - 3000), p: sc.trigger + 1.15 };
  }
  say(`[TESTDATEN] 5-Minuten-Überwachung: ${await runIntraday(d)}`);
  const find = (p: string) => mail.sent.find((m) => m.subject.startsWith(p));
  if (kind === "missed") { block("Einstieg verpasst", find("Einstieg verpasst")!); return; }
  block("Vorwarnung", find("Vorwarnung")!);
  const entry = find("Einstieg bestätigt")!; block("Einstieg bestätigt", entry);
  const tok = entry.text.match(/\/a\/([A-Za-z0-9_-]+)/)![1];
  await post(`/a/${tok}`, { action: "buy", price: "102.45", shares: "18", fees: "1", request_id: "replay-buy-0001" });
  const pos = (await one<any>(db, "SELECT * FROM positions"))!;
  const target = pos.entry + 2 * (pos.entry - pos.initial_stop);
  d.clock.t = T.intraday + 50 * MIN;
  sc.alpaca.snaps.set("DEMO", { latestQuote: { t: iso(d.clock.t - 3000), ap: target + 0.3, bp: target + 0.25 }, latestTrade: { t: iso(d.clock.t - 2000), p: target + 0.28 }, dailyBar: { t: iso(nyToUtc(2026, 11, 24, 0, 0)), o: 101.5, h: 106, l: 100.9, c: 106, v: 1 } as any });
  await runIntraday(d);
  const part = find("Teilgewinn")!; block("Teilgewinn (+2R erreicht)", part);
  await post(`/a/${part.text.match(/\/a\/([A-Za-z0-9_-]+)/)![1]}`, { action: "partial", price: "106.00", shares: "9", fees: "1", request_id: "replay-sell-0001" });
  d.clock.t = Date.parse("2026-11-30T15:00:00Z");
  sc.alpaca.snaps.set("DEMO", { latestQuote: { t: iso(d.clock.t - 2000), ap: 99.4, bp: 99.3 }, latestTrade: { t: iso(d.clock.t - 1000), p: 99.35 }, dailyBar: { t: iso(nyToUtc(2026, 11, 30, 0, 0)), o: 99.8, h: 100, l: 99.2, c: 99.35, v: 1 } as any });
  await runIntraday(d);
  const ex = find("Ausstieg")!; block("Ausstieg (Kurslücke unter dem Stopp)", ex);
  await post(`/a/${ex.text.match(/\/a\/([A-Za-z0-9_-]+)/)![1]}`, { action: "exit", price: "99.20", shares: "", fees: "1", request_id: "replay-exit-0001" });
  const fin = await one<any>(db, "SELECT status, shares_sold, realized_pnl_usd FROM positions");
  say(`\n[TESTDATEN] Geschlossen: ${JSON.stringify(fin)} (realisiert vor Kaufgebühr 1,00 USD)`);
  void run;
}

say("# Beispiel-Mails aus dem Replay (TESTDATEN, erfundene Kurse)\n\nErzeugt mit `npm run replay -- --write docs/BEISPIELMAILS.md`. Adressen und Links sind Platzhalter; Tokens sind nur im Replay gültig.");
await scenario("normal");
await scenario("missed");
const i = process.argv.indexOf("--write");
if (i > 0) { writeFileSync(process.argv[i + 1], out.join("\n") + "\n"); console.log("geschrieben:", process.argv[i + 1]); }
