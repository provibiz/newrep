/** Mailtexte (Deutsch). Die ersten Zeilen enthalten bei Einstiegsmails: Signalzeit, Auslöser, Kurs+Zeit, Stopp, Stückzahl, Risiko. */
import type { Config } from "./config";
import { SETUP_LABEL, type Prepared, type SetupId } from "./types";
import { formatBerlin, formatBerlinTime, berlinMinusNyHours, formatNy } from "./time";
import type { SizeResult } from "./sizing";
import { money } from "./sizing";
import type { SpContext, QqqDecision } from "./market";
import type { GrowthResult } from "./growth";
import type { EntryCheck } from "./entry";
import { STANCE_LABEL } from "./permission";
import { displaySymbol, marketOfKey } from "./markets";
const mkt = (key: string) => (marketOfKey(key) === "DE" ? "Markt: Xetra (EUR)" : "Markt: USA (Nasdaq/NYSE, USD)");

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

/** Kennzeichnung: jedes vom Bot erzeugte Signal ist eine Modellentscheidung; eine veröffentlichte Idee ist kein ausgeführter Trade. */
export function modelNote(origin: "model" | "idea" | undefined, source?: string): string {
  const base = "Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.";
  return origin === "idea"
    ? `${base}\nHerkunft: veröffentlichte Watchlist-Idee (${source ?? "extern"}), nicht vom Bot erzeugt. Eine veröffentlichte Watchlist-Idee ist kein ausgeführter Trade.`
    : base;
}
const cur = (p?: { currency?: string }) => p?.currency ?? "USD";

export function stagesBlock(a: { preparedAt: number; triggerAt: number; permitted: boolean; reasons: string[] }): string[] {
  return ["Entscheidungsstufen (getrennt):",
    `  1. Setup vorbereitet: ${formatBerlin(a.preparedAt)} – ja`,
    `  2. Technischer Trigger erreicht: ${formatBerlin(a.triggerAt)} – ja`,
    `  3. Einstieg nach Markt- und Risikoregeln zulässig: ${a.permitted ? "JA" : "NEIN"}${a.reasons.length ? " – " + a.reasons.join(" | ") : ""}`];
}

export interface CandidateInfo { rank: number; total: number; reasons: string[] }
export interface PrewarnItem { symbol: string; prepared: Prepared[]; rsPct?: number; expiresAt: number; candidate?: CandidateInfo | null }
const candLines = (c?: CandidateInfo | null) => (c ? [`Warum auf der Kandidatenliste: Rang ${c.rank} von ${c.total} im Markt – ${c.reasons.join("; ")}`] : ["Warum auf der Kandidatenliste: (Kandidatenprotokoll nicht verfügbar)"]);
const evLines = (p: Prepared) => (p.evidence?.length ? [`  Herkunft der Marken: ${p.evidence.join(" | ")}`] : []);

export function prewarnMail(cfg: Config, items: PrewarnItem[], now: number): Mail {
  const first = items[0];
  const subj = items.length === 1
    ? `Vorwarnung · ${displaySymbol(first.symbol)} · ${names(first.prepared.map((p) => p.setup))}`
    : `Vorwarnung · ${items.length} Setups · ${items.slice(0, 3).map((i) => displaySymbol(i.symbol)).join(", ")}${items.length > 3 ? " …" : ""}`;
  const lines = [modeLine(cfg) + `Stufe 1 von 3 – Setup vorbereitet (noch KEIN Trigger, KEIN Einstieg) · Stand ${formatBerlin(now)}${tzNote(now)}`, `${feedText(cfg)}`, ""];
  for (const it of items) {
    lines.push(...candLines(it.candidate).map((x) => `${displaySymbol(it.symbol)}: ${x}`));
    for (const p of it.prepared) {
      lines.push(`${displaySymbol(it.symbol)} · ${SETUP_LABEL[p.setup]} (${p.timeframe === "1h" ? "Stundenchart" : "Tageschart"}) · ${mkt(it.symbol)}`,
        p.needsHourClose ? `  Auslöser: Schluss der ersten Handelsstunde (10:30 New York) nicht unter der Eröffnung – ausdrücklich Stundenschluss, kein früheres Signal`
          : `  Auslösemarke: 5-Minuten-Schluss über ${px(p.trigger)}`,
        `  Geplanter Stopp: ${px(p.stop)} ${cur(p)} (Idee widerlegt bei Schluss/Tief unter ${px(p.invalidateBelow)})`,
        ...(p.stopBasis ? [`  Stopp-Bezug: ${p.stopBasis}`] : []),
        ...(p.contextLevels?.length ? [`  Kontext: ${p.contextLevels.map((c) => `${px(c.level)} ${cur(p)} (${c.label})`).join("; ")}`] : []),
        ...(p.origin === "idea" ? [`  Herkunft: veröffentlichte Watchlist-Idee (${p.source ?? "extern"}) – kein ausgeführter Trade`] : []),
        `  Verfall: ${formatBerlin(it.expiresAt)}` + (p.timeframe === "1h" ? "" : " oder Invalidierung"),
        ...evLines(p),
        `  Bereits erfüllt: ${p.conditions.join("; ")}`,
        `  Noch offen: ${p.pending.join("; ")}`, "");
    }
  }
  lines.push("Du erhältst eine Einstiegsmail nur, wenn der Auslöser bestätigt, die Markt- und Risikoregeln den Einstieg zulassen und der Kurs frisch geprüft ist; sonst „Nur beobachten“. Vorwarnungen lassen sich mit MAIL_PREWARN=false abschalten.", "", modelNote(items.every((i) => i.prepared.every((p) => p.origin === "idea")) ? "idea" : "model", items[0]?.prepared[0]?.source));
  return { subject: subj, text: lines.join("\n") };
}

export interface EntryParts {
  symbol: string; setups: SetupId[]; signalTime: number; trigger: number; stop: number;
  check: EntryCheck; size: SizeResult; reasons: string[]; sp: SpContext; qqq: QqqDecision; growth: GrowthResult;
  prepared: Prepared[]; link: string | null; feedUsed: string;
  regime?: string[]; stance?: string; preparedAt?: number; origin?: "model" | "idea"; source?: string; candidate?: CandidateInfo | null; rules?: string[];
}

export function entryMail(cfg: Config, e: EntryParts): Mail {
  const c = e.check;
  const lines = [
    modeLine(cfg) + `Signal: ${formatBerlin(e.signalTime)}${marketOfKey(e.symbol) === "US" ? ` (${formatNy(e.signalTime)})${tzNote(e.signalTime)}` : ""} · Modellentscheidung`,
    `Auslöser: ${px(e.trigger)} · Kurs ${px(c.observed!)} ${e.size.currency}, Zeitstempel ${formatBerlin(c.quoteTime!)}, geprüft ${formatBerlinTime(c.checkedAt)} (Alter ${Math.round(c.quoteAgeSec!)} s)`,
    `Stopp: ${px(e.stop)} ${e.size.currency} · Abstand ${px(c.observed! - e.stop)} ${e.size.currency} je Aktie (1R)` + (e.prepared.find((p) => p.stopBasis)?.stopBasis ? `\nStopp-Bezug: ${e.prepared.find((p) => p.stopBasis)!.stopBasis}` : ""),
    `Stückzahl: ${e.size.shares} (Einsatz ${money(cfg, e.size.cost, e.size.currency)}) · geplantes Risiko ${money(cfg, e.size.plannedRisk, e.size.currency)} = ${(e.size.plannedRisk / e.size.capital * 100).toFixed(2)} % des Depots`,
    `${mkt(e.symbol)} · Daten: ${e.feedUsed} · Limit-Orders bleiben bei dir; Kurs vor Order erneut prüfen.`, "",
    `Warum interessant: ${names(e.setups)}`, ...candLines(e.candidate),
  ];
  for (const p of e.prepared) {
    lines.push(`• ${SETUP_LABEL[p.setup]} – erfüllt: ${p.conditions.join("; ")}`);
    if (p.evidence?.length) lines.push(`  Herkunft der Marken: ${p.evidence.join(" | ")}`);
    if (p.contextLevels?.length) lines.push(`  Kontext (kein Trigger): ${p.contextLevels.map((c) => `${px(c.level)} ${cur(p)} (${c.label})`).join("; ")}`);
  }
  lines.push("• Bestätigung heute: " + e.reasons.join(" | "), "",
    `Ist der Einstieg noch sinnvoll? Der Kurs liegt ${c.chaseR!.toFixed(2)} R über dem Auslöser (Grenze ${cfg.maxChaseR} R). Widerlegt ist die Idee unter ${px(e.stop)}.`, "",
    ...stagesBlock({ preparedAt: e.preparedAt ?? e.signalTime, triggerAt: e.signalTime, permitted: true, reasons: [e.stance ?? "Marktvorgabe: offen"] }), "",
    `Marktkontext`, ...(e.regime ?? []), e.sp.text, e.qqq.text, e.growth.text, "", ...(e.rules ?? []), "",
    `Größenberechnung: ${e.size.limitedBy === "ok" ? "" : `begrenzt durch ${e.size.limitedBy}; `}Risikobudget ${money(cfg, e.size.riskBudget, e.size.currency)}, verfügbar ${money(cfg, e.size.available, e.size.currency)}, offenes Risiko vorher ${money(cfg, e.size.openRisk, e.size.currency)}.`,
    cfg.fxUsdPerEur ? `Wechselkurs: 1 EUR = ${cfg.fxUsdPerEur} USD (${cfg.fxSource}, ${cfg.fxDate}) – Order in Handelswährung ${e.size.currency}, Depot in ${cfg.accountCurrency}.` : `Depot- und Handelswährung: ${e.size.currency}.`, "");
  if (e.link) lines.push(`Gekauft? Kaufkurs und Stückzahl bestätigen (Link öffnet nur ein Formular, nichts wird gespeichert):`, e.link, `Nicht gekauft? Dort „ausgelassen“ wählen.`);
  lines.push("", modelNote(e.origin, e.source));
  return { subject: `Einstieg bestätigt · ${displaySymbol(e.symbol)} · ${names(e.setups)}`, text: lines.join("\n") };
}

export function missedMail(cfg: Config, symbol: string, setups: SetupId[], trigger: number, stop: number, c: EntryCheck, signalTime: number): Mail {
  return {
    subject: `Einstieg verpasst · ${displaySymbol(symbol)} · ${names(setups)}`,
    text: [modeLine(cfg) + `Signal: ${formatBerlin(signalTime)}`,
      `Auslöser: ${px(trigger)} · Kurs ${c.observed ? px(c.observed) : "–"} (${c.quoteTime ? formatBerlin(c.quoteTime) : "ohne Zeit"})`, `Stopp (geplant): ${px(stop)}`,
      `Status: ${c.reason}`, "", "Es wird kein Kauf empfohlen. Für dieses Setup kommt keine weitere Meldung; ein neuer, eigenständiger Ausbruch löst wieder aus."].join("\n"),
  };
}

export function positionMail(cfg: Config, kind: string, symbol: string, body: string[], now: number): Mail {
  return { subject: `${kind} · ${displaySymbol(symbol)}`, text: [modeLine(cfg) + `Stand ${formatBerlin(now)}`, ...body].join("\n") };
}

export function linkify(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;font-size:15px;line-height:1.45">${esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</pre>`;
}

export interface WatchParts {
  symbol: string; setups: SetupId[]; signalTime: number; preparedAt: number; trigger: number; stop: number; currency: string;
  check: EntryCheck | null; reasons: string[]; regime: string[]; stance: string; qqqText: string; prepared: Prepared[]; origin?: "model" | "idea"; source?: string; candidate?: CandidateInfo | null; rules?: string[];
}

/** „Nur beobachten“: Trigger erreicht, aber Einstieg nach den Markt-/Risikoregeln nicht zulässig. Enthält bewusst keinen Kauf-Link. */
export function watchMail(cfg: Config, w: WatchParts): Mail {
  const c = w.check;
  const lines = [
    modeLine(cfg) + `NUR BEOBACHTEN – kein Einstieg. Technischer Trigger erreicht, aber Einstieg nicht zulässig.`,
    `Grund: ${w.reasons.join(" | ")}`,
    `Signal: ${formatBerlin(w.signalTime)}${marketOfKey(w.symbol) === "US" ? ` (${formatNy(w.signalTime)})${tzNote(w.signalTime)}` : ""} · Modellentscheidung`,
    `${mkt(w.symbol)} · Trigger: ${px(w.trigger)} ${w.currency}` + (c?.observed ? ` · Kurs ${px(c.observed)} ${w.currency}, Zeitstempel ${c.quoteTime ? formatBerlin(c.quoteTime) : "unbekannt"}, geprüft ${formatBerlinTime(c.checkedAt)}` : " · kein frischer Kurs geprüft"),
    `Geplanter Stopp wäre ${px(w.stop)} ${w.currency}` + (w.prepared.find((p) => p.stopBasis)?.stopBasis ? ` (Stopp-Bezug: ${w.prepared.find((p) => p.stopBasis)!.stopBasis})` : "") + " – keine Stückzahl, kein Kauf-Link, keine Kaufbestätigung.", "",
    `Warum interessant: ${names(w.setups)}`, ...candLines(w.candidate),
    ...w.prepared.flatMap((p) => [`• ${SETUP_LABEL[p.setup]} – erfüllt: ${p.conditions.join("; ")}`, ...(p.evidence?.length ? [`  Herkunft der Marken: ${p.evidence.join(" | ")}`] : []), ...(p.contextLevels?.length ? [`  Kontext (kein Trigger): ${p.contextLevels.map((c) => `${px(c.level)} ${cur(p)} (${c.label})`).join("; ")}`] : [])]), "",
    ...stagesBlock({ preparedAt: w.preparedAt, triggerAt: w.signalTime, permitted: false, reasons: w.reasons }), "",
    "Marktlage (Modellbewertung, kein fester Freigabe-Schwellenwert)", w.stance, ...w.regime, w.qqqText, "", ...(w.rules ?? []), "",
    "Das Setup bleibt vorbereitet. Ändert sich deine Marktvorgabe, kann ein späterer Trigger wieder zulässig sein; ein inzwischen davongelaufener Kurs gilt dann als „Einstieg verpasst“.", "",
    modelNote(w.origin, w.source),
  ];
  return { subject: `Nur beobachten · ${displaySymbol(w.symbol)} · ${names(w.setups)}`, text: lines.join("\n") };
}
export { STANCE_LABEL };

/**
 * Regelstatus für Einstiegs- und Beobachtungsmails: welche Regel sperrt, welche liefert nur Kontext, welche Daten fehlen.
 * Baron (S&P 500 vs. SMA200) und Giering (Wachstum) sind Kontext und sperren nie allein; gesperrt wird nur durch Marktvorgabe,
 * QQQ-Filter (nur USA), Stoppweite, Kapital/Risiko und Kursprüfung.
 */
export function ruleStatus(a: { blocks: string[]; sp: SpContext; growth: GrowthResult; qqq: QqqDecision; regimeKnown: boolean; leadershipKnown: boolean; market: "US" | "DE"; prepared: Prepared[]; usInfo?: string }): string[] {
  const ctx: string[] = [
    `Baron: ${a.sp.text}`, `Giering: ${a.growth.text}`,
    ...(a.market === "US" ? [`QQQ-Marktfilter: ${a.qqq.text}`] : []),
    ...a.prepared.flatMap((p) => (p.contextLevels ?? []).map((c) => `Kontextmarke ${px(c.level)} ${cur(p)} – ${c.label}`)),
  ];
  const missing: string[] = [];
  if (a.sp.state === "unbekannt") missing.push("S&P-500-Daten (FRED)");
  else if (!a.sp.isLastCompleted) missing.push(`S&P-500-Schluss vom ${a.sp.lastCompleted} (bei FRED noch nicht veröffentlicht)`);
  if (a.growth.verdict === "offen") missing.push(`Wachstumsdaten (${a.growth.reason})`);
  if (!a.regimeKnown) missing.push("Marktlage dieses Marktes (Tageslauf fehlt)");
  if (!a.leadershipKnown) missing.push("Führungsgruppen (nur Information)");
  return ["Regelstatus:",
    `  Sperren: ${a.blocks.length ? a.blocks.join(" | ") : "keine – alle sperrenden Regeln (Marktvorgabe, " + (a.market === "US" ? "QQQ-Filter, " : "") + "Stoppweite, Kapital/Risiko, Kursprüfung) lassen den Einstieg zu"}`,
    `  Nur Kontext (sperrt nicht): ${ctx.join(" | ")}`,
    `  Fehlende Daten: ${missing.length ? missing.join(" | ") : "keine"}`,
    ...(a.usInfo ? [`  US-Informationen am deutschen Vormittag: ${a.usInfo}`] : [])];
}
