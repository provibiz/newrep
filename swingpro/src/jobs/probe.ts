/** Berechtigungsprüfung mit kleinen Testabfragen. Ergebnis wird gespeichert und in der Statusansicht gezeigt. Keine stille Umschaltung. */
import type { Deps } from "../deps";
import { getMeta, setMeta } from "../store";
import { HttpError } from "../providers";
import { MIN, DAY, nyDate, addDays } from "../time";
import { lastCompletedSession } from "../calendar";

export interface ProbeItem { ok: boolean; detail: string }
export interface ProbeResult {
  at: number;
  alpacaAuth: ProbeItem; iexRealtime: ProbeItem; sipHistorical: ProbeItem; sipRealtime: ProbeItem;
  fmpIncome: ProbeItem; fmpEarnings: ProbeItem; fred: ProbeItem;
  summary: string[];
}

async function t(fn: () => Promise<string>): Promise<ProbeItem> {
  try { return { ok: true, detail: await fn() }; }
  catch (e) { return { ok: false, detail: e instanceof HttpError ? `HTTP ${e.status}` : e instanceof Error ? e.message.slice(0, 120) : String(e) }; }
}

export async function runProbe(d: Deps): Promise<ProbeResult> {
  const now = d.now();
  const last = lastCompletedSession(now, 20);
  const recentStart = new Date(now - 3 * DAY).toISOString();
  const alpacaAuth = await t(async () => { const c = await d.alpaca.clock(); return `Uhr ok, Börse ${c.is_open ? "offen" : "geschlossen"}`; });
  const iexRealtime = await t(async () => {
    const r = await d.alpaca.bars(["AAPL"], "5Min", recentStart, new Date(now - 2 * MIN).toISOString(), "iex", 1);
    return `${r.bars.get("AAPL")?.length ?? 0} Kerzen (IEX); Echtzeit-Aktualität nur zu Handelszeiten prüfbar`;
  });
  const sipHistorical = await t(async () => {
    const r = await d.alpaca.bars(["AAPL"], "1Day", addDays(last, -10), new Date(now - 20 * MIN).toISOString(), "sip", 1);
    return `${r.bars.get("AAPL")?.length ?? 0} Tageskerzen (SIP, älter als 15 Min)`;
  });
  const sipRealtime = await t(async () => {
    const r = await d.alpaca.bars(["AAPL"], "1Min", new Date(now - 30 * MIN).toISOString(), new Date(now - 1 * MIN).toISOString(), "sip", 1);
    return `SIP-Abfrage der letzten 15 Minuten erlaubt (${r.bars.get("AAPL")?.length ?? 0} Kerzen)`;
  });
  const fmpIncome = d.fmp ? await t(async () => { const r = await d.fmp!.income("AAPL"); if (!r.length) throw new Error("leere Antwort"); return `${r.length} Quartale`; }) : { ok: false, detail: "FMP_API_KEY nicht gesetzt" };
  const fmpEarnings = d.fmp ? await t(async () => { const m = await d.fmp!.earningsCalendar(addDays(nyDate(now), -3), nyDate(now), now); return `${m.size} Einträge`; }) : { ok: false, detail: "FMP_API_KEY nicht gesetzt" };
  const fred = await t(async () => { const csv = await d.fred(addDays(last, -10), last); return `${csv.split("\n").length - 1} Zeilen`; });
  const s: string[] = [];
  s.push(d.cfg.feed === "iex" ? (iexRealtime.ok ? "Kostenlos nutzbar: IEX-Echtzeit (ein Handelsplatz)." : "IEX-Abfrage fehlgeschlagen: Alpaca-Schlüssel prüfen.") :
    sipRealtime.ok ? "SIP in Echtzeit verfügbar." : "DATA_FEED=sip, aber keine Echtzeit-SIP-Rechte (kostenpflichtiger Tarif nötig) – Scans sind GESPERRT, es wird nicht auf IEX umgeschaltet.");
  s.push(sipHistorical.ok ? "Tageskerzen via SIP (historisch, >15 Min alt) verfügbar." : "SIP-Tageskerzen nicht abrufbar: DAILY_FEED=iex setzen (Dollarumsatz-Schwelle dann senken).");
  if (!fmpIncome.ok) s.push("Wachstumsdaten (FMP) nicht verfügbar: Urteil bleibt „offen“, Setups werden nicht unterdrückt.");
  if (!fmpEarnings.ok) s.push("Earnings-Kalender (FMP) nicht verfügbar: Episodic Pivot deaktiviert.");
  const res: ProbeResult = { at: now, alpacaAuth, iexRealtime, sipHistorical, sipRealtime, fmpIncome, fmpEarnings, fred, summary: s };
  await setMeta(d.db, "probe", res, now);
  return res;
}

/** Wirft, wenn der konfigurierte Feed laut Probe nicht erlaubt ist. */
export async function assertFeed(d: Deps): Promise<string | null> {
  if (d.cfg.feed !== "sip") return null;
  let p = await getMeta<ProbeResult>(d.db, "probe");
  if (!p || d.now() - p.at > DAY) p = await runProbe(d);
  return p.sipRealtime.ok ? null : "DATA_FEED=sip ohne Echtzeit-SIP-Rechte: gesperrt (keine stille Umschaltung auf IEX)";
}
