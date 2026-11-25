/** Gemeinsame Typen. Alle Zeiten sind UTC-Millisekunden (Ende der Kerze), sofern nicht anders genannt. */

export interface Bar {
  /** Ende der Kerze (exklusiv), UTC ms. Eine Kerze 09:30–10:30 NY hat end = 10:30 NY. */
  end: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type SetupId =
  | "undercut_rally"
  | "first_higher_low"
  | "wedge_pop"
  | "ema_crossback"
  | "base_n_break"
  | "base_breakout"
  | "episodic_pivot"
  | "earnings_consolidation"
  | "multiweek_base"
  | "ema_reclaim";

export const SETUP_LABEL: Record<SetupId, string> = {
  undercut_rally: "Undercut & Rally",
  first_higher_low: "First Higher Low",
  wedge_pop: "Wedge Pop",
  ema_crossback: "EMA-Crossback",
  base_n_break: "Base’n Break",
  base_breakout: "Base Breakout",
  episodic_pivot: "Episodic Pivot",
  earnings_consolidation: "Konsolidierung nach Quartalszahlen",
  multiweek_base: "Mehrwöchige Basis",
  ema_reclaim: "EMA-Reclaim",
};

/** Setups, die eine Erholung nach Schwäche anzeigen und deshalb vom QQQ-Trendfilter ausgenommen sein dürfen. */
export const RECOVERY_SETUPS: SetupId[] = ["undercut_rally", "first_higher_low", "ema_reclaim"];

export type Timeframe = "1h" | "1d";

/** Ein vorbereitetes Setup: alles ist bekannt außer dem Auslöser. */
export interface Prepared {
  setup: SetupId;
  timeframe: Timeframe;
  /** Ende der letzten abgeschlossenen Kerze, auf der die Vorbereitung beruht. */
  armedAt: number;
  /** Preis, der von einer abgeschlossenen 5-Minuten-Kerze überschritten werden muss. */
  trigger: number;
  /** Geplanter Stopp (Struktur-Invalidierung minus 1 Cent). */
  stop: number;
  /** Kurs, bei dem die Idee vor dem Einstieg verworfen wird (Schluss/Tief darunter). */
  invalidateBelow: number;
  /** Verfall: Anzahl Kerzen des Timeframes nach armedAt. */
  ttlBars: number;
  /** Bedingungen, die bereits erfüllt sind (für die Mail). */
  conditions: string[];
  /** Bedingungen, die die 5-Minuten-Kerze noch bestätigen muss. */
  pending: string[];
  /** Mindest-Stundenvolumen (hochgerechnet) für volumenabhängige Setups. */
  minHourVolume?: number;
  /** EMA-Berührungsmarke (EMA-Crossback). */
  touchLevel?: number;
  /** Ausdrücklich Stundenschluss nötig? Dann kein 5-Minuten-Auslöser. */
  needsHourClose?: boolean;
  /** Beobachtetes Zusatzwissen (z. B. Katalysator). */
  extra?: Record<string, unknown>;
  /** Währung der Marken (Trigger/Stopp). Standard USD; ein Kurs in anderer Währung darf nie verglichen werden. */
  currency?: string;
  /** model = Modellentscheidung des Bots; idea = veröffentlichte Watchlist-Idee (extern, kein Trade). */
  origin?: "model" | "idea";
  source?: string;
  /** Erst der Tagesschluss bestätigt (kein 5-Minuten-Auslöser). */
  needsDayClose?: boolean;
  /** Dieselbe Struktur aktualisiert die bestehende Vorbereitung statt eine neue anzulegen (Level wandern, z. B. EMA). */
  refresh?: boolean;
  /** Worauf sich der Stopp bezieht, z. B. „Tagestief vom 2026-11-24 (Inside Day)“. */
  stopBasis?: string;
  /** Herkunft der Marken: welche abgeschlossenen Kerzen Trigger, Stopp und Struktur erzeugten. */
  evidence?: string[];
  /** Kontextmarken, die ausdrücklich KEIN Trigger sind (z. B. runde Marken). */
  contextLevels?: { level: number; label: string }[];
}

export interface RunningBar {
  /** Beginn der laufenden Stunde (UTC ms) */
  start: number;
  o: number;
  h: number;
  l: number;
  /** Schluss der letzten abgeschlossenen 5-Minuten-Kerze */
  c: number;
  /** kumuliertes Volumen der laufenden Stunde aus abgeschlossenen 5-Minuten-Kerzen */
  v: number;
  /** Minuten seit Stundenbeginn, die durch abgeschlossene Kerzen abgedeckt sind */
  elapsedMin: number;
  /** Ende der letzten abgeschlossenen 5-Minuten-Kerze */
  lastEnd: number;
  /** Länge der Zielkerze in Minuten (60 Stunden-, 390 Tageskerze) für die Volumen-Hochrechnung */
  periodMin?: number;
}
