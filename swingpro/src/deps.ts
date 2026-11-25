import type { Config } from "./config";
import type { Db } from "./store";
import type { Alpaca, Fmp, MailMsg, Feed } from "./providers";

/** Alles, was Jobs von außen brauchen – in Tests und im Replay durch Fixtures ersetzbar. */
export interface Deps {
  db: Db;
  cfg: Config;
  now: () => number;
  alpaca: Pick<Alpaca, "assets" | "clock" | "bars" | "snapshots">;
  fmp: Pick<Fmp, "income" | "earningsCalendar" | "earningsFor"> | null;
  fred: (from: string, to: string) => Promise<string>;
  sendMail: (m: MailMsg) => Promise<{ id: string }>;
  pepper: string;
  /** false im Replay: Kalenderabgleich über /v2/clock überspringen */
  checkClock: boolean;
  log: (msg: string) => void;
}
export type { Feed };
