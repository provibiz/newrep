/**
 * Mailversand über die Gmail API – ausschließlich ausgehend.
 *  - Scope: nur https://www.googleapis.com/auth/gmail.send (kein Lesen, Suchen oder Indizieren des Postfachs).
 *  - OAuth mit Offline-Zugriff: ein Refresh-Token (Cloudflare Secret) erzeugt kurzlebige Access-Tokens.
 *  - Die API kennt KEINEN Idempotenzschlüssel. Doppelversand wird deshalb über den Postausgang verhindert
 *    (atomares Beanspruchen je Mail, bei unklarem Ausgang keine automatische Wiederholung; siehe outbox.ts).
 *  - „Von Gmail angenommen“ (Nachrichten-ID) belegt NICHT den Eingang im Postfach oder auf dem Handy.
 */
import type { Fetch } from "./providers";
import { HttpError } from "./providers";
import type { MailMsg } from "./providers";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export interface GmailCreds { clientId: string; clientSecret: string; refreshToken: string }

/** Freigabe widerrufen/abgelaufen (invalid_grant) oder Client/Scope falsch: Neu-Autorisierung nötig, Wiederholen hilft nicht. */
export class GmailAuthError extends Error {
  constructor(public reason: "revoked" | "client" | "scope", msg: string) { super(msg); this.name = "GmailAuthError"; }
}
/** Gmail-Secrets fehlen: die Mail bleibt im Postausgang, bis die Einrichtung abgeschlossen ist. */
export class GmailNotConfigured extends Error { constructor() { super("Gmail nicht eingerichtet (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN fehlen)"); this.name = "GmailNotConfigured"; } }
/** Der Ausgang der Anfrage ist unklar (Netzwerkabbruch nach dem Senden): Mail könnte angekommen sein. */
export class GmailUnknownOutcome extends Error { constructor(msg: string) { super(msg); this.name = "GmailUnknownOutcome"; } }

const b64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const wrap76 = (s: string) => s.match(/.{1,76}/g)?.join("\r\n") ?? "";
/** RFC 2047 für Kopfzeilen mit Umlauten/Sonderzeichen. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(utf8(s))}?=`);
const noCrlf = (s: string) => s.replace(/[\r\n]+/g, " ");

/** Baut die RFC-2822-Nachricht (text + optional html) und gibt sie base64url-kodiert zurück. */
export function buildRaw(m: MailMsg, domain = "swingpro.invalid"): string {
  const boundary = "sp_" + b64url(crypto.getRandomValues(new Uint8Array(12)));
  const head = [
    `From: ${noCrlf(m.from)}`, `To: ${noCrlf(m.to)}`, `Subject: ${encodeHeader(noCrlf(m.subject))}`,
    `Message-ID: <${m.id.replace(/[^A-Za-z0-9._-]/g, "_")}@${domain}>`, `X-SwingPro-Id: ${m.id.replace(/[^A-Za-z0-9._:|-]/g, "_")}`, "MIME-Version: 1.0",
  ];
  const part = (type: string, body: string) => [`Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap76(b64(utf8(body)))].join("\r\n");
  const msg = m.html
    ? [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, part("text/plain", m.text), `--${boundary}`, part("text/html", m.html), `--${boundary}--`, ""].join("\r\n")
    : [...head, part("text/plain", m.text), ""].join("\r\n");
  return b64url(utf8(msg));
}

interface Cached { token: string; expires: number }
const cache = new Map<string, Cached>();   // nur Speicher dieses Isolates, nie persistiert

export class GmailSender {
  constructor(private f: Fetch, private creds: GmailCreds, private now: () => number = Date.now) {}

  /** Access-Token aus dem Refresh-Token. Fehler invalid_grant → GmailAuthError('revoked'). */
  async accessToken(): Promise<string> {
    const key = this.creds.clientId + ":" + this.creds.refreshToken.slice(-12);
    const c = cache.get(key);
    if (c && c.expires - 60_000 > this.now()) return c.token;
    const res = await this.f(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.creds.clientId, client_secret: this.creds.clientSecret, refresh_token: this.creds.refreshToken, grant_type: "refresh_token" }),
    });
    let body: any = {};
    try { body = await res.json(); } catch { /* leer */ }
    if (!res.ok) {
      const err = String(body?.error ?? res.status);
      if (err === "invalid_grant") throw new GmailAuthError("revoked", "Gmail-Freigabe widerrufen oder abgelaufen (invalid_grant) – neu autorisieren");
      if (err === "invalid_client" || err === "unauthorized_client") throw new GmailAuthError("client", `Gmail-OAuth-Client ungültig (${err})`);
      throw new HttpError(res.status, "oauth2.googleapis.com", `Token-Abruf fehlgeschlagen (${err})`);
    }
    if (!body.access_token) throw new Error("Token-Antwort ohne access_token");
    if (body.scope && String(body.scope).split(" ").some((s: string) => s !== GMAIL_SEND_SCOPE)) throw new GmailAuthError("scope", "Die Freigabe enthält mehr als gmail.send – aus Sicherheitsgründen abgelehnt, neu mit minimalem Scope autorisieren");
    cache.set(key, { token: body.access_token, expires: this.now() + Math.min(Number(body.expires_in ?? 3600), 3600) * 1000 });
    return body.access_token;
  }

  /** Sendet eine Nachricht. Wirft HttpError (Gmail hat NICHT angenommen: 4xx/5xx), GmailAuthError oder GmailUnknownOutcome. */
  async send(m: MailMsg): Promise<{ id: string; threadId?: string }> {
    const token = await this.accessToken();
    let res: Response;
    try {
      res = await this.f(SEND_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: buildRaw(m) }) });
    } catch {
      throw new GmailUnknownOutcome("Netzwerkfehler beim Senden – ob Gmail die Mail angenommen hat, ist unklar (keine automatische Wiederholung, um Doppelmails zu vermeiden)");
    }
    if (res.status === 401) { cache.clear(); throw new HttpError(401, "gmail.googleapis.com", "Access-Token abgelehnt"); }
    if (res.status === 403) {
      const t = await res.text().catch(() => "");
      if (/insufficient|scope|PERMISSION_DENIED/i.test(t)) throw new GmailAuthError("scope", "Gmail verweigert den Versand (403, Scope/Berechtigung)");
      throw new HttpError(403, "gmail.googleapis.com", t);
    }
    if (!res.ok) throw new HttpError(res.status, "gmail.googleapis.com", await res.text().catch(() => ""), Number(res.headers.get("retry-after")) || undefined);
    const body: any = await res.json().catch(() => ({}));
    if (!body?.id) throw new GmailUnknownOutcome("Gmail-Antwort ohne Nachrichten-ID – Ausgang unklar");
    return { id: String(body.id), threadId: body.threadId };
  }
}
export const clearGmailTokenCache = () => cache.clear();

// ───────── Einrichtung (einmalig, lokal): reine Hilfsfunktionen, getestet ─────────
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(verifier))));
  return { verifier, challenge };
}
export function buildAuthUrl(clientId: string, redirectUri: string, challenge: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SEND_SCOPE, access_type: "offline", prompt: "consent",
    code_challenge: challenge, code_challenge_method: "S256", state });
  return `${AUTH_URL}?${q}`;
}
/** Prüft die Token-Antwort der Einrichtung: genau gmail.send und ein Refresh-Token. */
export function verifyGrant(body: any): { refreshToken: string } {
  if (!body?.refresh_token) throw new Error("Kein Refresh-Token erhalten (Zustimmung mit prompt=consent und access_type=offline wiederholen, ggf. frühere Freigabe unter myaccount.google.com/permissions entfernen)");
  const scopes = String(body.scope ?? "").split(" ").filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== GMAIL_SEND_SCOPE) throw new Error(`Freigabe hat unerwartete Berechtigungen (${scopes.join(", ") || "keine"}); erlaubt ist ausschließlich gmail.send`);
  return { refreshToken: String(body.refresh_token) };
}
