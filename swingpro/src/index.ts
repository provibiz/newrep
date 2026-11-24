import { loadConfig, type Env } from "./config";
import type { Deps } from "./deps";
import { Alpaca, Fmp, fetchFredSp500, sendResend } from "./providers";
import { handleRequest } from "./web";
import { runHourly } from "./jobs/hourly";
import { runIntraday } from "./jobs/intraday";
import { runDaily } from "./jobs/daily";
import { logError } from "./store";

function deps(env: Env): Deps {
  const cfg = loadConfig(env as unknown as Record<string, unknown>);
  const f = (u: string, i?: RequestInit) => fetch(u, i);
  return {
    db: env.DB as any, cfg, now: () => Date.now(),
    alpaca: new Alpaca(f, env.ALPACA_KEY_ID, env.ALPACA_SECRET),
    fmp: env.FMP_API_KEY ? new Fmp(f, env.FMP_API_KEY) : null,
    fred: (from, to) => fetchFredSp500(f, from, to),
    sendMail: (m) => sendResend(f, env.RESEND_API_KEY ?? "", m),
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
    const tasks = ev.cron.includes("21-23") ? [runDaily] : [runHourly, runIntraday];
    for (const t of tasks) {
      try { console.log(await t(d)); } catch (e) { await logError(d.db, "cron", e, d.now()); }
    }
  },
};
