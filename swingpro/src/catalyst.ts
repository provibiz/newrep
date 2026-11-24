/** Katalysator für den Episodic Pivot: ausschließlich Quartalszahlen (EPS-Meldung). Andere Nachrichten werden nicht untersucht. */
import { nyToUtc, parseDateKey } from "./time";
import { previousSession } from "./calendar";

export interface EarningsEvent {
  symbol: string;
  date: string;                 // Berichtsdatum laut Anbieter (nur Datum!)
  epsActual: number | null;
  timing?: "bmo" | "amc" | null; // falls der Anbieter/Fixture es liefert
  /** Zeitpunkt, ab dem die Meldung nachweislich öffentlich war (UTC ms). Live: Abrufzeit des ersten Treffers. */
  availableAt?: number | null;
}
export interface CatalystResult { ok: boolean; reason: string; evidence: string }

/**
 * Prüft, ob die Meldung zum Entscheidungszeitpunkt `decisionAt` nachweislich bekannt war.
 * - Kalenderdatum allein genügt nur für den Vortag (Meldung lag dann sicher vor der Eröffnung des Gap-Tages).
 * - Meldung am Gap-Tag selbst braucht entweder timing=bmo oder einen belegten availableAt vor decisionAt.
 *   Ein bloßes Datum macht eine Meldung nach Börsenschluss nicht zum Signal am Vormittag.
 */
export function catalystKnown(ev: EarningsEvent | undefined, gapDay: string, decisionAt: number): CatalystResult {
  if (!ev) return { ok: false, reason: "keine Quartalszahlen-Meldung gefunden", evidence: "" };
  if (ev.epsActual === null || ev.epsActual === undefined) return { ok: false, reason: "EPS-Ist-Wert noch nicht veröffentlicht", evidence: "" };
  const prev = previousSession(gapDay);
  const { y, m, d } = parseDateKey(ev.date);
  const label = `Quartalszahlen vom ${ev.date} (EPS ${ev.epsActual})`;
  if (ev.date === prev) {
    const t = ev.availableAt;
    if (t !== undefined && t !== null && t > decisionAt) return { ok: false, reason: "Meldung war zum Entscheidungszeitpunkt noch nicht belegt", evidence: label };
    return { ok: true, reason: "", evidence: label + (ev.timing ? ` (${ev.timing === "amc" ? "nach" : "vor"} Handelsschluss)` : " · Datum liegt vor dem Gap-Tag") };
  }
  if (ev.date === gapDay) {
    let at: number | null = ev.availableAt ?? null;
    if (at === null && ev.timing === "bmo") at = nyToUtc(y, m, d, 9, 30);
    if (at === null && ev.timing === "amc") at = nyToUtc(y, m, d, 16, 0);
    if (at === null) return { ok: false, reason: "Zeitpunkt der Meldung am Gap-Tag unklar (nur Datum bekannt)", evidence: label };
    if (at > decisionAt) return { ok: false, reason: "Meldung kam erst nach dem Entscheidungszeitpunkt", evidence: label };
    return { ok: true, reason: "", evidence: label + " · Veröffentlichung belegt vor der Entscheidung" };
  }
  return { ok: false, reason: `Meldedatum ${ev.date} liegt nicht beim Gap (${prev} oder ${gapDay})`, evidence: label };
}
