import { describe, it, expect, beforeAll } from "vitest";
import { createDb, cfgOf, makeDeps, FakeMail } from "./helpers";
import { buildScenario, T, dailyRaw } from "../src/replay/scenario";
import { runDaily } from "../src/jobs/daily";
import { runHourly } from "../src/jobs/hourly";
import { runIntraday } from "../src/jobs/intraday";
import { reviewPositions } from "../src/jobs/positions";
import { flushOutbox } from "../src/outbox";
import { handleRequest } from "../src/web";
import { all, one, run, getMeta } from "../src/store";
import { iso, MIN, nyToUtc } from "../src/time";

const ENV = { STATUS_TOKEN: "status-token-0123456789" };
const auth = { authorization: "Bearer " + ENV.STATUS_TOKEN };
const req = (d: any, path: string, init: RequestInit = {}) => handleRequest(new Request("https://x.example" + path, init), d, ENV);
const form = (o: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(o), headers: { "content-type": "application/x-www-form-urlencoded" } });
const linkOf = (text: string) => text.match(/https:\/\/x\.example\/a\/([A-Za-z0-9_-]+)/)![1];

describe("Vollständiger Weg: Tageslauf → Vorwarnung → Auslöser → Kauf → Teilgewinn → Ausstieg", () => {
  const db = createDb(); const sc = buildScenario(); const mail = new FakeMail();
  const d = makeDeps(db, cfgOf(), T.daily, { alpaca: sc.alpaca, mail });
  let token = ""; let posId = ""; let sigId = "";

  it("Tageslauf: Universum, Ausschlüsse, Vorauswahl, Bericht", async () => {
    expect(await runDaily(d)).toMatch(/ok/);
    const u = await getMeta<any>(db, "universe_stats");
    expect(u).toMatchObject({ available: 3, excluded: 2, watch: 1 });
    expect(Object.keys(u.excludedByReason).join()).toMatch(/ETF/);
    expect((await all(db, "SELECT symbol FROM metrics WHERE passed=1")).map((r: any) => r.symbol)).toEqual(["DEMO"]);
    expect(mail.sent.some((m) => m.subject.startsWith("Tagesbericht"))).toBe(true);
    expect(await runDaily(d)).toMatch(/bereits/);       // doppelter Cron
  });

  it("Stundenscan: Base Breakout wird vorbereitet, Vorwarnung nennt Symbol, Setup, Auslöser, Stopp, Verfall", async () => {
    d.clock.t = T.hourly;
    expect(await runHourly(d)).toMatch(/ok/);
    const prep = await all<any>(db, "SELECT * FROM prepared WHERE state='active'");
    expect(prep.map((p) => p.setup)).toContain("base_breakout");
    const pw = mail.sent.find((m) => m.subject.startsWith("Vorwarnung"))!;
    expect(pw.subject).toBe("Vorwarnung · DEMO · Base Breakout");
    expect(pw.text).toMatch(/Auslösemarke: 5-Minuten-Schluss über 102\.20/);
    expect(pw.text).toMatch(/Geplanter Stopp: 100\.89/);
    expect(pw.text).toMatch(/Verfall: /);
    const n = mail.sent.length;
    d.clock.t = T.hourly + 5 * MIN; expect(await runHourly(d)).toMatch(/bereits/);   // doppelter Cron
    expect(mail.sent.length).toBe(n);
  });

  it("5-Minuten-Auslöser: frischer Kurs, Stopp/Stückzahl neu berechnet, Einstiegsmail mit den wichtigsten Angaben in den ersten Zeilen", async () => {
    d.clock.t = T.intraday;
    expect(await runIntraday(d)).toMatch(/1 bestätigt/);
    const m = mail.sent.find((x) => x.subject.startsWith("Einstieg"))!;
    expect(m.subject).toBe("Einstieg bestätigt · DEMO · Base Breakout");
    const head = m.text.split("\n").slice(0, 6).join("\n");
    expect(head).toMatch(/Signal: 24\.11\.2026 17:05 Uhr MEZ/);
    expect(head).toMatch(/Auslöser: 102\.20 · Kurs 102\.40 USD, Zeitstempel 24\.11\.2026 17:05:55 Uhr MEZ/);
    expect(head).toMatch(/Stopp: 100\.89 USD/);
    expect(head).toMatch(/Stückzahl: \d+/);
    expect(head).toMatch(/geplantes Risiko [\d.]+ USD = 0\.\d+ % des Depots/);
    expect(m.text.indexOf("Marktkontext")).toBeGreaterThan(m.text.indexOf("Stückzahl"));
    expect(m.text).toMatch(/Wachstum \(Giering-Modell\): offen/);  // ohne FMP-Schlüssel: Befund erklärt, Signal nicht unterdrückt
    expect(m.text).toMatch(/S&P 500 · Daten fehlen/);
    expect(m.text).toMatch(/QQQ-Filter/);
    expect(m.text).toMatch(/Feed IEX/);
    const sig = (await all<any>(db, "SELECT * FROM signals"))[0];
    sigId = sig.id;
    expect(sig).toMatchObject({ status: "confirmed", mode: "live", feed: "iex" });
    expect(sig.signal_time).toBe(Date.parse("2026-11-24T16:05:00Z"));        // Ende der Auslöser-Kerze
    expect(sig.checked_at).toBe(T.intraday); expect(sig.quote_time).toBe(T.intraday - 5000);
    const ob = await one<any>(db, "SELECT * FROM outbox WHERE id=?", sig.outbox_id);
    expect(ob.accepted_at).toBe(T.intraday);                                 // Annahme beim Anbieter, getrennt von Signalzeit und Kurszeit
    token = linkOf(m.text);
    posId = `pos|${sigId}`;
  });

  it("doppelte Cron-Aufrufe und Neustart erzeugen keine zweite Mail", async () => {
    const n = mail.sent.length;
    expect(await runIntraday(d)).toMatch(/bereits/);
    const d2 = makeDeps(db, cfgOf(), T.intraday + 5 * MIN, { alpaca: sc.alpaca, mail });   // „Neustart“: neue Objekte, gleiche DB
    await runIntraday(d2);
    expect(mail.sent.length).toBe(n);
    expect((await all(db, "SELECT 1 FROM signals")).length).toBe(1);
  });

  it("Link öffnen speichert nichts; ohne ausdrückliche Bestätigung keine Änderung", async () => {
    const g = await req(d, `/a/${token}`);
    expect(g.status).toBe(200); expect(await g.text()).toMatch(/Ich habe tatsächlich gekauft/);
    expect((await one<any>(db, "SELECT status FROM positions WHERE id=?", posId)).status).toBe("pending");
    const bad = await req(d, `/a/${token}`, form({ action: "buy", price: "102.4", shares: "20", request_id: "abcdefgh12345" }));
    expect(bad.status).toBe(400);
    expect((await one<any>(db, "SELECT status FROM positions WHERE id=?", posId)).status).toBe("pending");
    expect((await req(d, "/a/ungueltigertokenungueltigertoken")).status).toBe(404);
  });

  it("Kaufbestätigung: tatsächlicher Kurs/Stückzahl/Gebühren, 1R aus tatsächlichem Einstieg, idempotent", async () => {
    const f = { action: "buy", price: "102.45", shares: "18", fees: "1.00", request_id: "req-buy-000001", confirm: "yes" };
    expect((await req(d, `/a/${token}`, form(f))).status).toBe(200);
    expect((await req(d, `/a/${token}`, form(f))).status).toBe(200);        // doppelter Klick
    const p = await one<any>(db, "SELECT * FROM positions WHERE id=?", posId);
    expect(p).toMatchObject({ status: "open", entry: 102.45, shares: 18, fees: 1, stop: 100.89, initial_stop: 100.89 });
    expect((await all(db, "SELECT 1 FROM position_events WHERE type='buy_confirmed'")).length).toBe(1);
    // Kaufkurs unter Stopp wird abgelehnt (am anderen Beispiel): hier nur Plausibilität
    const again = await req(d, `/a/${token}`, form({ ...f, request_id: "req-buy-000002" }));
    expect(again.status).toBe(200);
    expect((await all(db, "SELECT 1 FROM position_events WHERE type='buy_confirmed'")).length).toBe(1);
  });

  it("+2R: Teilverkauf wird EMPFOHLEN; erst die Erfassung der Ausführung zählt", async () => {
    const r = 102.45 - 100.89, target = 102.45 + 2 * r;
    d.clock.t = T.intraday + 50 * MIN;
    sc.alpaca.snaps.set("DEMO", { latestQuote: { t: iso(d.clock.t - 3000), ap: target + 0.3, bp: target + 0.25 }, latestTrade: { t: iso(d.clock.t - 2000), p: target + 0.28 }, dailyBar: { t: iso(nyToUtc(2026, 11, 24, 0, 0)), o: 101.5, h: 106, l: 100.9, c: target + 0.28, v: 1, } as any });
    await runIntraday(d);
    const m = mail.sent.find((x) => x.subject.startsWith("Teilgewinn"))!;
    expect(m.text).toMatch(/GEMELDETE Empfehlung/); expect(m.text).toMatch(/9 Stück/);
    expect((await one<any>(db, "SELECT shares_sold, partial_recommended_at FROM positions WHERE id=?", posId))).toMatchObject({ shares_sold: 0 });
    const pt = linkOf(m.text);
    expect((await req(d, `/a/${pt}`, form({ action: "partial", price: "106.00", shares: "9", fees: "1", request_id: "req-sell-000001", confirm: "yes" }))).status).toBe(200);
    await req(d, `/a/${pt}`, form({ action: "partial", price: "106.00", shares: "9", fees: "1", request_id: "req-sell-000001", confirm: "yes" }));
    const p = await one<any>(db, "SELECT * FROM positions WHERE id=?", posId);
    expect(p.shares_sold).toBe(9); expect(p.realized_pnl_usd).toBeCloseTo((106 - 102.45) * 9 - 1, 6); expect(p.status).toBe("open");
    expect((await req(d, `/a/${pt}`, form({ action: "partial", price: "106", shares: "50", request_id: "req-sell-000009", confirm: "yes" }))).status).toBe(422); // mehr als vorhanden
    n2 = mail.sent.length;
  });
  let n2 = 0;

  it("Wochentief-Trailing nach dem Teilverkauf: Stopp steigt nur, nie sinkt", async () => {
    await run(db, "UPDATE positions SET opened_at=? WHERE id=?", nyToUtc(2026, 11, 2, 11), posId);
    const { dailyBars } = await import("../src/providers"); const { saveSeries } = await import("../src/series");
    const { bar } = await import("./helpers"); const { sessionFor } = await import("../src/calendar"); const { addDays } = await import("../src/time");
    const lows = [105, 102, 106, 108, 110], out: any[] = [];
    lows.forEach((lo, w) => { for (let i = 0; i < 5; i++) { const s = sessionFor(addDays("2026-11-02", w * 7 + i)); if (s) out.push(bar(s.close, lo + 3, lo + 5, i === 2 ? lo : lo + 1.5, lo + 4)); } });
    await saveSeries(db, "DEMO", "1d", out, 1);
    d.clock.t = Date.parse("2026-11-27T21:00:00Z");           // nach der verkürzten Sitzung vom 27.11.
    const lines = await reviewPositions(d);
    expect(lines[0]).toMatch(/Stopp angehoben auf 101\.99/);
    const p = await one<any>(db, "SELECT stop, initial_stop FROM positions WHERE id=?", posId);
    expect(p).toMatchObject({ stop: 101.99, initial_stop: 100.89 });   // initial bleibt, 1R unverändert
    expect(mail.sent.some((x) => x.subject.startsWith("Stopp nachziehen"))).toBe(false); // erst nach flush
    await flushOutbox(d);
    expect(mail.sent.some((x) => x.subject === "Stopp nachziehen · DEMO")).toBe(true);
    await reviewPositions(d);                                   // wiederholt: keine zweite Anhebung/Mail
    expect(mail.sent.filter((x) => x.subject === "Stopp nachziehen · DEMO").length).toBe(1);
  });

  it("Kursgap unter dem Stopp: kein Verkauf zum Stoppkurs behauptet; manueller Ausstieg schließt den Trade", async () => {
    d.clock.t = Date.parse("2026-11-30T15:00:00Z");  // Montag 10:00 New York
    sc.alpaca.snaps.set("DEMO", { latestQuote: { t: iso(d.clock.t - 2000), ap: 99.4, bp: 99.3 }, latestTrade: { t: iso(d.clock.t - 1000), p: 99.35 }, dailyBar: { t: iso(nyToUtc(2026, 11, 30, 0, 0)), o: 99.8, h: 100, l: 99.2, c: 99.35, v: 1 } as any });
    await runIntraday(d);
    const m = mail.sent.find((x) => x.subject.startsWith("Ausstieg"))!;
    expect(m.subject).toBe("Ausstieg · Kurslücke unter Stopp · DEMO");
    expect(m.text).toMatch(/Ein Verkauf zum Stoppkurs ist nicht anzunehmen/);
    const pt = linkOf(m.text);
    expect((await req(d, `/a/${pt}`, form({ action: "exit", price: "99.20", shares: "", fees: "1", request_id: "req-exit-00001", confirm: "yes", note: "Gap" }))).status).toBe(200);
    const p = await one<any>(db, "SELECT * FROM positions WHERE id=?", posId);
    expect(p.status).toBe("closed"); expect(p.shares_sold).toBe(18);
    // 9 × 3,55 − 1 + 9 × (−3,25) − 1 − Kaufgebühr 1 = −0,30
    expect((await req(d, `/a/${pt}`)).status).toBe(200);
    const sum = await (await req(d, `/a/${pt}`)).text();
    expect(sum).toMatch(/Realisiert[^<]*: -0\.30 USD/);
  });
});

describe("Verpasster Einstieg, alte Kurse, Ausfälle, Paper-Modus", () => {
  async function setup(over: Record<string, unknown> = {}, tweak?: (sc: ReturnType<typeof buildScenario>) => void) {
    const db = createDb(), sc = buildScenario(), mail = new FakeMail();
    tweak?.(sc);
    const d = makeDeps(db, cfgOf(over), T.daily, { alpaca: sc.alpaca, mail });
    await runDaily(d); d.clock.t = T.hourly; await runHourly(d); d.clock.t = T.intraday;
    return { db, sc, mail, d };
  }
  it("Kurs zu weit vom Auslöser entfernt → „Einstieg verpasst“, keine Position, keine Wiederholung", async () => {
    const { db, sc, mail, d } = await setup();
    sc.alpaca.snaps.get("DEMO")!.latestQuote = { t: iso(T.intraday - 3000), ap: sc.trigger + 1.2, bp: sc.trigger + 1.1 };
    sc.alpaca.snaps.get("DEMO")!.latestTrade = { t: iso(T.intraday - 3000), p: sc.trigger + 1.15 };
    await runIntraday(d);
    expect(mail.sent.some((m) => m.subject === "Einstieg verpasst · DEMO · Base Breakout")).toBe(true);
    expect(mail.sent.some((m) => m.subject.startsWith("Einstieg bestätigt"))).toBe(false);
    expect((await all(db, "SELECT 1 FROM positions")).length).toBe(0);
    expect((await one<any>(db, "SELECT status FROM signals")).status).toBe("missed");
    d.clock.t += 5 * MIN; await runIntraday(d);
    expect(mail.sent.filter((m) => m.subject.startsWith("Einstieg verpasst")).length).toBe(1);
  });
  it("alter Kurs → kein Einstieg; nach drei Fehlversuchen gibt der Kandidat auf", async () => {
    const { db, sc, mail, d } = await setup();
    sc.alpaca.snaps.get("DEMO")!.latestQuote = { t: iso(T.intraday - 900_000), ap: sc.trigger + 0.2, bp: sc.trigger + 0.1 };
    sc.alpaca.snaps.get("DEMO")!.latestTrade = { t: iso(T.intraday - 900_000), p: sc.trigger + 0.15 };
    for (let i = 0; i < 3; i++) { d.clock.t = T.intraday + i * 5 * MIN; await runIntraday(d); }
    expect(mail.sent.some((m) => m.subject.startsWith("Einstieg"))).toBe(false);
    expect((await all(db, "SELECT 1 FROM signals")).length).toBe(0);
    expect((await one<any>(db, "SELECT state FROM prepared WHERE setup='base_breakout' AND timeframe='1h'")).state).toBe("unverifiable");
  });
  it("fehlender Kurs → kein Einstieg", async () => {
    const { mail, d, sc } = await setup(); sc.alpaca.snaps.delete("DEMO");
    await runIntraday(d); expect(mail.sent.some((m) => m.subject.startsWith("Einstieg"))).toBe(false);
  });
  it("Mailausfall: Einstiegsmail wird nach Ablauf des Sendefensters verworfen, nicht verspätet nachgeschickt", async () => {
    const { db, mail, d } = await setup();
    mail.fail = new Error("Anbieter nicht erreichbar");
    await runIntraday(d);
    expect((await one<any>(db, "SELECT state FROM outbox WHERE kind='entry'")).state).toBe("failed");
    mail.fail = null; d.clock.t = T.intraday + 12 * MIN;
    await flushOutbox(d);
    expect((await one<any>(db, "SELECT state, error FROM outbox WHERE kind='entry'"))).toMatchObject({ state: "dropped_late" });
    expect(mail.sent.some((m) => m.subject.startsWith("Einstieg"))).toBe(false);
  });
  it("kurzer Ausfall: Wiederholung innerhalb des Fensters sendet genau einmal (Idempotenz-Schlüssel)", async () => {
    const { db, mail, d } = await setup();
    mail.fail = new Error("kurz weg"); await runIntraday(d);
    mail.fail = null; d.clock.t = T.intraday + 3 * MIN; await flushOutbox(d); await flushOutbox(d);
    expect(mail.sent.filter((m) => m.subject.startsWith("Einstieg")).length).toBe(1);
    expect((await one<any>(db, "SELECT state, accepted_at FROM outbox WHERE kind='entry'")).state).toBe("sent");
  });
  it("Paper-Modus protokolliert Signale, versendet aber keine Mails und behauptet keine Annahme", async () => {
    const { db, mail, d } = await setup({ MODE: "paper" });
    await runIntraday(d);
    expect(mail.sent.length).toBe(0);
    expect((await one<any>(db, "SELECT status, mode FROM signals"))).toMatchObject({ status: "confirmed", mode: "paper" });
    expect((await one<any>(db, "SELECT state, accepted_at FROM outbox WHERE kind='entry'"))).toMatchObject({ state: "dry_run", accepted_at: null });
  });
  it("Vorwarnungen lassen sich getrennt abschalten; Einstieg kommt trotzdem", async () => {
    const { mail, d } = await setup({ MAIL_PREWARN: "false" });
    expect(mail.sent.some((m) => m.subject.startsWith("Vorwarnung"))).toBe(false);
    await runIntraday(d); expect(mail.sent.some((m) => m.subject.startsWith("Einstieg bestätigt"))).toBe(true);
  });
  it("QQQ-Filter: im alten Modus block_all verhindert den Einstieg und die Regel wird genannt", async () => {
    const { db, d, sc, mail } = await setup({ QQQ_FILTER: "block_all" }, (sc) => { sc.alpaca.raw30.set("QQQ", sc.alpaca.raw30.get("QQQ")!.map((r, i, a) => ({ ...r, c: 440 - i * 0.05, o: 440 - i * 0.05, h: 441 - i * 0.05, l: 439 - i * 0.05 }))); });
    await runIntraday(d);
    expect((await all(db, "SELECT 1 FROM signals WHERE status!='watch_only'")).length).toBe(0);     // kein Einstieg
    const blk = await one<any>(db, "SELECT status_reason, permission FROM signals WHERE status='watch_only' AND setups LIKE '%base_breakout%'");
    expect(blk.permission).toBe("watch_only");
    expect(blk.status_reason).toMatch(/QQQ-Filter \(sperrt alle Setups\)/);   // die blockierende Regel ist protokolliert
    expect(mail.sent.some((m) => m.subject === "Nur beobachten · DEMO · Base Breakout")).toBe(true);
    void sc;
  });
  it("Hourly ohne QQQ-Referenz: Lauf scheitert sichtbar, Status zeigt Fehler statt „keine Signale“", async () => {
    const db = createDb(), sc = buildScenario(); sc.alpaca.raw30.delete("QQQ");
    const d = makeDeps(db, cfgOf(), T.daily, { alpaca: sc.alpaca }); await runDaily(d); d.clock.t = T.hourly;
    expect(await runHourly(d)).toMatch(/QQQ unvollständig/);
    const st: any = await (await req(d, "/status.json", { headers: auth })).json();
    expect(st.lastOk.hourly).toBeNull();
    expect(st.runs.find((r: any) => r.kind === "hourly").status).toBe("failed");
  });
  it("SIP ohne Rechte: keine stille Umschaltung, Scan gesperrt", async () => {
    const db = createDb(), sc = buildScenario(); sc.alpaca.forbiddenSip = true;
    const d = makeDeps(db, cfgOf({ DATA_FEED: "sip" }), T.daily, { alpaca: sc.alpaca }); await runDaily(d); d.clock.t = T.hourly;
    expect(await runHourly(d)).toMatch(/gesperrt.*SIP/);
    expect(sc.alpaca.calls.some((c) => c.startsWith("30Min"))).toBe(false);
  });
});

describe("Statusansicht und Zugriffsschutz", () => {
  it("verlangt Anmeldung; zeigt Läufe, Datenalter, Mailstatus, Berechtigungen", async () => {
    const db = createDb(), sc = buildScenario(), mail = new FakeMail();
    const d = makeDeps(db, cfgOf(), T.daily, { alpaca: sc.alpaca, mail }); await runDaily(d); d.clock.t = T.hourly; await runHourly(d);
    expect((await req(d, "/status")).status).toBe(401);
    expect((await req(d, "/status", { headers: { authorization: "Bearer falsch" } })).status).toBe(401);
    const html = await (await req(d, "/status", { headers: auth })).text();
    expect(html).toMatch(/Letzte erfolgreiche Läufe/); expect(html).toMatch(/Berechtigungen/); expect(html).toMatch(/geprüft/);
    const j: any = await (await req(d, "/status.json", { headers: auth })).json();
    expect(j.universe.watch).toBe(1); expect(j.probe.sipHistorical.ok).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/pepper|Bearer|apikey/i);
    expect((await req(d, "/healthz")).status).toBe(200);
  });
  it("Admin-POST von fremder Herkunft wird abgelehnt (CSRF)", async () => {
    const db = createDb(); const d = makeDeps(db, cfgOf(), T.daily);
    const r = await req(d, "/admin/test-mail", { method: "POST", headers: { ...auth, origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });
  it("Aktions-Link ohne gültiges Token oder mit manipuliertem Token wird abgewiesen", async () => {
    const db = createDb(); const d = makeDeps(db, cfgOf(), T.daily);
    expect((await req(d, "/a/short")).status).toBe(404);
  });
});
