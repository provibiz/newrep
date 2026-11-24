/** Dünne Datenzugriffsschicht über D1 (in Tests: node:sqlite-Adapter). */
export interface Stmt { bind(...a: unknown[]): Stmt; run(): Promise<{ meta?: { changes?: number } }>; first<T = any>(): Promise<T | null>; all<T = any>(): Promise<{ results: T[] }> }
export interface Db { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown[]> }

export const run = async (db: Db, sql: string, ...a: unknown[]) => (await db.prepare(sql).bind(...a).run());
export const one = <T = any>(db: Db, sql: string, ...a: unknown[]) => db.prepare(sql).bind(...a).first<T>();
export const all = async <T = any>(db: Db, sql: string, ...a: unknown[]) => (await db.prepare(sql).bind(...a).all<T>()).results;

/** INSERT OR IGNORE; true, wenn die Zeile neu war. */
export async function insertIgnore(db: Db, table: string, row: Record<string, unknown>): Promise<boolean> {
  const cols = Object.keys(row);
  const r = await run(db, `INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...cols.map((c) => row[c] ?? null));
  return (r.meta?.changes ?? 0) > 0;
}
export async function upsert(db: Db, table: string, key: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const keys = key.split(",");
  const upd = cols.filter((c) => !keys.includes(c)).map((c) => `${c}=excluded.${c}`).join(",");
  await run(db, `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")}) ON CONFLICT(${key}) DO UPDATE SET ${upd}`, ...cols.map((c) => row[c] ?? null));
}

export async function getMeta<T = any>(db: Db, key: string): Promise<T | null> {
  const r = await one<{ value: string }>(db, "SELECT value FROM meta WHERE key=?", key);
  return r ? (JSON.parse(r.value) as T) : null;
}
export async function setMeta(db: Db, key: string, value: unknown, now: number) {
  await upsert(db, "meta", "key", { key, value: JSON.stringify(value), updated_at: now });
}
export async function logError(db: Db, scope: string, err: unknown, now: number) {
  const msg = scrub(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  await run(db, "INSERT INTO errors (ts,scope,message) VALUES (?,?,?)", now, scope, msg.slice(0, 500));
}
/** Entfernt Schlüssel-artige Teile aus Fehlertexten (URLs mit apikey=…, Header-Werte). */
export function scrub(s: string): string {
  return s.replace(/(apikey|api_key|token|secret|key)=([^&\s"']+)/gi, "$1=***").replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***");
}

export async function batchRun(db: Db, stmts: { sql: string; args: unknown[] }[], size = 80) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size).map((s) => db.prepare(s.sql).bind(...s.args)));
  }
}
