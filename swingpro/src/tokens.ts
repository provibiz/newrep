/** Aktions-Links: zufälliges Token, nur der Hash (mit Pepper) liegt in der Datenbank. */
import { run, one } from "./store";
import type { Db } from "./store";

async function sha(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function randomToken(bytes = 24): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function createToken(db: Db, pepper: string, refId: string, purpose: string, ttlMs: number, now: number): Promise<string> {
  const raw = randomToken();
  await run(db, "INSERT INTO tokens (hash, ref_id, purpose, expires_at, created_at) VALUES (?,?,?,?,?)", await sha(pepper + raw), refId, purpose, now + ttlMs, now);
  return raw;
}
export async function lookupToken(db: Db, pepper: string, raw: string, now: number) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(raw)) return null;
  const r = await one<{ ref_id: string; purpose: string; expires_at: number }>(db, "SELECT ref_id, purpose, expires_at FROM tokens WHERE hash=?", await sha(pepper + raw));
  return r && r.expires_at > now ? r : null;
}
