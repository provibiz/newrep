/**
 * Einmalige Einrichtung der Gmail-Freigabe (lokal auf deinem Rechner, nicht im Worker, nicht im Chat).
 *
 * Voraussetzung: In der Google Cloud Console ein Projekt mit aktivierter Gmail API und ein OAuth-Client vom Typ „Desktop-App“.
 * Die Client-Daten gibst du nur als Umgebungsvariablen in deinem Terminal an:
 *   export GMAIL_CLIENT_ID=...   export GMAIL_CLIENT_SECRET=...
 *   npx tsx scripts/gmail-auth.ts
 *
 * Ablauf: Authorization-Code-Flow mit PKCE über http://127.0.0.1:<Port>, Scope ausschließlich gmail.send, Offline-Zugriff.
 * Das erhaltene Refresh-Token wird NICHT ausgegeben, sondern direkt per Stdin an `wrangler secret put GMAIL_REFRESH_TOKEN` übergeben.
 * Optional --print-nothing-else: nur Statusmeldungen. Mit --no-wrangler wird nichts gespeichert (Trockenlauf bis zum Token-Tausch).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { buildAuthUrl, pkcePair, verifyGrant, TOKEN_URL, GMAIL_SEND_SCOPE } from "../src/gmail";

const id = process.env.GMAIL_CLIENT_ID, secret = process.env.GMAIL_CLIENT_SECRET;
if (!id || !secret) { console.error("Bitte GMAIL_CLIENT_ID und GMAIL_CLIENT_SECRET als Umgebungsvariablen setzen (Desktop-OAuth-Client)."); process.exit(1); }
const noWrangler = process.argv.includes("--no-wrangler");

const { verifier, challenge } = await pkcePair();
const state = randomBytes(16).toString("hex");
const server = http.createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
const redirect = `http://127.0.0.1:${port}/cb`;
console.log("\nÖffne diese Adresse im Browser und gib NUR den Scope „E-Mails in deinem Namen senden“ frei:\n\n" + buildAuthUrl(id, redirect, challenge, state) + "\n");

const code: string = await new Promise<string>((resolve, reject) => {
  server.on("request", (req, res) => {
    const u = new URL(req.url ?? "/", redirect);
    if (u.pathname !== "/cb") { res.writeHead(404).end(); return; }
    if (u.searchParams.get("state") !== state) { res.writeHead(400).end("state stimmt nicht"); reject(new Error("state stimmt nicht")); return; }
    const c = u.searchParams.get("code");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(c ? "Freigabe erhalten. Du kannst dieses Fenster schließen." : "Freigabe abgebrochen.");
    c ? resolve(c) : reject(new Error("Freigabe abgebrochen oder verweigert"));
  });
  setTimeout(() => reject(new Error("Zeitüberschreitung (5 Minuten)")), 300_000);
}).finally(() => server.close());

const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier }) });
const body: any = await res.json().catch(() => ({}));
if (!res.ok) { console.error("Token-Tausch fehlgeschlagen:", body?.error ?? res.status); process.exit(1); }
const { refreshToken } = verifyGrant(body);
console.log(`Freigabe geprüft: genau ${GMAIL_SEND_SCOPE}, Refresh-Token vorhanden (wird nicht angezeigt).`);
if (noWrangler) process.exit(0);
const p = spawn("npx", ["wrangler", "secret", "put", "GMAIL_REFRESH_TOKEN"], { stdio: ["pipe", "inherit", "inherit"] });
p.stdin.end(refreshToken + "\n");
p.on("exit", (c) => { console.log(c === 0 ? "Refresh-Token als Cloudflare Secret gespeichert." : "wrangler secret put ist fehlgeschlagen – nichts gespeichert."); process.exit(c ?? 1); });
