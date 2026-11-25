import type { Config } from "./config";
import type { Alpaca, AssetRaw, RawBar } from "./providers";
import { bestQuote, dailyBars, toBars, ms } from "./providers";
import { venueOfAlpaca } from "./instruments";
import type { MarketData, AssetInfo } from "./marketdata";
import { MIN } from "./time";

type AlpacaLike = Pick<Alpaca, "assets" | "bars" | "snapshots">;

/** USA über Alpaca: Tageskerzen (DAILY_FEED, Standard SIP historisch), 5-Minuten-Kerzen und Quotes im konfigurierten Feed. */
export function alpacaUsData(a: AlpacaLike, cfg: Pick<Config, "feed" | "dailyFeed" | "maxQuoteAgeSec">): MarketData {
  return {
    id: "alpaca-us",
    feedLabel: cfg.feed === "iex" ? "Alpaca IEX (Echtzeit, ein Handelsplatz)" : "Alpaca SIP (konsolidiert)",
    async assets() {
      return ((await a.assets()) as AssetRaw[]).map((r): AssetInfo => ({ key: r.symbol, symbol: r.symbol, name: r.name, mic: venueOfAlpaca(r.exchange), currency: "USD", type: r.class, attributes: r.attributes, providerId: r.id, raw: r }));
    },
    async dailyBars(keys, startDate, endMs) {
      const res = await a.bars(keys, "1Day", startDate, new Date(endMs).toISOString(), cfg.dailyFeed, 8);
      const bars = new Map<string, ReturnType<typeof dailyBars>>();
      for (const [s, raw] of res.bars) bars.set(s, dailyBars(raw as RawBar[]));
      return { bars, requests: res.pages };
    },
    async bars5(keys, startMs, endMs) {
      const res = await a.bars(keys, "5Min", new Date(startMs).toISOString(), new Date(endMs).toISOString(), cfg.feed);
      return new Map([...res.bars].map(([k, v]) => [k, toBars(v as RawBar[], 5 * MIN)]));
    },
    async quotes(keys, now) {
      const snaps = await a.snapshots(keys, cfg.feed);
      return new Map(keys.map((k) => { const sn = snaps.get(k); return [k, { quote: bestQuote(sn, now, cfg.maxQuoteAgeSec * 1000), sessionOpen: sn?.dailyBar?.o ?? null }]; }));
    },
  };
}
export { ms };
