/**
 * Dritte Entscheidung: „Einstieg nach den konfigurierten Markt- und Risikoregeln zulässig“.
 * Sie ist getrennt von „Setup vorbereitet“ und „technischer Trigger erreicht“ und immer eine Modellentscheidung des Bots
 * auf Grundlage deiner Marktvorgabe (open | selective | cash) und des QQQ-Filters.
 * Es gibt bewusst keinen allgemeingültigen numerischen Schwellenwert für eine Marktfreigabe.
 */
import type { Config } from "./config";
import type { Deps } from "./deps";
import { getMeta, setMeta } from "./store";
import { SETUP_LABEL, type SetupId } from "./types";
import type { QqqDecision } from "./market";
import { formatBerlin } from "./time";

export type Stance = Config["stance"];
export interface StanceState { stance: Stance; note: string | null; setAt: number | null; source: "config" | "user" }

export const STANCE_LABEL: Record<Stance, string> = { open: "offen (normale Regeln)", selective: "selektiv", cash: "Cash (kein neuer Einstieg)" };

export async function getStance(d: Deps): Promise<StanceState> {
  const o = await getMeta<StanceState>(d.db, "market_stance");
  if (o) return o;
  return { stance: d.cfg.stance, note: d.cfg.stanceNote || null, setAt: null, source: "config" };
}
export async function setStance(d: Deps, stance: Stance, note: string | null) {
  if (!["open", "selective", "cash"].includes(stance)) throw new Error("ungültige Marktvorgabe");
  await setMeta(d.db, "market_stance", { stance, note: note?.slice(0, 300) || null, setAt: d.now(), source: "user" } satisfies StanceState, d.now());
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
  const base = `Marktvorgabe: ${STANCE_LABEL[st.stance]}` + (st.setAt ? ` (gesetzt ${formatBerlin(st.setAt)})` : " (aus der Konfiguration)") + (st.note ? ` – ${st.note}` : "");
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
