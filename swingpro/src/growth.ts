/** Giering-Teilmodell: Wachstum des letzten Quartals gegenüber demselben Vorjahresquartal (FMP income-statement). */
import type { Config } from "./config";
import { addDays } from "./time";

export interface IncomeRow {
  date: string; period: string; fiscalYear: string | number; reportedCurrency?: string;
  filingDate?: string; acceptedDate?: string; revenue?: number | null; epsDiluted?: number | null; symbol?: string;
}
export interface GrowthResult {
  verdict: "kandidat" | "verfehlt" | "offen";
  revenuePct: number | null;
  epsPct: number | null;
  period: string | null;     // z. B. "Q3 2026 (Periodenende 2026-09-30)"
  filingDate: string | null;
  reason: string | null;     // Erklärung bei offen/verfehlt
  text: string;
}
const open = (reason: string, extra: Partial<GrowthResult> = {}): GrowthResult => ({
  verdict: "offen", revenuePct: null, epsPct: null, period: null, filingDate: null, reason, ...extra,
  text: `Wachstum (Giering-Modell): offen · ${reason}`,
});

/** today = Signaltag (NY). Meldungen vom selben Tag zählen nicht: Veröffentlichungszeit ist nicht belegt. */
export function growthScore(rows: IncomeRow[], today: string, cfg: Pick<Config, "growthMinRevenue" | "growthMinEps" | "growthMaxAgeDays">): GrowthResult {
  const q = rows.filter((r) => ["Q1", "Q2", "Q3", "Q4"].includes(r.period) && r.filingDate && r.filingDate < today);
  if (!q.length) return open("keine verwendbaren Quartalsdaten (nur Filings bis zum Vortag zählen)");
  const latest = q.reduce((a, b) => (b.date > a.date ? b : a));
  const label = `${latest.period} ${latest.fiscalYear} (Periodenende ${latest.date}, Filing ${latest.filingDate})`;
  const ageDays = Math.round((Date.parse(today) - Date.parse(latest.date)) / 86400000);
  if (ageDays <= 0 || ageDays > cfg.growthMaxAgeDays) return open(`jüngstes Quartal ${label} ist ${ageDays} Tage alt (Grenze ${cfg.growthMaxAgeDays})`, { period: label, filingDate: latest.filingDate ?? null });
  const prev = q.find((r) => r.period === latest.period && Number(r.fiscalYear) === Number(latest.fiscalYear) - 1);
  if (!prev) return open(`kein Vorjahresquartal ${latest.period} ${Number(latest.fiscalYear) - 1} verfügbar`, { period: label, filingDate: latest.filingDate ?? null });
  if (!latest.reportedCurrency || latest.reportedCurrency !== prev.reportedCurrency) return open("Berichtswährung fehlt oder weicht ab", { period: label, filingDate: latest.filingDate ?? null });
  const nums = [latest.revenue, prev.revenue, latest.epsDiluted, prev.epsDiluted];
  if (!nums.every((x) => typeof x === "number" && Number.isFinite(x))) return open("Umsatz oder verwässertes EPS fehlt", { period: label, filingDate: latest.filingDate ?? null });
  const rev = (latest.revenue! / prev.revenue! - 1) * 100;
  if (!(prev.revenue! > 0)) return open("Vorjahresumsatz ≤ 0", { period: label, filingDate: latest.filingDate ?? null });
  if (!(prev.epsDiluted! > 0)) {
    return open(`Vorjahres-EPS ${prev.epsDiluted} ≤ 0: prozentuales Wachstum nicht sinnvoll (aktuell ${latest.epsDiluted}, Umsatz ${rev >= 0 ? "+" : ""}${rev.toFixed(1)} %)`,
      { period: label, filingDate: latest.filingDate ?? null, revenuePct: rev });
  }
  const eps = (latest.epsDiluted! / prev.epsDiluted! - 1) * 100;
  const ok = rev >= cfg.growthMinRevenue - 1e-8 && eps >= cfg.growthMinEps - 1e-8;
  const v = ok ? "Wachstumskandidat (möglicher längerer Läufer)" : "Schwellen verfehlt";
  return {
    verdict: ok ? "kandidat" : "verfehlt", revenuePct: rev, epsPct: eps, period: label, filingDate: latest.filingDate ?? null,
    reason: null,
    text: `Wachstum (Giering-Modell): ${v} · Umsatz ${rev >= 0 ? "+" : ""}${rev.toFixed(1)} %, verwässertes EPS ${eps >= 0 ? "+" : ""}${eps.toFixed(1)} % ggü. Vorjahresquartal · ${label} · Schwellen ${cfg.growthMinRevenue} % / ${cfg.growthMinEps} % (Projektannahme)`,
  };
}
export { addDays };
