/**
 * Veröffentlichte Watchlist-Ideen (z. B. aus einem Newsletter) als EXTERNE Vorbereitung. Eine Idee ist kein ausgeführter Trade,
 * kein Bot-Signal und löst nie selbst etwas aus: Sie durchläuft dieselben drei Stufen (vorbereitet → Trigger → zulässig).
 * Instrumente ohne vollständige Datenabdeckung werden als „Markt nicht unterstützt“ geführt und nie getriggert.
 */
import type { Deps } from "./deps";
import { insertIgnore } from "./store";
import { checkSupport, type Instrument, type Support } from "./instruments";
import type { Prepared, SetupId } from "./types";
import { addSessions } from "./series";
import { nyDate } from "./time";
import { stopBelow } from "./patterns";

export interface IdeaInput {
  instrument: Instrument; setup: SetupId; trigger: number; stop: number; stopBasis: string; source: string; publishedAt: number;
  conditions?: string[]; contextLevels?: Prepared["contextLevels"];
}
export interface IdeaResult { id: string; state: "active" | "unsupported" | "duplicate"; support: Support }

export async function importIdea(d: Deps, i: IdeaInput): Promise<IdeaResult> {
  const support = checkSupport(i.instrument);
  const id = `${i.instrument.symbol}|${i.setup}|idea|${i.publishedAt}`;
  const p: Prepared = {
    setup: i.setup, timeframe: "1d", armedAt: i.publishedAt, trigger: i.trigger, stop: i.stop, invalidateBelow: i.stop + 0.01, ttlBars: 5,
    currency: i.instrument.currency, origin: "idea", source: i.source, stopBasis: i.stopBasis, contextLevels: i.contextLevels,
    conditions: i.conditions ?? [`Veröffentlichte Watchlist-Idee: ${i.source}`], pending: [`5-Minuten-Schluss über ${i.trigger.toFixed(2)} ${i.instrument.currency}`],
  };
  const isNew = await insertIgnore(d.db, "prepared", {
    id, symbol: i.instrument.symbol, setup: i.setup, timeframe: "1d", armed_at: i.publishedAt, expires_at: addSessions(nyDate(i.publishedAt), 5),
    trigger_price: i.trigger, stop_price: i.stop, state: support.supported ? "active" : "unsupported",
    state_reason: support.supported ? null : `${support.label}: ${support.summary}`, data: JSON.stringify(p), created_at: d.now(), origin: "idea", source: i.source,
  });
  return { id, state: !isNew ? "duplicate" : support.supported ? "active" : "unsupported", support };
}
export { stopBelow };
