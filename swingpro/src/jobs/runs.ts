/** Lauf-Protokoll mit Idempotenz: doppelte Cron-Aufrufe führen einen Lauf nicht zweimal aus. */
import { insertIgnore, one, run, getMeta, setMeta, logError } from "../store";
import type { Deps } from "../deps";

export type RunStart = { id: number } | null;

export async function startRun(d: Deps, kind: string, runKey: string, staleMs = 8 * 60_000): Promise<RunStart> {
  const now = d.now();
  const fresh = await insertIgnore(d.db, "scan_runs", { kind, run_key: runKey, started_at: now, status: "running" });
  const row = await one<{ id: number; status: string; started_at: number }>(d.db, "SELECT id,status,started_at FROM scan_runs WHERE run_key=?", runKey);
  if (!row) return null;
  if (fresh) return { id: row.id };
  if (row.status === "ok" || row.status === "skipped") return null;
  if (row.status === "running" && now - row.started_at < staleMs) return null; // läuft vermutlich noch
  await run(d.db, "UPDATE scan_runs SET status='running', started_at=?, error=NULL WHERE id=?", now, row.id);
  return { id: row.id };
}
export async function finishRun(d: Deps, id: number, status: "ok" | "failed" | "skipped" | "partial", stats: unknown, error?: string) {
  const now = d.now();
  await run(d.db, "UPDATE scan_runs SET status=?, finished_at=?, stats=?, error=? WHERE id=?", status, now, JSON.stringify(stats), error ?? null, id);
  if (status === "ok" || status === "partial") {
    const kind = (await one<{ kind: string }>(d.db, "SELECT kind FROM scan_runs WHERE id=?", id))!.kind;
    await setMeta(d.db, `last_ok:${kind}`, { at: now, stats }, now);
  }
}
export async function guarded<T>(d: Deps, scope: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { await logError(d.db, scope, e, d.now()); d.log(`${scope}: ${e instanceof Error ? e.message : e}`); return undefined; }
}
export { getMeta };
