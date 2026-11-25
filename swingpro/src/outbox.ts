/**
 * Postausgang mit Verfallszeit (keine verspäteten Einstiegsmails) und getrennten Zeitstempeln.
 * Gmail hat keinen Idempotenzschlüssel: Doppelversand wird hier verhindert.
 *  - Jede Mail wird atomar beansprucht (queued/failed → sending), ein zweiter gleichzeitiger Lauf sendet sie nicht noch einmal.
 *  - Bei unklarem Ausgang (Netzwerkabbruch, hängender Versand) → Status `unknown`, KEINE automatische Wiederholung.
 *  - Bei widerrufener Freigabe → Status bleibt `queued`, Statusseite zeigt „Neu autorisieren“; abgelaufene Einstiegsmails werden verworfen.
 */
import { insertIgnore, run, all, scrub, setMeta, getMeta } from "./store";
import { linkify } from "./mail";
import { HttpError } from "./providers";
import { GmailAuthError, GmailNotConfigured, GmailUnknownOutcome } from "./gmail";
import type { Deps } from "./deps";

export type OutboxKind = "prewarn" | "entry" | "watch" | "missed" | "position" | "daily" | "test" | "alert";

export async function enqueue(d: Deps, m: { id: string; kind: OutboxKind; subject: string; text: string; sendBy?: number | null; signalId?: string | null }): Promise<boolean> {
  return insertIgnore(d.db, "outbox", {
    id: m.id, kind: m.kind, subject: m.subject, text_body: m.text, html_body: linkify(m.text), state: "queued",
    attempts: 0, created_at: d.now(), send_by: m.sendBy ?? null, signal_id: m.signalId ?? null,
  });
}

export interface GmailHealth { authProblem: { reason: string; at: number; message: string } | null; notConfigured: boolean; lastAcceptedAt: number | null; lastMessageId: string | null }
export const gmailHealth = async (d: Deps) => (await getMeta<GmailHealth>(d.db, "gmail_health")) ?? { authProblem: null, notConfigured: false, lastAcceptedAt: null, lastMessageId: null };
async function setHealth(d: Deps, patch: Partial<GmailHealth>) { await setMeta(d.db, "gmail_health", { ...(await gmailHealth(d)), ...patch }, d.now()); }

/** Versendet fällige Mails. Paper-Modus protokolliert nur (state dry_run). */
export async function flushOutbox(d: Deps): Promise<{ sent: number; failed: number; dropped: number; dryRun: number; blocked: number }> {
  const out = { sent: 0, failed: 0, dropped: 0, dryRun: 0, blocked: 0 };
  // hängender Versand (Absturz mitten in der Anfrage): Ausgang unklar, nicht erneut senden
  await run(d.db, "UPDATE outbox SET state='unknown', error='Versand wurde nicht abgeschlossen – Ausgang unklar, keine automatische Wiederholung' WHERE state='sending' AND sending_at < ?", d.now() - 5 * 60_000);
  const rows = await all<any>(d.db, "SELECT * FROM outbox WHERE state IN ('queued','failed') AND attempts < 6 ORDER BY created_at LIMIT 25");
  let authStop = false;
  for (const r of rows) {
    const now = d.now();
    if (r.send_by && now > r.send_by && r.kind !== "test") {
      await run(d.db, "UPDATE outbox SET state='dropped_late', error=? WHERE id=?", "Sendefenster überschritten – verspätete Meldung verworfen", r.id);
      out.dropped++; continue;
    }
    if (d.cfg.mode === "paper" && r.kind !== "test") {
      await run(d.db, "UPDATE outbox SET state='dry_run' WHERE id=?", r.id);
      out.dryRun++; continue;
    }
    if (authStop) { out.blocked++; continue; }
    if (!d.cfg.mailFrom || !d.cfg.mailTo) {
      await run(d.db, "UPDATE outbox SET state='failed', attempts=attempts+1, error=? WHERE id=?", "MAIL_FROM/MAIL_TO nicht konfiguriert", r.id);
      out.failed++; continue;
    }
    // atomar beanspruchen: nur ein Lauf darf diese Mail senden
    const claim = await run(d.db, "UPDATE outbox SET state='sending', sending_at=?, attempts=attempts+1 WHERE id=? AND state IN ('queued','failed')", now, r.id);
    if ((claim.meta?.changes ?? 0) < 1) continue;
    try {
      const res = await d.sendMail({ id: r.id, from: d.cfg.mailFrom, to: d.cfg.mailTo, subject: r.subject, text: r.text_body, html: r.html_body });
      // accepted_at = Annahme durch Gmail (Nachrichten-ID). Der Eingang im Postfach wird NICHT gemessen.
      await run(d.db, "UPDATE outbox SET state='sent', provider_id=?, accepted_at=?, error=NULL WHERE id=?", res.id, d.now(), r.id);
      await setHealth(d, { authProblem: null, notConfigured: false, lastAcceptedAt: d.now(), lastMessageId: res.id });
      out.sent++;
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e)).slice(0, 300);
      if (e instanceof GmailAuthError || e instanceof GmailNotConfigured) {
        // zurück in die Warteschlange (kein Versuch verbraucht); alles Weitere in diesem Lauf wäre vergeblich
        await run(d.db, "UPDATE outbox SET state='queued', attempts=attempts-1, error=? WHERE id=?", msg, r.id);
        await setHealth(d, e instanceof GmailAuthError ? { authProblem: { reason: e.reason, at: d.now(), message: msg } } : { notConfigured: true });
        authStop = true; out.blocked++; continue;
      }
      if (e instanceof GmailUnknownOutcome || !(e instanceof HttpError)) {
        await run(d.db, "UPDATE outbox SET state='unknown', error=? WHERE id=?", msg, r.id);
        out.failed++; continue;
      }
      const permanent = e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 401;
      await run(d.db, "UPDATE outbox SET state=?, error=? WHERE id=?", permanent ? "rejected" : "failed", msg, r.id);
      out.failed++;
    }
  }
  return out;
}
