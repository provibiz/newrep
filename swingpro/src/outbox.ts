/** Postausgang mit Idempotenzschlüsseln, Verfallszeit (keine verspäteten Einstiegsmails) und getrennten Zeitstempeln. */
import { insertIgnore, run, all, scrub } from "./store";
import { linkify } from "./mail";
import { HttpError } from "./providers";
import type { Deps } from "./deps";

export type OutboxKind = "prewarn" | "entry" | "missed" | "position" | "daily" | "test" | "alert";

export async function enqueue(d: Deps, m: { id: string; kind: OutboxKind; subject: string; text: string; sendBy?: number | null; signalId?: string | null }): Promise<boolean> {
  return insertIgnore(d.db, "outbox", {
    id: m.id, kind: m.kind, subject: m.subject, text_body: m.text, html_body: linkify(m.text), state: "queued",
    attempts: 0, created_at: d.now(), send_by: m.sendBy ?? null, signal_id: m.signalId ?? null,
  });
}

/** Versendet fällige Mails. Paper-Modus protokolliert nur (state dry_run). */
export async function flushOutbox(d: Deps): Promise<{ sent: number; failed: number; dropped: number; dryRun: number }> {
  const out = { sent: 0, failed: 0, dropped: 0, dryRun: 0 };
  const rows = await all<any>(d.db, "SELECT * FROM outbox WHERE state IN ('queued','failed') AND attempts < 6 ORDER BY created_at LIMIT 25");
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
    if (!d.cfg.mailFrom || !d.cfg.mailTo) {
      await run(d.db, "UPDATE outbox SET state='failed', attempts=attempts+1, error=? WHERE id=?", "MAIL_FROM/MAIL_TO nicht konfiguriert", r.id);
      out.failed++; continue;
    }
    try {
      const res = await d.sendMail({ id: r.id, from: d.cfg.mailFrom, to: d.cfg.mailTo, subject: r.subject, text: r.text_body, html: r.html_body });
      // accepted_at = Annahme durch den Anbieter. Die Zustellung im Postfach wird NICHT gemessen.
      await run(d.db, "UPDATE outbox SET state='sent', provider_id=?, accepted_at=?, attempts=attempts+1, error=NULL WHERE id=?", res.id, d.now(), r.id);
      out.sent++;
    } catch (e) {
      const permanent = e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 409;
      await run(d.db, "UPDATE outbox SET state=?, attempts=attempts+1, error=? WHERE id=?", permanent ? "rejected" : "failed", scrub(e instanceof Error ? e.message : String(e)).slice(0, 300), r.id);
      out.failed++;
    }
  }
  return out;
}
