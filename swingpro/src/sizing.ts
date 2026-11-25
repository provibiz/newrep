/**
 * Positionsgröße unter Berücksichtigung offener Positionen, verfügbarem Kapital und Gesamtrisiko.
 * Alle Beträge sind in der Handelswährung des Instruments (USD für US-, EUR für Xetra-Titel); Kapital und Positionen
 * anderer Währung werden mit dem dokumentierten Wechselkurs (FX_USD_PER_EUR) umgerechnet. Ohne Kurs wird nie umgerechnet.
 */
import { fxRate, type Config } from "./config";

export interface OpenPosition { symbol: string; sharesRemaining: number; entry: number; stop: number; currency?: string }

export interface SizeResult {
  shares: number;
  limitedBy: "risiko" | "gewicht" | "kapital" | "gesamtrisiko" | "positionen" | "stopp" | "ok";
  currency: string;
  entry: number; stop: number;
  riskPerShare: number;
  plannedRisk: number;
  cost: number;
  riskBudget: number;
  capital: number;
  available: number;
  openRisk: number;
  note: string;
}

const conv = (cfg: Config, amount: number, from: string, to: string) => amount * fxRate(cfg, from, to);

export function openRisk(cfg: Config, open: OpenPosition[], ccy: string): number {
  return open.reduce((s, p) => s + conv(cfg, Math.max(0, p.entry - p.stop) * p.sharesRemaining, p.currency ?? "USD", ccy), 0);
}

export function sizePosition(cfg: Config, entry: number, stop: number, open: OpenPosition[], opts?: { maxWeightPercent?: number; currency?: string }): SizeResult {
  const ccy = opts?.currency ?? "USD";
  const capital = conv(cfg, cfg.capital, cfg.accountCurrency, ccy);
  const risk = entry - stop;
  const riskBudget = capital * cfg.riskPercent / 100;
  const invested = open.reduce((s, p) => s + conv(cfg, p.entry * p.sharesRemaining, p.currency ?? "USD", ccy), 0);
  const available = Math.max(0, capital - invested);
  const oRisk = openRisk(cfg, open, ccy);
  const base: SizeResult = { shares: 0, limitedBy: "ok", currency: ccy, entry, stop, riskPerShare: risk, plannedRisk: 0, cost: 0, riskBudget, capital, available, openRisk: oRisk, note: "" };
  if (!(entry > 0) || !(risk > 0)) return { ...base, limitedBy: "stopp", note: "Stopp liegt nicht unter dem Kurs" };
  if (open.length >= cfg.maxPositions) return { ...base, limitedBy: "positionen", note: `Bereits ${open.length} offene Positionen (Grenze ${cfg.maxPositions})` };
  const caps: [SizeResult["limitedBy"], number][] = [
    ["risiko", Math.floor(riskBudget / risk)],
    ["gewicht", Math.floor((capital * Math.min(cfg.maxWeightPercent, opts?.maxWeightPercent ?? cfg.maxWeightPercent) / 100) / entry)],
    ["kapital", Math.floor(available / entry)],
    ["gesamtrisiko", Math.floor(Math.max(0, capital * cfg.maxOpenRiskPercent / 100 - oRisk) / risk)],
  ];
  const [by, shares] = caps.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (shares < 1) return { ...base, shares: 0, limitedBy: by, note: `Keine ganze Aktie möglich (begrenzt durch ${by})` };
  return { ...base, shares, limitedBy: by, plannedRisk: shares * risk, cost: shares * entry, note: "" };
}

/** Betrag in Handelswährung, bei abweichender Kontowährung mit Umrechnung in Klammern (Kurs steht in der Mail). */
export function money(cfg: Config, amount: number, ccy = "USD"): string {
  const base = `${amount.toFixed(2)} ${ccy}`;
  return ccy === cfg.accountCurrency ? base : `${base} (≈ ${conv(cfg, amount, ccy, cfg.accountCurrency).toFixed(2)} ${cfg.accountCurrency})`;
}
