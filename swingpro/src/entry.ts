/** Einstiegsprüfung mit frischem Kurs: bestätigt, verpasst oder nicht prüfbar. */
import type { Config } from "./config";

export type EntryStatus = "confirmed" | "missed" | "stale_quote" | "no_quote" | "below_trigger" | "invalid_stop";

export interface EntryCheck {
  status: EntryStatus;
  observed: number | null;
  quoteTime: number | null;
  checkedAt: number;
  quoteAgeSec: number | null;
  chaseR: number | null;
  reason: string;
}

export interface Quote { price: number; time: number; kind: "ask" | "last" }

export function checkEntry(cfg: Config, trigger: number, stop: number, quote: Quote | null, checkedAt: number): EntryCheck {
  const base = { observed: quote?.price ?? null, quoteTime: quote?.time ?? null, checkedAt, quoteAgeSec: null as number | null, chaseR: null as number | null };
  if (!quote || !(quote.price > 0) || !Number.isFinite(quote.time)) return { ...base, status: "no_quote", reason: "Keine Kursbestätigung verfügbar – kein Einstieg ausgelöst" };
  const age = (checkedAt - quote.time) / 1000;
  base.quoteAgeSec = age;
  if (age > cfg.maxQuoteAgeSec || age < -30) {
    return { ...base, status: "stale_quote", reason: `Kurs ist ${Math.round(age)} s alt (erlaubt ${cfg.maxQuoteAgeSec} s) – keine frische Bestätigung` };
  }
  if (!(quote.price > stop)) return { ...base, status: "invalid_stop", reason: `Kurs ${quote.price.toFixed(2)} liegt nicht über dem Stopp ${stop.toFixed(2)}` };
  const stopPct = (quote.price - stop) / quote.price * 100;
  if (stopPct < cfg.minStopPct) return { ...base, status: "invalid_stop", reason: `Stopp nur ${stopPct.toFixed(2)} % entfernt (Minimum ${cfg.minStopPct} %)` };
  if (stopPct > cfg.maxStopPct) return { ...base, status: "invalid_stop", reason: `Stopp ${stopPct.toFixed(1)} % entfernt (Maximum ${cfg.maxStopPct} %)` };
  if (quote.price < trigger) return { ...base, status: "below_trigger", reason: `Kurs ${quote.price.toFixed(2)} fiel unter den Auslöser ${trigger.toFixed(2)} zurück` };
  const chaseR = (quote.price - trigger) / (trigger - stop);
  base.chaseR = chaseR;
  if (chaseR > cfg.maxChaseR) return { ...base, status: "missed", reason: `Kurs ist dem Auslöser ${chaseR.toFixed(2)} R davongelaufen (Grenze ${cfg.maxChaseR} R)` };
  return { ...base, status: "confirmed", reason: "" };
}
