# Zugänge, Datenrechte, voraussichtliche Kosten

Stand der Recherche: **24.11.2026** (Dokumentationsseiten laut Abruf; wo Seiten nicht lesbar waren, steht „nicht verifiziert“). Preise ändern sich – vor Abschluss auf der Anbieterseite prüfen. Es wurden keine Abos abgeschlossen und keine Ressourcen angelegt.

| Zugang | Wofür | Was kostenlos geht | Wofür bezahlter Tarif nötig | Monatliche Kosten (Stand) | Quelle |
|---|---|---|---|---|---|
| **Cloudflare Workers Paid** | Worker, Cron, D1 | Free: Cron-Läufe nur **10 ms CPU** je Aufruf, 50 Subrequests → für dieses Projekt **nicht ausreichend** | Workers Paid: Cron bis 30 s CPU (Standard) / 5 min (Maximum, Intervalle < 1 h), 10 000 Subrequests; D1 inklusive (25 Mrd. Zeilen gelesen, 50 Mio. geschrieben, 5 GB) | **mind. 5 USD** | [Limits](https://developers.cloudflare.com/workers/platform/limits/), [Preise](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/) |
| **Alpaca Market Data – Basic** | Aktien-, Index-ETF-Kerzen, Quotes, Assets, Kalender (Uhr) | Echtzeit **IEX** (ein Handelsplatz); historische Daten ab 2016 mit der Einschränkung „latest 15 minutes“ (also auch SIP-Historie, nur nicht die letzten 15 Min); **200 Aufrufe/Min** | Echtzeit-**SIP** (alle US-Börsen) | Free: 0 USD | [Market Data API](https://docs.alpaca.markets/docs/about-market-data-api) |
| Alpaca **Algo Trader Plus** | SIP in Echtzeit (`DATA_FEED=sip`) | – | ja | **99 USD** | gleiche Seite |
| **Financial Modeling Prep** | Quartalsdaten (Wachstum), Earnings-Kalender (Episodic Pivot) | Suchtreffer nennen für Free **250 Aufrufe/Tag** und 5 Quartale Statements; **Earnings-Kalender im Free-Tarif nicht bestätigt** | unklar | Free: 0 USD; bezahlte Preise **nicht verifiziert** (FMP-Seiten waren für den Abruf gesperrt) | [FMP-Hilfeseiten laut Suche](https://site.financialmodelingprep.com/faqs) – bitte selbst prüfen |
| **FRED** (S&P 500 `SP500`) | Marktkontext | CSV-Download ohne Schlüssel; ~10 Jahre Historie; Schluss erscheint am Folgetag | – | 0 USD | [FRED SP500](https://fred.stlouisfed.org/series/SP500) |
| **Resend** | Mailversand | Free: 3 000 Mails/Monat, 100/Tag, 3 Domains; Idempotency-Key 24 h | Pro 20 USD (50 000/Monat) | 0 USD (Free reicht) | [Pricing](https://resend.com/pricing), [API](https://resend.com/docs/api-reference/emails/send-email) |
| Eigene **Domain** | Resend-Absender (ohne eigene Domain nur Versand an die Resend-Kontoadresse) | – | – | je nach Domain (hast du ggf. schon) | [Resend: 403 mit resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain.md) |

**Voraussichtlich:** 5 USD/Monat (Cloudflare) bei IEX + Resend Free + FMP Free. Mit SIP-Echtzeit zusätzlich 99 USD. FMP-Aufpreis unbekannt.

## Datenrechte und Hinweise
- **IEX** bildet nur einen Handelsplatz ab. Kurse sind Echtzeit, **Volumen** ist deutlich kleiner als das Gesamtvolumen (die Dollarumsatz-Vorauswahl nutzt deshalb SIP-Tageskerzen, `DAILY_FEED=sip`; Ratio-Regeln wie „1,2 × Basisvolumen“ bleiben vergleichbar).
- **SIP in Echtzeit** braucht den bezahlten Tarif. Bei `DATA_FEED=sip` ohne Rechte sperrt der Dienst die Scans und meldet das auf der Statusseite – er schaltet **nicht** auf IEX um.
- **FRED/S&P:** Die Reihe ist urheberrechtlich geschützt; nach den FRED-Bedingungen nur persönliche, nicht-kommerzielle Nutzung, kein Speichern/Cachen der Inhalte. Dieses Projekt speichert nur das abgeleitete Ergebnis (Datum, Schluss, SMA). Für gewerbliche Nutzung wäre eine Lizenz von S&P Dow Jones Indices nötig. ([FRED-Bedingungen](https://fred.stlouisfed.org/legal/))
- **FMP-Daten** ggf. mit eigener Lizenz für private Nutzung; Bedingungen vor Live-Betrieb prüfen (nicht verifiziert).
- **Alpaca-Konto:** Der Schlüssel eines Paper-Kontos genügt; es wird nie gehandelt.
