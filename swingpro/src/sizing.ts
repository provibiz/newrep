/** Positionsgröße unter Berücksichtigung offener Positionen, verfügbarem Kapital und Gesamtrisiko. Alles in USD (Handelswährung). */
import { toUsd, fromUsd, type Config } from "./config";

export interface OpenPosition { symbol: string; sharesRemaining: number; entry: number; stop: number }

export interface SizeResult {
  shares: number;
  limitedBy: "risiko" | "gewicht" | "kapital" | "gesamtrisiko" | "positionen" | "stopp" | "ok";
  entry: number; stop: number;
  riskPerShare: number;
  plannedRiskUsd: number;
  costUsd: number;
  riskBudgetUsd: number;
  capitalUsd: number;
  availableUsd: number;
  openRiskUsd: number;
  note: string;
}

export function openRiskUsd(open: OpenPosition[]): number {
  return open.reduce((s, p) => s + Math.max(0, p.entry - p.stop) * p.sharesRemaining, 0);
}

export function sizePosition(cfg: Config, entry: number, stop: number, open: OpenPosition[]): SizeResult {
  const capitalUsd = toUsd(cfg, cfg.capital);
  const risk = entry - stop;
  const riskBudgetUsd = capitalUsd * cfg.riskPercent / 100;
  const invested = open.reduce((s, p) => s + p.entry * p.sharesRemaining, 0);
  const availableUsd = Math.max(0, capitalUsd - invested);
  const oRisk = openRiskUsd(open);
  const base: SizeResult = { shares: 0, limitedBy: "ok", entry, stop, riskPerShare: risk, plannedRiskUsd: 0, costUsd: 0, riskBudgetUsd, capitalUsd, availableUsd, openRiskUsd: oRisk, note: "" };
  if (!(entry > 0) || !(risk > 0)) return { ...base, limitedBy: "stopp", note: "Stopp liegt nicht unter dem Kurs" };
  if (open.length >= cfg.maxPositions) return { ...base, limitedBy: "positionen", note: `Bereits ${open.length} offene Positionen (Grenze ${cfg.maxPositions})` };
  const caps: [SizeResult["limitedBy"], number][] = [
    ["risiko", Math.floor(riskBudgetUsd / risk)],
    ["gewicht", Math.floor((capitalUsd * cfg.maxWeightPercent / 100) / entry)],
    ["kapital", Math.floor(availableUsd / entry)],
    ["gesamtrisiko", Math.floor(Math.max(0, capitalUsd * cfg.maxOpenRiskPercent / 100 - oRisk) / risk)],
  ];
  const [by, shares] = caps.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (shares < 1) return { ...base, limitedBy: by, note: `Keine ganze Aktie möglich (begrenzt durch ${by})` };
  return { ...base, shares, limitedBy: by, plannedRiskUsd: shares * risk, costUsd: shares * entry, note: "" };
}

export function money(cfg: Config, usd: number): string {
  const u = `${usd.toFixed(2)} USD`;
  return cfg.accountCurrency === "USD" ? u : `${u} (≈ ${fromUsd(cfg, usd).toFixed(2)} EUR)`;
}
