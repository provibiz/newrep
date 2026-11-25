import type { Deps } from "../deps";
import { getMeta, setMeta, logError } from "../store";
import { lastCompletedSession } from "../calendar";
import { sp500Context, type SpContext } from "../market";
import { growthScore, type GrowthResult } from "../growth";
import { addDays, nyDate } from "../time";
import { HttpError } from "../providers";
import { marketOfKey } from "../markets";

/** S&P 500 gegenüber SMA200. Nur das abgeleitete Ergebnis wird gespeichert (FRED-Nutzungsbedingungen: kein Caching der Rohdaten). */
export async function spContext(d: Deps): Promise<SpContext> {
  const now = d.now();
  const last = lastCompletedSession(now, 5);
  const cached = await getMeta<{ at: number; ctx: SpContext }>(d.db, "sp_context");
  if (cached && cached.ctx.lastCompleted === last && (cached.ctx.isLastCompleted || now - cached.at < 30 * 60_000) && cached.ctx.state !== "unbekannt") return cached.ctx;
  try {
    const csv = await d.fred(addDays(last, -380), last);
    const ctx = sp500Context(csv, last);
    await setMeta(d.db, "sp_context", { at: now, ctx }, now);
    return ctx;
  } catch (e) {
    await logError(d.db, "fred", e, now);
    return { state: "unbekannt", obsDate: null, close: null, sma200: null, lastCompleted: last, isLastCompleted: false, text: `S&P 500 · Abruf bei FRED fehlgeschlagen; letzter abgeschlossener Handelstag wäre ${last}` };
  }
}

export async function growthFor(d: Deps, symbol: string): Promise<GrowthResult> {
  const now = d.now(), today = nyDate(now);
  const open = (reason: string): GrowthResult => ({ verdict: "offen", revenuePct: null, epsPct: null, period: null, filingDate: null, reason, text: `Wachstum (Giering-Modell): offen · ${reason}` });
  if (marketOfKey(symbol) === "DE") return open("Quartalsdaten für Xetra-Titel nicht angebunden (FMP-Abdeckung für Xetra nicht verifiziert) – Setup wird dadurch nicht unterdrückt");
  if (!d.fmp) return open("FMP_API_KEY nicht gesetzt – keine Quartalsdaten");
  const cached = await getMeta<{ day: string; r: GrowthResult }>(d.db, `growth:${symbol}`);
  if (cached && cached.day === today) return cached.r;
  try {
    const r = growthScore(await d.fmp.income(symbol), today, d.cfg);
    await setMeta(d.db, `growth:${symbol}`, { day: today, r }, now);
    return r;
  } catch (e) {
    await logError(d.db, "fmp", e, now);
    return open(e instanceof HttpError && (e.status === 402 || e.status === 403) ? "Quartalsdaten im FMP-Tarif nicht enthalten (HTTP " + e.status + ")" : "FMP-Abruf fehlgeschlagen");
  }
}
