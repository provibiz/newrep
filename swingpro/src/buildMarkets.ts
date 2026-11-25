import type { Config } from "./config";
import type { Alpaca, Fetch } from "./providers";
import { usMarket, deMarket, type Market, type MarketId } from "./markets";
import { alpacaUsData } from "./usdata";
import { twelveDataXetra } from "./twelvedata";
import { missingData } from "./marketdata";

/** Märkte aus Konfiguration und Secrets. Fehlt der Xetra-Zugang, bleibt die Lücke mit genauem Tarifhinweis sichtbar (keine Buchung, kein US-Ersatz). */
export function buildMarkets(cfg: Config, alpaca: Alpaca, f: Fetch, env: { TWELVEDATA_API_KEY?: string }): Record<MarketId, Market> {
  const de = env.TWELVEDATA_API_KEY
    ? twelveDataXetra(f, env.TWELVEDATA_API_KEY, { maxQuoteAgeSec: cfg.maxQuoteAgeSec })
    : missingData({ what: "Xetra-Kursdaten (EUR, Tages- und 5-Minuten-Kerzen, Quotes)", provider: "Twelve Data (Standardanbieter dieser Version)", plan: "Tarif mit Xetra-Intraday in Echtzeit/geringer Verzögerung – laut Preisseite (25.11.2026) „Pro“ mit „Real-time EU market data“ (99 USD/Monat); „Grow“ (29 USD/Monat) nennt nur „EOD global equities“. Xetra-Intraday je Tarif vor dem Buchen testen.", detail: "TWELVEDATA_API_KEY (Cloudflare Secret) fehlt" });
  return { US: usMarket(alpacaUsData(alpaca, cfg)), DE: deMarket(de) };
}
