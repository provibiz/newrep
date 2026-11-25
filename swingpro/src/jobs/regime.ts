import type { Deps } from "../deps";
import { one, setMeta, upsert, getMeta } from "../store";
import { addDays } from "../time";
import { REGIME_ETFS, breadthFrom, leadership, followThroughDay, thinWeek, describeRegime, type Regime, type Ftd } from "../regime";
import type { Market } from "../markets";

/**
 * Tägliche Marktlage je Markt: Breite aus dem Universum dieses Marktes. USA zusätzlich Führung (Sektor-ETFs) und Erholungsversuch (SPY/QQQ).
 * Deutschland: Führungsgruppen und Index-Erholungsversuch sind mangels angebundener Index-/ETF-Daten „nicht bewertet“ (sichtbare Lücke).
 */
export async function updateRegime(d: Deps, mk: Market, last: string, now: number): Promise<Regime> {
  const src = `${mk.data.feedLabel}, Tageskerzen, Split-bereinigt`;
  const row = await one<any>(d.db, "SELECT COUNT(*) n, COALESCE(SUM(nh),0) nh, COALESCE(SUM(nl),0) nl, COALESCE(SUM(a50),0) a50, COALESCE(SUM(a200),0) a200 FROM metrics WHERE asof=? AND market=? AND n252>=252 AND price IS NOT NULL", last, mk.id);
  const uni = mk.id === "US" ? undefined : "Xetra-Aktien (Stamm- und Vorzugsaktien) nach den Ausschlüssen aus REGELN.md mit mindestens 252 Handelstagen Historie";
  const breadth = row ? breadthFrom(row, last, src, uni) : null;
  let lead = null; const ftd: Ftd[] = [];
  if (mk.id === "US") {
    try {
      const res = await mk.data.dailyBars(REGIME_ETFS, addDays(last, -400), Math.min(d.now() - mk.dailyDelayMin * 60_000, Date.parse(last + "T23:59:00Z") + 86_400_000));
      lead = leadership(res.bars, d.cfg, last, `${src}; Referenz-ETFs: SPDR-Sektorfonds und SPY`);
      for (const ix of ["SPY", "QQQ"]) if (res.bars.get(ix)) ftd.push(followThroughDay(ix, res.bars.get(ix)!, d.cfg));
    } catch { /* Führung/Erholungsversuch bleiben „nicht bewertet“ */ }
  } else {
    ftd.push({ index: "DAX", state: "kein Erholungsversuch", day: null, date: null, text: "Erholungsversuch/Follow-Through-Day: nicht bewertet (keine Indexdaten für DAX/MDAX angebunden)" });
  }
  const reg: Regime = { asof: last, breadth, leadership: lead, ftd, thinWeek: thinWeek(last, mk), text: [] };
  reg.text = describeRegime(reg);
  await upsert(d.db, "regime", "asof", { asof: `${mk.id}:${last}`, data: JSON.stringify(reg), updated_at: now });
  await setMeta(d.db, `regime:${mk.id}`, reg, now);
  return reg;
}
export const latestRegime = (d: Deps, market: string) => getMeta<Regime>(d.db, `regime:${market}`);
