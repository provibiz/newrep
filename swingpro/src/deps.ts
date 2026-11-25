import type { Config } from "./config";
import type { Db } from "./store";
import type { Alpaca, Fmp, MailMsg, Feed, Fetch } from "./providers";
import type { Market, MarketId } from "./markets";

/** Alles, was Jobs von außen brauchen – in Tests und im Replay durch Fixtures ersetzbar. */
export interface Deps {
  db: Db;
  cfg: Config;
  now: () => number;
  alpaca: Pick<Alpaca, "assets" | "clock" | "bars" | "snapshots">;
  fmp: Pick<Fmp, "income" | "earningsCalendar" | "earningsFor"> | null;
  fred: (from: string, to: string) => Promise<string>;
  sendMail: (m: MailMsg) => Promise<{ id: string }>;
  /** Märkte mit Kalender und Datenanbieter (USA, Xetra) */
  markets: Record<MarketId, Market>;
  fetch: Fetch;
  pepper: string;
  /** false im Replay: Kalenderabgleich über /v2/clock überspringen */
  checkClock: boolean;
  log: (msg: string) => void;
}
export type { Feed };
