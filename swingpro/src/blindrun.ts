/**
 * Historischer Blindlauf. Der Scanner bekommt für jeden Stichtag NUR das Universum und die Daten, die an diesem Stichtag vorlagen
 * (Kerzen bis zum Sitzungsschluss, keine späteren Kerzen, keine Quotes). Ziel-Titel werden ihm NICHT übergeben: sie werden erst NACH dem
 * Lauf ausgewertet (evaluateTargets) – anhand dessen, was der Scanner eigenständig protokolliert hat.
 *
 * Beweiswert (Provenienz) wird ausgewiesen und nie überhöht:
 *  - universe = "point_in_time": nachweislich damals verfügbares Universum (z. B. archivierter Bestand).
 *  - universe = "current_assets": heutiger Bestand (Survivorship-Verzerrung) → KEIN historischer Echtdaten-Nachweis.
 *  - data = "fixture": erfundene/nachgebaute Kurse → Funktionsprüfung, kein Nachweis.
 */
import type { Deps } from "./deps";
import type { MarketData } from "./marketdata";
import type { MarketId } from "./markets";
import { runDaily } from "./jobs/daily";
import { all, one } from "./store";
import { classifyAsset, classifyDe } from "./universe";
import { SETUP_LABEL, type Prepared, type SetupId } from "./types";
import type { AssetRaw } from "./providers";

export interface Provenance { universe: "point_in_time" | "current_assets" | "fixture"; data: "historical_real" | "fixture"; note?: string }
export const evidenceLevel = (p: Provenance): { level: "belegt" | "nicht_belegt"; text: string } =>
  p.universe === "point_in_time" && p.data === "historical_real"
    ? { level: "belegt", text: "Historischer Echtdaten-Lauf mit zeitpunktgenauem Universum." }
    : { level: "nicht_belegt", text: p.data === "fixture" ? "KEIN historischer Echtdaten-Nachweis: nachgebaute/erfundene Kurse (Funktionsprüfung)." : "KEIN historischer Echtdaten-Nachweis: Universum ist der HEUTIGE Bestand (Survivorship-Verzerrung)." };

/** Datenanbieter, der nur Stände bis zum Stichtag preisgibt: keine späteren Kerzen, keine 5-Minuten-Kerzen, keine Quotes. */
export function clipToAsOf(base: MarketData, asOfEnd: number): MarketData {
  return {
    ...base, feedLabel: `${base.feedLabel} (Blindlauf, Stand ≤ ${new Date(asOfEnd).toISOString()})`,
    assets: () => base.assets(),
    async dailyBars(keys, start, endMs) { const r = await base.dailyBars(keys, start, Math.min(endMs, asOfEnd)); return { requests: r.requests, bars: new Map([...r.bars].map(([k, v]) => [k, v.filter((b) => b.end <= asOfEnd)])) }; },
    bars5: async () => new Map(), quotes: async (keys) => new Map(keys.map((k) => [k, { quote: null, sessionOpen: null }])),
  };
}

export interface BlindRunResult { market: MarketId; dates: string[]; log: string[]; provenance: Provenance }

/** Tageslauf für jeden Stichtag nacheinander; `d.now` wird je Stichtag auf den Abend gesetzt. */
export async function runBlind(d: Deps & { clock?: { t: number } }, market: MarketId, dates: string[], provenance: Provenance): Promise<BlindRunResult> {
  const mk = d.markets[market], orig = mk.data, log: string[] = [];
  try {
    for (const date of dates) {
      const s = mk.sessionFor(date);
      if (!s) { log.push(`${date}: keine Sitzung`); continue; }
      mk.data = clipToAsOf(orig, s.close + 2 * 3_600_000);
      if (d.clock) d.clock.t = s.close + 60 * 60_000;
      log.push(`${date}: ${await runDaily(d, market)}`);
    }
  } finally { mk.data = orig; }
  return { market, dates, log, provenance };
}

/** Zustände, in denen eine Vorbereitung am Stichtag noch gilt */
const LIVE = ["active", "fired", "missed", "watch_only", "blocked"];

export interface TargetReport {
  key: string; inUniverse: boolean; excludedBy: string | null; enoughData: boolean; bars: number; prefilterPassed: boolean | null; rank: number | null; total: number | null;
  setups: { setup: SetupId; trigger: number; stop: number; invalidateBelow: number; currency: string; state: string; armedAt: number; expiresAt: number; evidence: string[] }[];
  firstExclusion: string | null; status: string;
}

/** Auswertung NACH dem Lauf: im Universum · ausreichend Daten · Vorauswahl · Rang · Formation · eigene Marke · Status; sonst der erste konkrete Ausschlussgrund. */
export async function evaluateTargets(d: Deps, market: MarketId, keys: string[], asof: string): Promise<TargetReport[]> {
  const mk = d.markets[market];
  let provider: Awaited<ReturnType<MarketData["assets"]>> = []; let gap: string | null = null;
  try { provider = await mk.data.assets(); } catch (e) { gap = e instanceof Error ? e.message : String(e); }
  const out: TargetReport[] = [];
  for (const key of keys) {
    const a = provider.find((x) => x.key === key);
    const asset = await one<any>(d.db, "SELECT symbol FROM assets WHERE symbol=? AND market=?", key, market);
    const m = await one<any>(d.db, "SELECT price, reason, passed FROM metrics WHERE symbol=? AND asof=?", key, asof);
    const nb = await one<{ n: number }>(d.db, "SELECT json_array_length(data) n FROM series WHERE symbol=? AND tf='1d'", key);
    const c = await one<any>(d.db, "SELECT rank FROM candidate_log WHERE inst_key=? AND asof=?", key, asof);
    const tot = await one<{ n: number }>(d.db, "SELECT COUNT(*) n FROM candidate_log WHERE asof=? AND market=?", asof, market);
    const prep = await all<any>(d.db, "SELECT * FROM prepared WHERE symbol=? AND state IN ('active','fired','missed','watch_only','expired','invalidated','blocked') ORDER BY created_at DESC", key);
    let excludedBy: string | null = null;
    if (!asset && a) excludedBy = market === "US" ? classifyAsset(a.raw as AssetRaw, d.cfg).reason : classifyDe(a, d.cfg).reason;
    const inUniverse = !!asset, enough = (nb?.n ?? 0) >= d.cfg.minHistoryDays;
    let first: string | null = null;
    if (gap) first = `Datenzugang fehlt – ${gap}`;
    else if (!a) first = `nicht in der Instrumentenliste des Anbieters (${mk.data.feedLabel})`;
    else if (!inUniverse) first = `im Universum ausgeschlossen: ${excludedBy ?? "unbekannt"}`;
    else if (!enough) first = `zu wenig Daten: ${nb?.n ?? 0} Tageskerzen (nötig ${d.cfg.minHistoryDays})`;
    else if (m && !m.passed) first = `Vorauswahl nicht bestanden: ${m.reason}`;
    else if (!prep.some((r) => LIVE.includes(r.state))) first = "Vorauswahl bestanden, aber keine Formation erfüllt am Stichtag alle Bedingungen" + (prep.length ? ` (frühere Vorbereitungen sind ${[...new Set(prep.map((r) => r.state))].join("/")})` : "");
    const setups = prep.map((r) => { const p: Prepared = JSON.parse(r.data); return { setup: p.setup, trigger: r.trigger_price, stop: r.stop_price, invalidateBelow: p.invalidateBelow, currency: p.currency ?? mk.currency, state: r.state, armedAt: r.armed_at, expiresAt: r.expires_at, evidence: p.evidence ?? [] }; });
    out.push({ key, inUniverse, excludedBy, enoughData: enough, bars: nb?.n ?? 0, prefilterPassed: m ? !!m.passed : null, rank: c?.rank ?? null, total: tot?.n ?? null, setups, firstExclusion: first,
      status: first ? "kein Setup" : `Setup ${setups.filter((s) => LIVE.includes(s.state)).map((s) => `${SETUP_LABEL[s.setup]} (${s.state})`).join(", ")}` });
  }
  return out;
}

export function renderReport(r: TargetReport[], prov: Provenance): string {
  const ev = evidenceLevel(prov);
  const L = [`Beweiswert: ${ev.level.toUpperCase()} – ${ev.text}${prov.note ? " " + prov.note : ""}`, ""];
  for (const t of r) {
    L.push(`${t.key}: ${t.status}`,
      `  im Universum: ${t.inUniverse ? "ja" : "nein"} · ausreichende Daten: ${t.enoughData ? "ja" : "nein"} (${t.bars} Kerzen) · Vorauswahl: ${t.prefilterPassed === null ? "–" : t.prefilterPassed ? "bestanden" : "nein"} · Rang: ${t.rank ?? "–"}${t.total ? ` von ${t.total}` : ""}`);
    for (const s of t.setups) L.push(`  Formation ${SETUP_LABEL[s.setup]} [${s.state}]: Trigger ${s.trigger.toFixed(2)} ${s.currency}, Stopp ${s.stop.toFixed(2)}, widerlegt unter ${s.invalidateBelow.toFixed(2)}, verfällt ${new Date(s.expiresAt).toISOString().slice(0, 10)}`);
    if (t.firstExclusion) L.push(`  erster Ausschlussgrund: ${t.firstExclusion}`);
  }
  return L.join("\n");
}
