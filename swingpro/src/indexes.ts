/**
 * Indexmitgliedschaften zur Abdeckungskontrolle (USA: S&P 500, S&P MidCap 400, S&P SmallCap 600, Nasdaq-100;
 * Deutschland: DAX, MDAX, SDAX, TecDAX). Das Universum entsteht NICHT aus den Indizes: gescannt wird jede geeignete Aktie –
 * die Indizes dienen nur der Kontrolle („wie vollständig ist die Abdeckung?“). Mehrere Mitgliedschaften sind Tags am selben Instrument
 * und erzeugen nie doppelte Alarme.
 *
 * Quellen: nur S&P 500 hat eine geprüfte Standardquelle (iShares-IVV-Holdings-CSV, laut Abruf am 25.11.2026 HTTP 200, ohne ISIN-Spalte).
 * Für alle anderen Indizes ist keine frei nutzbare Quelle belegt: sie werden über INDEX_SOURCES konfiguriert; sonst zeigt die Statusseite
 * „Quelle fehlt“ (Lücke), nicht „0 Mitglieder“.
 */
import type { MarketId } from "./markets";
import type { Fetch } from "./providers";

export interface IndexDef { id: string; label: string; market: MarketId }
export const INDEXES: IndexDef[] = [
  { id: "SP500", label: "S&P 500", market: "US" }, { id: "SP400", label: "S&P MidCap 400", market: "US" },
  { id: "SP600", label: "S&P SmallCap 600", market: "US" }, { id: "NDX", label: "Nasdaq-100", market: "US" },
  { id: "DAX", label: "DAX", market: "DE" }, { id: "MDAX", label: "MDAX", market: "DE" }, { id: "SDAX", label: "SDAX", market: "DE" }, { id: "TECDAX", label: "TecDAX", market: "DE" },
];

export interface IndexSource { url: string; format: "ishares_csv" | "generic_csv"; note?: string; columns?: { ticker?: string; isin?: string; name?: string } }
export const DEFAULT_SOURCES: Record<string, IndexSource> = {
  SP500: { url: "https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv", format: "ishares_csv", note: "iShares Core S&P 500 ETF (IVV), tägliche Holdings; keine ISIN" },
};

export interface IndexMember { symbol: string; isin: string | null; name: string }

/** Minimaler CSV-Parser (Anführungszeichen, Kommas in Feldern). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

/** iShares-/Generic-CSV → Mitglieder. Kopfzeilen vor der Tabelle werden übersprungen, Nicht-Aktien (Cash, Futures) ausgeschlossen. */
export function parseIndexCsv(text: string, src: Pick<IndexSource, "format" | "columns">): IndexMember[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const hi = rows.findIndex((r) => r.some((c) => /^(ticker|symbol|emittententicker)$/i.test(c.trim())));
  if (hi < 0) throw new Error("Indexdatei: keine Kopfzeile mit Ticker/Symbol gefunden");
  const head = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (name: string | undefined, ...alts: string[]) => { const want = [name?.toLowerCase(), ...alts].filter(Boolean) as string[]; return head.findIndex((h) => want.includes(h)); };
  const iT = col(src.columns?.ticker, "ticker", "symbol", "emittententicker"), iI = col(src.columns?.isin, "isin"), iN = col(src.columns?.name, "name"), iA = col(undefined, "asset class", "anlageklasse");
  if (iT < 0) throw new Error("Indexdatei: Ticker-Spalte fehlt");
  const out: IndexMember[] = [];
  for (const r of rows.slice(hi + 1)) {
    const t = (r[iT] ?? "").trim();
    if (!t || t === "-") continue;
    if (iA >= 0 && r[iA] && !/equity|aktie/i.test(r[iA])) continue;
    out.push({ symbol: t.toUpperCase(), isin: iI >= 0 ? (r[iI] ?? "").trim().toUpperCase() || null : null, name: iN >= 0 ? (r[iN] ?? "").trim() : "" });
  }
  return out;
}

const norm = (s: string) => s.toUpperCase().replace(/\.(DE|XETR|ETR)$/, "").replace(/[.\-/ ]/g, "");

/** Ordnet Mitglieder den erfassten Instrumenten zu: ISIN zuerst, dann Ticker (ohne Punkte/Bindestriche). */
export function matchMembers(members: IndexMember[], assets: { key: string; symbol: string; isin: string | null }[]) {
  const byIsin = new Map(assets.filter((a) => a.isin).map((a) => [a.isin!, a.key]));
  const byTicker = new Map(assets.map((a) => [norm(a.symbol), a.key]));
  const matched = new Map<string, string>(), unmatched: IndexMember[] = [];
  for (const m of members) {
    const k = (m.isin && byIsin.get(m.isin)) || byTicker.get(norm(m.symbol));
    if (k) matched.set(k, m.symbol); else unmatched.push(m);
  }
  return { matched, unmatched };
}

export function sourcesFrom(env: unknown): Record<string, IndexSource> {
  let extra: Record<string, IndexSource> = {};
  if (typeof env === "string" && env.trim()) { try { extra = JSON.parse(env); } catch { throw new Error("INDEX_SOURCES ist kein gültiges JSON"); } }
  return { ...DEFAULT_SOURCES, ...extra };
}

export async function fetchIndexMembers(f: Fetch, src: IndexSource): Promise<IndexMember[]> {
  const res = await f(src.url, { headers: { "User-Agent": "SwingPro/1.0" } });
  if (!res.ok) throw new Error(`Indexquelle HTTP ${res.status}`);
  return parseIndexCsv(await res.text(), src);
}

export interface IndexCoverage {
  id: string; label: string;
  status: "ok" | "quelle_fehlt" | "abruf_fehlgeschlagen";
  source: string | null; error?: string; asof?: string;
  members: number | null; captured: number; withData: number; checked: number;
  excludedByFilter: Record<string, number>; unmatched: { symbol: string; name: string }[]; unmatchedCount: number;
}
export interface Coverage {
  market: MarketId; asof: string; available: number; excludedByClass: Record<string, number>; included: number; withData: number; dataGaps: number;
  passedFilters: number; checked: number; indexes: IndexCoverage[];
  outside: { captured: number; withData: number; checked: number };
  dataAccess: { ok: boolean; detail: string };
}

/** Filtergrund ohne Zahlen, damit gleiche Ursachen zusammengezählt werden. */
export function reasonCategory(r: string | null | undefined): string {
  if (!r) return "kein Filter";
  if (/^Kurs/.test(r)) return "Mindestkurs";
  if (/Dollarumsatz|Umsatz/.test(r)) return "Mindestumsatz";
  if (/Tagesspanne/.test(r)) return "Tagesspanne";
  if (/istorie/.test(r)) return "zu wenig Historie";
  if (/Relative Stärke/.test(r)) return "relative Stärke";
  if (/Obergrenze/.test(r)) return "Obergrenze Beobachtungsliste";
  if (/keine Daten|fehlt/.test(r)) return "keine aktuellen Daten";
  return r.slice(0, 40);
}
