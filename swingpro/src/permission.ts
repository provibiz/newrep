/**
 * Dritte Entscheidung: „Einstieg nach den konfigurierten Markt- und Risikoregeln zulässig“ – immer eine Modellentscheidung des Bots.
 *
 * Marktvorgabe je Markt (Reihenfolge):
 *  1. Manuelle Vorgabe („offen“, „selektiv“, „cash“): nur mit Begründung UND Ablaufzeit (höchstens STANCE_MAX_DAYS). Nach Ablauf gilt wieder 2.
 *  2. Automatische Modellentscheidung aus der Marktlage (AUTO_STANCE=true, Standard): zählt „bärische Merkmale“ aus Marktbreite,
 *     Anteil über SMA50, Führung durch Wachstumsgruppen und (nur USA) S&P 500 vs. SMA200. Schwellen sind konfigurierbare Modellannahmen,
 *     keine allgemeingültigen Börsenregeln. Follow-Through-Day und Erholungsversuch sind nur Information und geben nie allein frei.
 *  3. Veraltete oder fehlende Marktdaten (älter als AUTO_STALE_SESSIONS Sitzungen) → AUTO_STALE_STANCE (Standard: cash). Fehlende Daten geben nie frei.
 *  4. AUTO_STANCE=false → MARKET_STANCE aus der Konfiguration (Standard: offen).
 */
import type { Config } from "./config";
import type { Deps } from "./deps";
import { getMeta, setMeta } from "./store";
import { SETUP_LABEL, type SetupId } from "./types";
import type { QqqDecision } from "./market";
import { formatBerlin } from "./time";
import type { MarketId, Market } from "./markets";
import type { Regime } from "./regime";
import type { SpContext } from "./market";

export type Stance = Config["stance"];
export interface StanceState {
  stance: Stance; note: string | null; setAt: number | null;
  source: "config" | "manual" | "auto" | "stale_default";
  until?: number | null; reasons?: string[]; flags?: number; asof?: string | null;
}
export const STANCE_LABEL: Record<Stance, string> = { open: "offen (normale Regeln)", selective: "selektiv", cash: "Cash (kein neuer Einstieg)" };

interface Override { stance: Stance; note: string; setAt: number; until: number }
const ovKey = (m: string) => `stance_override:${m}`;

export async function getOverride(d: Deps, market: MarketId): Promise<{ ov: Override | null; expired: Override | null; scope: string | null }> {
  for (const scope of [market, "ALL"]) {
    const ov = await getMeta<Override>(d.db, ovKey(scope));
    if (ov) return ov.until > d.now() ? { ov, expired: null, scope } : { ov: null, expired: ov, scope };
  }
  return { ov: null, expired: null, scope: null };
}

/** Manuelle Vorgabe setzen: Begründung und Ablaufzeit sind Pflicht. */
export async function setStance(d: Deps, stance: Stance, note: string, opts: { market?: MarketId | "ALL"; hours?: number } = {}) {
  if (!["open", "selective", "cash"].includes(stance)) throw new Error("ungültige Marktvorgabe");
  if (!note || note.trim().length < 3) throw new Error("Eine manuelle Marktvorgabe braucht eine Begründung");
  const hours = opts.hours ?? 0;
  if (!(hours > 0) || hours > d.cfg.stanceMaxDays * 24) throw new Error(`Eine manuelle Marktvorgabe braucht eine Ablaufzeit (höchstens ${d.cfg.stanceMaxDays} Tage)`);
  await setMeta(d.db, ovKey(opts.market ?? "ALL"), { stance, note: note.trim().slice(0, 300), setAt: d.now(), until: d.now() + hours * 3_600_000 } satisfies Override, d.now());
}
export async function clearStance(d: Deps, market: MarketId | "ALL" = "ALL") { await setMeta(d.db, ovKey(market), null, d.now()); }

/** Automatische Modellentscheidung aus Marktlage (siehe Kopfkommentar). Rein, getestet. */
export function deriveAutoStance(cfg: Config, mk: Pick<Market, "id" | "previousSession">, regime: Regime | null, sp: SpContext | null, now: number, today: string): StanceState {
  const stale = (why: string): StanceState => ({ stance: cfg.autoStaleStance, note: null, setAt: now, source: "stale_default", reasons: [why, "fehlende oder veraltete Daten geben nie frei"], flags: 0, asof: regime?.asof ?? null });
  if (!regime) return stale("keine Marktlage berechnet");
  let d = today, age = 0;
  while (d > regime.asof && age < 30) { d = mk.previousSession(d); age++; }
  if (age > cfg.autoStaleSessions) return stale(`Marktlage ${regime.asof} ist ${age} Sitzungen alt (Grenze ${cfg.autoStaleSessions})`);
  const reasons: string[] = []; let flags = 0;
  const b = regime.breadth;
  if (!b) { flags++; reasons.push("Marktbreite nicht bewertbar (Daten fehlen) – zählt vorsichtshalber als bärisch"); }
  else {
    const ratio = b.newHighs / Math.max(1, b.newLows);
    if (ratio < cfg.autoMinHighLowRatio) { flags++; reasons.push(`neue Hochs/Tiefs ${b.newHighs}/${b.newLows} (Verhältnis ${ratio.toFixed(2)} < ${cfg.autoMinHighLowRatio})`); }
    if ((b.above50Pct ?? 100) < cfg.autoMinAbove50Pct) { flags++; reasons.push(`nur ${b.above50Pct!.toFixed(0)} % der Aktien über SMA50 (Grenze ${cfg.autoMinAbove50Pct} %)`); }
  }
  if (regime.leadership?.growthLeading === false) { flags++; reasons.push("Wachstumsgruppen führen nicht"); }
  else if (!regime.leadership) reasons.push("Führungsgruppen nicht bewertet (nur Information, kein Merkmal)");
  if (mk.id === "US") {
    if (sp && sp.state === "unter") { flags++; reasons.push(`S&P 500 unter SMA200 (${sp.close?.toFixed(2)} / ${sp.sma200?.toFixed(2)}, ${sp.obsDate})`); }
    else if (!sp || sp.state === "unbekannt") reasons.push("S&P 500 vs. SMA200 unbekannt (nur Information, kein Merkmal)");
  }
  const ftd = regime.ftd.find((f) => f.state === "Follow-Through-Day");
  if (ftd) reasons.push(`${ftd.index}: Follow-Through-Day nur zur Information – gibt allein nichts frei`);
  const stance: Stance = flags >= cfg.autoBearishFlagsCash ? "cash" : flags >= cfg.autoBearishFlagsSelective ? "selective" : "open";
  if (!reasons.length) reasons.push("kein bärisches Merkmal");
  return { stance, note: null, setAt: now, source: "auto", reasons, flags, asof: regime.asof };
}

export async function getStance(d: Deps, market: MarketId = "US"): Promise<StanceState> {
  const { ov } = await getOverride(d, market);
  if (ov) return { stance: ov.stance, note: ov.note, setAt: ov.setAt, until: ov.until, source: "manual" };
  if (!d.cfg.autoStance) return { stance: d.cfg.stance, note: d.cfg.stanceNote || null, setAt: null, source: "config" };
  const regime = await getMeta<Regime>(d.db, `regime:${market}`);
  const sp = market === "US" ? (await getMeta<{ at: number; ctx: SpContext }>(d.db, "sp_context"))?.ctx ?? null : null;
  const mk = d.markets[market];
  return deriveAutoStance(d.cfg, mk, regime, sp, d.now(), mk.dateOf(d.now()));
}

export interface Permission {
  permitted: boolean;
  allowed: SetupId[];
  blocked: { setup: SetupId; reason: string }[];
  /** Obergrenze des Positionsgewichts in der Marktvorgabe „selektiv“ (sonst null) */
  weightCapPct: number | null;
  stanceText: string;
}

export function stanceText(cfg: Config, st: StanceState): string {
  const label = STANCE_LABEL[st.stance];
  let base: string;
  if (st.source === "manual") base = `Marktvorgabe (manuell, gültig bis ${formatBerlin(st.until!)}): ${label} – ${st.note}`;
  else if (st.source === "auto") base = `Marktvorgabe (automatisch aus der Marktlage, Stand ${st.asof}): ${label} – ${(st.reasons ?? []).join("; ")}`;
  else if (st.source === "stale_default") base = `Marktvorgabe (Standard bei fehlenden/veralteten Marktdaten): ${label} – ${(st.reasons ?? []).join("; ")}`;
  else base = `Marktvorgabe: ${label}` + (st.setAt ? ` (gesetzt ${formatBerlin(st.setAt)})` : " (aus der Konfiguration)") + (st.note ? ` – ${st.note}` : "");
  if (st.stance === "selective") {
    const lab = cfg.stanceSelectiveSetups.map((x) => SETUP_LABEL[x as SetupId] ?? x).join(", ");
    const w = cfg.stanceWeightMin !== null || cfg.stanceWeightMax !== null ? `, geplanter Einsatz ${cfg.stanceWeightMin ?? "–"}–${cfg.stanceWeightMax ?? "–"} % des Depots` : "";
    return `${base}; erlaubt nur: ${lab}${w}`;
  }
  return base;
}

export function decidePermission(cfg: Config, st: StanceState, setups: SetupId[], qqq: QqqDecision): Permission {
  const blocked: Permission["blocked"] = [], allowed: SetupId[] = [];
  for (const s of setups) {
    if (st.stance === "cash") blocked.push({ setup: s, reason: `${stanceText(cfg, st)} – Depot bleibt in Cash, kein Einstieg, nur Beobachtung` });
    else if (st.stance === "selective" && !cfg.stanceSelectiveSetups.includes(s)) blocked.push({ setup: s, reason: `${stanceText(cfg, st)} – ${SETUP_LABEL[s]} gehört nicht dazu` });
    else if (qqq.blocked.includes(s)) blocked.push({ setup: s, reason: qqq.text });
    else allowed.push(s);
  }
  return { permitted: allowed.length > 0, allowed, blocked, weightCapPct: st.stance === "selective" ? cfg.stanceWeightMax : null, stanceText: stanceText(cfg, st) };
}
