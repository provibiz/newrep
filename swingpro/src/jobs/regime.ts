import type { Deps } from "../deps";
import { all, one, setMeta, upsert, getMeta } from "../store";
import { dailyBars, type RawBar } from "../providers";
import { addDays } from "../time";
import { REGIME_ETFS, breadthFrom, leadership, followThroughDay, thinWeek, describeRegime, type Regime, type Ftd } from "../regime";

/** Tägliche Marktlage: Breite aus dem Universum, Führung und Erholungsversuch aus Referenz-ETFs. Fehlende Teile bleiben „nicht bewertet“. */
export async function updateRegime(d: Deps, last: string, now: number): Promise<Regime> {
  const src = `Alpaca-Tageskerzen (${d.cfg.dailyFeed === "sip" ? "SIP" : "IEX"}, Split-bereinigt)`;
  const row = await one<any>(d.db, "SELECT COUNT(*) n, COALESCE(SUM(nh),0) nh, COALESCE(SUM(nl),0) nl, COALESCE(SUM(a50),0) a50, COALESCE(SUM(a200),0) a200 FROM metrics WHERE asof=? AND n252>=252 AND price IS NOT NULL", last);
  const breadth = row ? breadthFrom(row, last, src) : null;
  let lead = null; const ftd: Ftd[] = [];
  try {
    const res = await d.alpaca.bars(REGIME_ETFS, "1Day", addDays(last, -400), new Date(Math.min(d.now() - 16 * 60_000, Date.parse(last + "T23:59:00Z") + 86_400_000)).toISOString(), d.cfg.dailyFeed, 4);
    const etf = new Map<string, ReturnType<typeof dailyBars>>();
    for (const [s, raw] of res.bars) etf.set(s, dailyBars(raw as RawBar[]));
    lead = leadership(etf, d.cfg, last, `${src}; Referenz-ETFs: SPDR-Sektorfonds und SPY`);
    for (const ix of ["SPY", "QQQ"]) if (etf.get(ix)) ftd.push(followThroughDay(ix, etf.get(ix)!, d.cfg));
  } catch { /* Führung/Erholungsversuch bleiben „nicht bewertet“ */ }
  const reg: Regime = { asof: last, breadth, leadership: lead, ftd, thinWeek: thinWeek(last), text: [] };
  reg.text = describeRegime(reg);
  await upsert(d.db, "regime", "asof", { asof: last, data: JSON.stringify(reg), updated_at: now });
  await setMeta(d.db, "regime", reg, now);
  return reg;
}
export const latestRegime = (d: Deps) => getMeta<Regime>(d.db, "regime");
export { all };
