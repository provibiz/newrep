/** Positionsbegleitung: laufende Kurswache (5 min) und tägliche Prüfung (Wochentief-Trailing, Stagnation, Digest). */
import type { Deps } from "../deps";
import { all, run, insertIgnore, one } from "../store";
import { assessStop, partialTarget, remaining, rMultiple, rPerShare, stagnation, trailedStop, type Position } from "../positions";
import { positionMail } from "../mail";
import { enqueue } from "../outbox";
import { createToken } from "../tokens";
import { loadSeries } from "../series";
import type { Market } from "../markets";
import { MIN, nyDate, formatBerlin } from "../time";
import { money } from "../sizing";

export const toPosition = (r: any): Position => ({
  id: r.id, symbol: r.symbol, entry: r.entry, shares: r.shares, fees: r.fees, initialStop: r.initial_stop, stop: r.stop, openedAt: r.opened_at,
  sharesSold: r.shares_sold, partialRecommendedAt: r.partial_recommended_at, stagnationHintedAt: r.stagnation_hinted_at,
});

async function ev(d: Deps, posId: string, type: string, data: unknown, idem: string) {
  return insertIgnore(d.db, "position_events", { position_id: posId, ts: d.now(), type, data: JSON.stringify(data), idem_key: idem });
}
async function link(d: Deps, posId: string): Promise<string[]> {
  if (!d.cfg.baseUrl) return [];
  const t = await createToken(d.db, d.pepper, posId, "pos", 21 * 86_400_000, d.now());
  return ["", `Ausführung erfassen (Teilverkauf, Ausstieg): ${d.cfg.baseUrl}/a/${t}`];
}

export async function watchPositions(d: Deps, mk: Market, s: { open: number; close: number }) {
  const rows = await all<any>(d.db, "SELECT * FROM positions WHERE status='open' AND market=?", mk.id);
  if (!rows.length) return;
  const now = d.now(), day = mk.dateOf(now);
  const snaps = await mk.data.quotes([...new Set(rows.map((r) => r.symbol))], now);
  for (const r of rows) {
    const p = toPosition(r), qi = snaps.get(p.symbol);
    const q = qi?.quote;
    if (!q || now - q.time > d.cfg.maxQuoteAgeSec * 1000 || (q.currency ?? "USD") !== r.currency) continue; // ohne frischen Kurs in der Handelswährung keine Aussage
    const sessionOpen = qi?.sessionOpen ?? null;
    const st = assessStop(p, q.price, sessionOpen);
    if (st.hit && (await ev(d, p.id, "stop_alert", { price: q.price, stop: p.stop, gap: st.gap }, `stop_hit:${p.id}:${day}:${p.stop}`))) {
      if (d.cfg.mailPosition) {
        const m = positionMail(d.cfg, st.gap ? "Ausstieg · Kurslücke unter Stopp" : "Ausstieg · Stopp erreicht", p.symbol,
          [`Stopp ${p.stop.toFixed(2)} ${r.currency}, Kurs ${q.price.toFixed(2)} ${r.currency} (${formatBerlin(q.time)}).`, st.text, `Restposition: ${remaining(p)} Stück. Verkauf löst du selbst beim Broker aus.`, ...(await link(d, p.id))], now);
        await enqueue(d, { id: `pos-stop|${p.id}|${day}|${p.stop}`, kind: "position", subject: m.subject, text: m.text, sendBy: now + 30 * MIN });
      }
      continue;
    }
    const tgt = partialTarget(d.cfg, p);
    if (p.partialRecommendedAt === null && q.price >= tgt.price) {
      if (await ev(d, p.id, "partial_recommended", { price: q.price, target: tgt.price, shares: tgt.shares }, `partial_rec:${p.id}`)) {
        await run(d.db, "UPDATE positions SET partial_recommended_at=? WHERE id=? AND partial_recommended_at IS NULL", now, p.id);
        if (d.cfg.mailPosition) {
          const m = positionMail(d.cfg, `Teilgewinn +${d.cfg.partialAtR}R`, p.symbol, [
            `Kurs ${q.price.toFixed(2)} ${r.currency} hat ${d.cfg.partialAtR}R erreicht (Einstieg ${p.entry.toFixed(2)}, 1R = ${rPerShare(p).toFixed(2)} ${r.currency}, Marke ${tgt.price.toFixed(2)}).`,
            `Empfehlung: ca. ${Math.round(d.cfg.partialFraction * 100)} % = ${tgt.shares} Stück verkaufen (Teststrategie). Das ist eine GEMELDETE Empfehlung – erst deine Erfassung der tatsächlichen Ausführung zählt.`,
            q.price > tgt.price * 1.01 ? `Der Kurs liegt über der Marke; der erzielte Preis weicht ab.` : "",
            `Danach wird die Restposition per bestätigten höheren Wochentiefs nachgezogen (Stopp steigt nur).`, ...(await link(d, p.id))], now);
          await enqueue(d, { id: `pos-partial|${p.id}`, kind: "position", subject: m.subject, text: m.text, sendBy: now + 60 * MIN });
        }
      }
    }
  }
}

/** Tägliche Prüfung nach Börsenschluss: Stopp nachziehen (nur höher), Stagnation, Split-Hinweis, Digest. */
export async function reviewPositions(d: Deps, mk: Market): Promise<string[]> {
  const rows = await all<any>(d.db, "SELECT * FROM positions WHERE status='open' AND market=?", mk.id);
  const lines: string[] = [];
  const now = d.now(), last = mk.lastCompletedSession(now, 15);
  for (const r of rows) {
    const p = toPosition(r);
    const daily = await loadSeries(d.db, p.symbol, "1d");
    const lastClose = daily.length ? daily[daily.length - 1].c : null;
    let status = `${p.symbol}: ${remaining(p)} Stück, Einstieg ${p.entry.toFixed(2)}, Stopp ${p.stop.toFixed(2)}`;
    if (lastClose !== null) status += `, Schluss ${lastClose.toFixed(2)} (${rMultiple(p, lastClose).toFixed(2)} R)`;
    if (r.needs_review) status += ` · ACHTUNG: Datenanpassung/Split erkannt – Stückzahl, Kurs und Stopp beim Broker prüfen, automatisches Nachziehen pausiert`;
    else {
      const t = lastClose !== null ? trailedStop(d.cfg, p, daily, last) : null;
      if (t && lastClose !== null && t.stop < lastClose && (await ev(d, p.id, "stop_raised", t, `stop_raise:${p.id}:${t.stop}`))) {
        await run(d.db, "UPDATE positions SET stop=? WHERE id=? AND stop<?", t.stop, p.id, t.stop);
        status += ` · Stopp angehoben auf ${t.stop.toFixed(2)} (bestätigtes Wochentief ${t.low.toFixed(2)} der Woche ab ${t.from})`;
        if (d.cfg.mailPosition) {
          const m = positionMail(d.cfg, "Stopp nachziehen", p.symbol, [`Neuer Schutzstopp ${t.stop.toFixed(2)} ${r.currency} (vorher ${p.stop.toFixed(2)}). Grundlage: bestätigtes Wochentief ${t.low.toFixed(2)} der Woche ab ${t.from}, bestätigt nach zwei höheren abgeschlossenen Wochen. Der Stopp wird nie gesenkt.`, "Bitte die Stopp-Order beim Broker selbst anpassen.", ...(await link(d, p.id))], now);
          await enqueue(d, { id: `pos-trail|${p.id}|${t.stop}`, kind: "position", subject: m.subject, text: m.text, sendBy: now + 6 * 3_600_000 });
        }
      }
      if (lastClose !== null) {
        const hint = stagnation(d.cfg, p, lastClose, nyDate(now));
        if (hint && (await ev(d, p.id, "stagnation_hint", {}, `stagnation:${p.id}`))) {
          await run(d.db, "UPDATE positions SET stagnation_hinted_at=? WHERE id=?", now, p.id);
          status += " · " + hint;
        }
      }
    }
    lines.push(status);
  }
  void money; void one;
  return lines;
}
