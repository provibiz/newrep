/** Mailtexte (Deutsch). Die ersten Zeilen enthalten bei Einstiegsmails: Signalzeit, Auslöser, Kurs+Zeit, Stopp, Stückzahl, Risiko. */
import type { Config } from "./config";
import { SETUP_LABEL, type Prepared, type SetupId } from "./types";
import { formatBerlin, formatBerlinTime, berlinMinusNyHours, formatNy } from "./time";
import type { SizeResult } from "./sizing";
import { money } from "./sizing";
import type { SpContext, QqqDecision } from "./market";
import type { GrowthResult } from "./growth";
import type { EntryCheck } from "./entry";

export interface Mail { subject: string; text: string }
const px = (x: number) => x.toFixed(2);
const names = (s: SetupId[]) => s.map((x) => SETUP_LABEL[x]).join(" + ");

export const feedText = (cfg: Config) =>
  cfg.feed === "iex" ? "Feed IEX (Echtzeit, nur ein Handelsplatz; Volumen unterschätzt das Gesamtvolumen)" : "Feed SIP (konsolidiert)";

function tzNote(ms: number): string {
  const d = berlinMinusNyHours(ms);
  return d === 6 ? "" : ` · Achtung: diese Woche liegt Berlin nur ${d} h vor New York`;
}
const modeLine = (cfg: Config) => (cfg.mode === "paper" ? "PAPER-MODUS: nur Protokoll, keine Handelsempfehlung\n" : "");

export interface PrewarnItem { symbol: string; prepared: Prepared[]; rsPct?: number; expiresAt: number }

export function prewarnMail(cfg: Config, items: PrewarnItem[], now: number): Mail {
  const first = items[0];
  const subj = items.length === 1
    ? `Vorwarnung · ${first.symbol} · ${names(first.prepared.map((p) => p.setup))}`
    : `Vorwarnung · ${items.length} Setups · ${items.slice(0, 3).map((i) => i.symbol).join(", ")}${items.length > 3 ? " …" : ""}`;
  const lines = [modeLine(cfg) + `Vorbereitete Setups (noch KEIN Einstieg) · Stand ${formatBerlin(now)}${tzNote(now)}`, `${feedText(cfg)}`, ""];
  for (const it of items) {
    for (const p of it.prepared) {
      lines.push(`${it.symbol} · ${SETUP_LABEL[p.setup]} (${p.timeframe === "1h" ? "Stundenchart" : "Tageschart"})`,
        p.needsHourClose ? `  Auslöser: Schluss der ersten Handelsstunde (10:30 New York) nicht unter der Eröffnung – ausdrücklich Stundenschluss, kein früheres Signal`
          : `  Auslösemarke: 5-Minuten-Schluss über ${px(p.trigger)}`,
        `  Geplanter Stopp: ${px(p.stop)} (Idee widerlegt bei Schluss/Tief unter ${px(p.invalidateBelow)})`,
        `  Verfall: ${formatBerlin(it.expiresAt)}` + (p.timeframe === "1h" ? "" : " oder Invalidierung"),
        `  Bereits erfüllt: ${p.conditions.join("; ")}`,
        `  Noch offen: ${p.pending.join("; ")}`, "");
    }
  }
  lines.push("Du erhältst eine Einstiegsmail nur, wenn der Auslöser bestätigt und der Kurs frisch geprüft ist. Vorwarnungen lassen sich mit MAIL_PREWARN=false abschalten.");
  return { subject: subj, text: lines.join("\n") };
}

export interface EntryParts {
  symbol: string; setups: SetupId[]; signalTime: number; trigger: number; stop: number;
  check: EntryCheck; size: SizeResult; reasons: string[]; sp: SpContext; qqq: QqqDecision; growth: GrowthResult;
  prepared: Prepared[]; link: string | null; feedUsed: string;
}

export function entryMail(cfg: Config, e: EntryParts): Mail {
  const c = e.check;
  const lines = [
    modeLine(cfg) + `Signal: ${formatBerlin(e.signalTime)} (${formatNy(e.signalTime)})${tzNote(e.signalTime)}`,
    `Auslöser: ${px(e.trigger)} · Kurs ${px(c.observed!)} USD, Zeitstempel ${formatBerlin(c.quoteTime!)}, geprüft ${formatBerlinTime(c.checkedAt)} (Alter ${Math.round(c.quoteAgeSec!)} s)`,
    `Stopp: ${px(e.stop)} USD · Abstand ${px(c.observed! - e.stop)} USD je Aktie (1R)`,
    `Stückzahl: ${e.size.shares} (Einsatz ${money(cfg, e.size.costUsd)}) · geplantes Risiko ${money(cfg, e.size.plannedRiskUsd)} = ${(e.size.plannedRiskUsd / e.size.capitalUsd * 100).toFixed(2)} % des Depots`,
    `Daten: ${e.feedUsed} · Limit-Orders bleiben bei dir; Kurs vor Order erneut prüfen.`, "",
    `Warum interessant: ${names(e.setups)}`,
  ];
  for (const p of e.prepared) {
    lines.push(`• ${SETUP_LABEL[p.setup]} – erfüllt: ${p.conditions.join("; ")}`);
  }
  lines.push("• Bestätigung heute: " + e.reasons.join(" | "), "",
    `Ist der Einstieg noch sinnvoll? Der Kurs liegt ${c.chaseR!.toFixed(2)} R über dem Auslöser (Grenze ${cfg.maxChaseR} R). Widerlegt ist die Idee unter ${px(e.stop)}.`, "",
    `Marktkontext`, e.sp.text, e.qqq.text, e.growth.text, "",
    `Größenberechnung: ${e.size.limitedBy === "ok" ? "" : `begrenzt durch ${e.size.limitedBy}; `}Risikobudget ${money(cfg, e.size.riskBudgetUsd)}, verfügbar ${money(cfg, e.size.availableUsd)}, offenes Risiko vorher ${money(cfg, e.size.openRiskUsd)}.`,
    cfg.accountCurrency === "EUR" ? `Wechselkurs: 1 EUR = ${cfg.fxUsdPerEur} USD (${cfg.fxSource}, ${cfg.fxDate}) – Orders laufen in USD.` : "Depot- und Handelswährung: USD.", "");
  if (e.link) lines.push(`Gekauft? Kaufkurs und Stückzahl bestätigen (Link öffnet nur ein Formular, nichts wird gespeichert):`, e.link, `Nicht gekauft? Dort „ausgelassen“ wählen.`);
  return { subject: `Einstieg bestätigt · ${e.symbol} · ${names(e.setups)}`, text: lines.join("\n") };
}

export function missedMail(cfg: Config, symbol: string, setups: SetupId[], trigger: number, stop: number, c: EntryCheck, signalTime: number): Mail {
  return {
    subject: `Einstieg verpasst · ${symbol} · ${names(setups)}`,
    text: [modeLine(cfg) + `Signal: ${formatBerlin(signalTime)}`,
      `Auslöser: ${px(trigger)} · Kurs ${c.observed ? px(c.observed) : "–"} (${c.quoteTime ? formatBerlin(c.quoteTime) : "ohne Zeit"})`, `Stopp (geplant): ${px(stop)}`,
      `Status: ${c.reason}`, "", "Es wird kein Kauf empfohlen. Für dieses Setup kommt keine weitere Meldung; ein neuer, eigenständiger Ausbruch löst wieder aus."].join("\n"),
  };
}

export function positionMail(cfg: Config, kind: string, symbol: string, body: string[], now: number): Mail {
  return { subject: `${kind} · ${symbol}`, text: [modeLine(cfg) + `Stand ${formatBerlin(now)}`, ...body].join("\n") };
}

export function linkify(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;font-size:15px;line-height:1.45">${esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</pre>`;
}
