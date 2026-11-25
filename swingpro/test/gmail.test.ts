import { describe, it, expect, beforeEach } from "vitest";
import { GmailSender, buildRaw, buildAuthUrl, verifyGrant, pkcePair, clearGmailTokenCache, GMAIL_SEND_SCOPE, GmailAuthError, GmailUnknownOutcome, TOKEN_URL, SEND_URL } from "../src/gmail";
import { HttpError } from "../src/providers";
import { createDb, cfgOf, makeDeps } from "./helpers";
import { enqueue, flushOutbox, gmailHealth } from "../src/outbox";
import { one, all } from "../src/store";

const creds = { clientId: "cid.apps.example", clientSecret: "csecret-xyz", refreshToken: "1//refresh-token-abcdef0123456789" };
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const decode = (raw: string) => atob(raw.replace(/-/g, "+").replace(/_/g, "/"));

function fakeFetch(script: (url: string, init: any) => Response | Promise<Response>) {
  const calls: { url: string; init: any }[] = [];
  const f = async (url: string, init?: any) => { calls.push({ url, init }); return script(url, init); };
  return { f: f as any, calls };
}
beforeEach(() => clearGmailTokenCache());

describe("Gmail-Versand (nur gmail.send)", () => {
  it("erneuert das Access-Token mit dem Refresh-Token und sendet base64url-RFC2822 an /messages/send – sonst kein Aufruf", async () => {
    const { f, calls } = fakeFetch((url) => (url === TOKEN_URL ? j({ access_token: "ya29.token", expires_in: 3599, scope: GMAIL_SEND_SCOPE }) : j({ id: "18c0ffee", threadId: "t1" })));
    const g = new GmailSender(f, creds);
    const r = await g.send({ id: "mail|sig|X", from: "SwingPro <me@gmail.com>", to: "me@gmail.com", subject: "Einstieg bestätigt · SAP · Base Breakout", text: "Zeile 1\nÜmläut €", html: "<pre>Zeile 1</pre>" });
    expect(r.id).toBe("18c0ffee");
    expect(calls.map((c) => c.url)).toEqual([TOKEN_URL, SEND_URL]);                      // weder Lesen noch Suchen noch Listen
    expect(String(calls[0].init.body)).toMatch(/grant_type=refresh_token/);
    expect(calls[1].init.headers.Authorization).toBe("Bearer ya29.token");
    const mime = decode(JSON.parse(calls[1].init.body).raw);
    expect(mime).toMatch(/^From: SwingPro <me@gmail.com>/m); expect(mime).toMatch(/^Subject: =\?UTF-8\?B\?/m); expect(mime).toMatch(/multipart\/alternative/);
    expect(mime).toMatch(/X-SwingPro-Id: mail\|sig\|X/);
    expect(mime).not.toMatch(/^Bcc:/m);
  });
  it("Betreff mit Umlauten wird RFC-2047-kodiert und ist zurückdekodierbar; Kopfzeilen-Injektion wird verhindert", () => {
    const raw = decode(buildRaw({ id: "a", from: "a@b.de", to: "c@d.de", subject: "Nur beobachten · Fresenius\r\nBcc: evil@x.de", text: "x" }));
    expect(raw).not.toMatch(/^Bcc:/m);
    const subj = raw.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=/m)![1];
    expect(new TextDecoder().decode(Uint8Array.from(atob(subj), (c) => c.charCodeAt(0)))).toBe("Nur beobachten · Fresenius Bcc: evil@x.de");
  });
  it("Access-Token wird innerhalb der Gültigkeit wiederverwendet (ein Token-Abruf für mehrere Mails)", async () => {
    const { f, calls } = fakeFetch((url) => (url === TOKEN_URL ? j({ access_token: "t", expires_in: 3599 }) : j({ id: "m" })));
    const g = new GmailSender(f, creds);
    for (let i = 0; i < 3; i++) await g.send({ id: "i" + i, from: "a@b.de", to: "c@d.de", subject: "s", text: "t" });
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });
  it("widerrufene Freigabe (invalid_grant) → GmailAuthError, klartextfreie Meldung ohne Secrets", async () => {
    const { f } = fakeFetch(() => j({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400));
    const err = await new GmailSender(f, creds).send({ id: "x", from: "a@b.de", to: "c@d.de", subject: "s", text: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(GmailAuthError); expect(err.reason).toBe("revoked");
    expect(String(err.message)).not.toContain(creds.refreshToken); expect(String(err.message)).not.toContain(creds.clientSecret);
  });
  it("Token mit mehr Rechten als gmail.send wird abgelehnt", async () => {
    const { f } = fakeFetch(() => j({ access_token: "t", expires_in: 3600, scope: `${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/gmail.readonly` }));
    const err = await new GmailSender(f, creds).send({ id: "x", from: "a@b.de", to: "c@d.de", subject: "s", text: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(GmailAuthError); expect(err.reason).toBe("scope");
  });
  it("Netzwerkabbruch beim Senden → unklarer Ausgang; 429/5xx → HttpError", async () => {
    let n = 0;
    const { f } = fakeFetch((url) => { if (url === TOKEN_URL) return j({ access_token: "t", expires_in: 3600 }); n++; if (n === 1) throw new TypeError("network"); return j({ error: "rate" }, 429); });
    const g = new GmailSender(f, creds); const m = { id: "x", from: "a@b.de", to: "c@d.de", subject: "s", text: "t" };
    expect(await g.send(m).catch((e) => e)).toBeInstanceOf(GmailUnknownOutcome);
    const e2 = await g.send(m).catch((e) => e); expect(e2).toBeInstanceOf(HttpError); expect(e2.status).toBe(429);
  });
  it("Einrichtung: Autorisierungs-URL fordert genau gmail.send, Offline-Zugriff und PKCE; Freigabe mit anderem Scope wird abgelehnt", async () => {
    const { challenge } = await pkcePair();
    const u = new URL(buildAuthUrl("cid", "http://127.0.0.1:8765/cb", challenge, "st"));
    expect(u.searchParams.get("scope")).toBe(GMAIL_SEND_SCOPE); expect(u.searchParams.get("access_type")).toBe("offline"); expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(verifyGrant({ refresh_token: "r", scope: GMAIL_SEND_SCOPE }).refreshToken).toBe("r");
    expect(() => verifyGrant({ refresh_token: "r", scope: `${GMAIL_SEND_SCOPE} https://mail.google.com/` })).toThrow(/ausschließlich gmail.send/);
    expect(() => verifyGrant({ scope: GMAIL_SEND_SCOPE })).toThrow(/Refresh-Token/);
  });
});

describe("Postausgang mit Gmail", () => {
  it("widerrufene Freigabe: Mails bleiben in der Warteschlange, Status zeigt das Problem; nach Neu-Autorisierung wird gesendet; abgelaufene Einstiegsmails werden verworfen", async () => {
    const db = createDb(); const d = makeDeps(db, cfgOf(), 1_000_000);
    let revoked = true;
    d.sendMail = async (m: any) => { if (revoked) throw new GmailAuthError("revoked", "Gmail-Freigabe widerrufen"); return { id: "g1" }; };
    await enqueue(d, { id: "a", kind: "entry", subject: "Einstieg", text: "t", sendBy: 1_000_000 + 600_000 });
    await enqueue(d, { id: "b", kind: "daily", subject: "Tagesbericht", text: "t", sendBy: 1_000_000 + 86_400_000 });
    let r = await flushOutbox(d);
    expect(r.blocked).toBeGreaterThan(0);
    expect((await gmailHealth(d)).authProblem).toMatchObject({ reason: "revoked" });
    expect((await all<any>(db, "SELECT state, attempts FROM outbox ORDER BY id")).map((x) => x.state + ":" + x.attempts)).toEqual(["queued:0", "queued:0"]);
    revoked = false; d.clock.t += 700_000;                                                // Einstiegsmail ist inzwischen zu alt
    r = await flushOutbox(d);
    expect(r).toMatchObject({ sent: 1, dropped: 1 });
    expect((await one<any>(db, "SELECT state FROM outbox WHERE id='a'")).state).toBe("dropped_late");
    expect((await gmailHealth(d)).authProblem).toBeNull();
    expect((await gmailHealth(d)).lastMessageId).toBe("g1");
  });
  it("zwei gleichzeitige Läufe senden dieselbe Mail nur einmal (atomares Beanspruchen)", async () => {
    const db = createDb(); const d = makeDeps(db, cfgOf(), 1_000_000); let sends = 0;
    d.sendMail = async () => { sends++; await new Promise((r) => setTimeout(r, 5)); return { id: "g" }; };
    await enqueue(d, { id: "a", kind: "daily", subject: "s", text: "t" });
    await Promise.all([flushOutbox(d), flushOutbox(d)]);
    expect(sends).toBe(1);
  });
  it("fehlende Gmail-Secrets: Mail bleibt in der Warteschlange, Status „nicht eingerichtet“", async () => {
    const { GmailNotConfigured } = await import("../src/gmail");
    const db = createDb(); const d = makeDeps(db, cfgOf(), 1_000_000);
    d.sendMail = async () => { throw new GmailNotConfigured(); };
    await enqueue(d, { id: "a", kind: "daily", subject: "s", text: "t" }); await flushOutbox(d);
    expect((await gmailHealth(d)).notConfigured).toBe(true);
    expect((await one<any>(db, "SELECT state FROM outbox")).state).toBe("queued");
  });
});
