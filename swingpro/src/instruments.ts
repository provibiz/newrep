/**
 * Datenabdeckung je Instrument. Ein Instrument gilt nur als unterstützt, wenn Datenanbieter, Wertpapierkennung,
 * Handelsplatz, Handelskalender UND Währung alle abgedeckt sind. Sonst: „Markt nicht unterstützt“ – ohne Ersatzkurs
 * (insbesondere kein US-Kurs für einen EUR-Trigger).
 */
export interface Instrument { symbol: string; name?: string; isin?: string; venue: string; currency: string }

/** Was die eingebauten Anbieter und Module tatsächlich können (Stand dieser Version). */
export const CAPABILITIES = {
  provider: { id: "Alpaca (IEX/SIP)", venues: ["XNAS", "XNYS"], currencies: ["USD"] },
  /** Handelskalender, die implementiert sind (src/calendar.ts bildet nur die NYSE-Sitzungen ab). */
  calendars: { XNAS: "NYSE", XNYS: "NYSE" } as Record<string, string>,
  /** Handelswährungen, in denen Stückzahl, Risiko und Kapital gerechnet werden. */
  tradeCurrencies: ["USD"],
};
export const VENUE_LABEL: Record<string, string> = { XNAS: "Nasdaq", XNYS: "NYSE", XETR: "Xetra (Deutsche Börse)" };

export const venueOfAlpaca = (exchange: string): string => (exchange === "NASDAQ" ? "XNAS" : exchange === "NYSE" ? "XNYS" : exchange);

/** ISIN-Prüfsumme (Luhn über die in Ziffern umgesetzten Buchstaben). */
export function isValidIsin(isin: string | undefined): boolean {
  if (!isin || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  const digits = [...isin].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join("");
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) { let d = +digits[i]; if (dbl) { d *= 2; if (d > 9) d -= 9; } sum += d; dbl = !dbl; }
  return sum % 10 === 0;
}

export interface SupportCheck { name: string; ok: boolean; detail: string }
export interface Support { supported: boolean; label: "Markt unterstützt" | "Markt nicht unterstützt"; checks: SupportCheck[]; summary: string }

export function checkSupport(inst: Instrument): Support {
  const v = inst.venue, venueName = VENUE_LABEL[v] ?? v;
  const us = ["XNAS", "XNYS"].includes(v);
  const checks: SupportCheck[] = [
    { name: "Datenanbieter", ok: CAPABILITIES.provider.venues.includes(v), detail: CAPABILITIES.provider.venues.includes(v) ? `${CAPABILITIES.provider.id} liefert ${venueName}` : `${CAPABILITIES.provider.id} deckt nur ${CAPABILITIES.provider.venues.map((x) => VENUE_LABEL[x]).join("/")} ab, nicht ${venueName}` },
    { name: "Wertpapierkennung", ok: us && /^[A-Z]{1,5}(\.[AB])?$/.test(inst.symbol), detail: us ? `US-Ticker ${inst.symbol}` : isValidIsin(inst.isin) ? `ISIN ${inst.isin} ist gültig, aber der Anbieter kennt keine Zuordnung zu ${venueName}` : "keine gültige ISIN hinterlegt" },
    { name: "Handelsplatz", ok: us, detail: us ? venueName : `${venueName} ist nicht als Handelsplatz angebunden` },
    { name: "Handelskalender", ok: !!CAPABILITIES.calendars[v], detail: CAPABILITIES.calendars[v] ? `Kalender ${CAPABILITIES.calendars[v]}` : `kein Handelskalender für ${venueName} implementiert (Feiertage/Handelszeiten unbekannt)` },
    { name: "Währung", ok: CAPABILITIES.tradeCurrencies.includes(inst.currency) && CAPABILITIES.provider.currencies.includes(inst.currency), detail: CAPABILITIES.tradeCurrencies.includes(inst.currency) ? inst.currency : `Kurse, Stückzahl und Risiko werden nur in ${CAPABILITIES.tradeCurrencies.join("/")} gerechnet, das Instrument notiert in ${inst.currency}` },
  ];
  const ok = checks.every((c) => c.ok);
  return {
    supported: ok, label: ok ? "Markt unterstützt" : "Markt nicht unterstützt", checks,
    summary: ok ? "alle fünf Prüfungen bestanden" : "nicht abgedeckt: " + checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join("; "),
  };
}
