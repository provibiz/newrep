import { loadConfig, type Env } from "./config";
import type { Deps } from "./deps";
import { Alpaca, Fmp, fetchFredSp500 } from "./providers";
import { GmailSender, GmailNotConfigured } from "./gmail";
import { handleRequest } from "./web";
import { runHourly } from "./jobs/hourly";
import { runIntradayAll } from "./jobs/intraday";
import { runDailyAll } from "./jobs/daily";
import { buildMarkets } from "./buildMarkets";
import { logError } from "./store";

function deps(env: Env): Deps {
  const cfg = loadConfig(env as unknown as Record<string, unknown>);
  const f = (u: string, i?: RequestInit) => fetch(u, i);
  const alpaca = new Alpaca(f, env.ALPACA_KEY_ID, env.ALPACA_SECRET);
  return {
    db: env.DB as any, cfg, now: () => Date.now(),
    alpaca,
    fmp: env.FMP_API_KEY ? new Fmp(f, env.FMP_API_KEY) : null,
    fred: (from, to) => fetchFredSp500(f, from, to),
    sendMail: (m) => {
      if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) throw new GmailNotConfigured();
      return new GmailSender(f, { clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN }).send(m);
    },
    markets: buildMarkets(cfg, alpaca, f, env), fetch: f,
    pepper: env.TOKEN_PEPPER, checkClock: true, log: (m) => console.log(m),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await handleRequest(req, deps(env), env as any); }
    catch (e) { console.error("fetch", e instanceof Error ? e.message : "Fehler"); return new Response("Interner Fehler", { status: 500 }); }
  },

  /**
   * Zwei Cron-Muster (UTC, siehe wrangler.jsonc): Minute 1,6,11,… von 13–21 Uhr (US-Handelszeit in Sommer- und Winterzeit)
   * führt Stundenscan und 5-Minuten-Überwachung aus; alle zehn Minuten von 21–23 Uhr läuft der fortsetzbare Tageslauf.
   * Jeder Lauf ist über scan_runs.run_key idempotent; Handelstage und -zeiten prüft der Code mit dem NYSE-Kalender.
   */
  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const d = deps(env);
    const tasks = ev.cron.includes("21-23") ? [runDailyAll] : [runHourly, runIntradayAll];
    for (const t of tasks) {
      try { console.log(await t(d)); } catch (e) { await logError(d.db, "cron", e, d.now()); }
    }
  },
};
