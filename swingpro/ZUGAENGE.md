# Zugänge, Datenrechte, voraussichtliche Kosten

Stand der Recherche: **25.11.2026** (Dokumentationsseiten laut Abruf). Wo Seiten nicht lesbar waren, steht „nicht verifiziert“. Preise ändern sich – vor Abschluss prüfen. Es wurden keine Abos abgeschlossen und keine Ressourcen angelegt.

## Kurzübersicht

| Bereich | Anbieter | Erforderlicher Zugang | Belegter Funktionsstand | Kosten |
|---|---|---|---|---|
| Laufzeit | Cloudflare Workers Paid + D1 | Konto, Paid-Tarif | Worker bündelt fehlerfrei (`wrangler deploy --dry-run`); **nicht deployt/getestet auf Cloudflare** | ab 5 USD/Monat |
| Kursdaten USA | Alpaca Market Data Basic | API-Schlüssel (Paper-Konto) | Doku gelesen: IEX Echtzeit, SIP historisch (nur nicht die letzten 15 Min), 200 Aufrufe/Min; Adapter nur mit Mocks getestet, **nicht live** | 0 USD (SIP Echtzeit: Algo Trader Plus 99 USD/Monat) |
| Kursdaten Xetra (EUR) | Twelve Data (Standard-Adapter) | API-Schlüssel, Tarif mit Xetra-Intraday | Adapter nur mit Mocks getestet; **Xetra-5-Minuten-Kerzen und Echtzeit je Tarif nicht verifiziert** | Grow 29 USD/Monat („EOD global equities“), Pro 99 USD/Monat („Real-time EU market data“) |
| Fundamentaldaten | Financial Modeling Prep | API-Schlüssel | Free laut Suche 250 Aufrufe/Tag, 5 Quartale; FMP-Seiten für den Abruf gesperrt → **Earnings-Kalender/Felder nicht verifiziert**; nur US, Xetra „offen“ | Free 0 USD, bezahlte Preise nicht verifiziert |
| S&P-500-Kontext | FRED | keiner (CSV) | CSV-Form laut Abruf bestätigt; Parser nur mit Mock getestet; Schluss erst am US-Folgetag; Reihe urheberrechtlich geschützt (privat, kein Caching) | 0 USD |
| Indexlisten | iShares-Holdings-CSV (S&P 500) | keiner | URL laut Abruf HTTP 200 (keine ISIN-Spalte); **übrige Indizes: keine geprüfte freie Quelle** → per `INDEX_SOURCES` konfigurieren, sonst „Quelle fehlt“ | 0 USD |
| Mailversand | Gmail API (`gmail.send`) | eigenes Google-Cloud-Projekt, OAuth-Client „Desktop“, Refresh-Token | Sender, MIME, Token-Erneuerung, Widerruf, Doppelversandschutz mit Mocks getestet; **kein echter Versand** | 0 USD (privates Konto; Gmail-Hilfe nennt Grenzen um 500 Mails/Tag) |

**Voraussichtlich:** 5 USD/Monat (Cloudflare) für die USA mit IEX. Mit Xetra-Echtzeit zusätzlich ca. 99 USD/Monat (Twelve Data Pro, **vor dem Buchen testen**). SIP-Echtzeit für die USA +99 USD. FMP-Aufpreis unbekannt.

## Details und Quellen

### Cloudflare
Workers Free: Cron nur **10 ms CPU** und 50 Subrequests → für dieses Projekt nicht ausreichend. Workers Paid: Cron bis 30 s CPU (Standard), bis 5 Minuten (Maximum, Intervalle < 1 h; im Projekt `limits.cpu_ms=120000`), 10 000 Subrequests; D1-Abfragen zählen als Subrequests, ein `db.batch()` zählt als eine. Quellen: [Limits](https://developers.cloudflare.com/workers/platform/limits/), [Preise](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/).

### Alpaca (USA)
[Market Data API](https://docs.alpaca.markets/docs/about-market-data-api): Basic = IEX Echtzeit, Historie ab 2016 mit der Einschränkung „latest 15 minutes“, 200 Aufrufe/Min; Algo Trader Plus 99 USD/Monat mit SIP in Echtzeit. Bei `DATA_FEED=sip` ohne Rechte sperrt der Dienst (keine stille Umschaltung). Tageskerzen (Vorauswahl, Dollarumsatz) kommen aus der SIP-Historie (`DAILY_FEED=sip`), da IEX-Volumen nur einen Handelsplatz abbildet.

### Xetra / Deutschland
- **Handelskalender und -zeiten** (Deutsche Börse, [Handelskalender](https://www.cashmarket.deutsche-boerse.com/cash-de/Handel/handelskalender-und-zeiten), gelesen 25.11.2026): Mo–Fr 9:00–17:30 Uhr MEZ; handelsfrei u. a. Neujahr, Karfreitag, Ostermontag, 1. Mai, 24./25./26./31. Dezember. Himmelfahrt, Pfingstmontag, Fronleichnam 2026 sind Handelstage. Der **30.12.2026** ist verkürzt (Zeiten nicht gelesen) → im Projekt als verkürzt markiert, keine neuen Einstiege. Die Kalender-PDFs wurden nicht gelesen.
- **Kursdaten:** Twelve Data nennt Xetra (XETR) auf der Börsenliste (Mindest-Tarif Grow), „Real-time EU market data“ erst ab Pro; Verzögerung und 5-Minuten-Abdeckung für XETR **nicht belegt**. ISIN in der Instrumentenliste nur mit Add-on (laut Preisseite ab 24 000 USD/Jahr). EODHD: Intraday 5m für „Other Exchanges“ laut Doku ab Oktober 2020, aber „delayed and finalized about 2–3 hours after the market close“ und Xetra-Code nicht belegt → für den Vormittagsscan voraussichtlich ungeeignet. Finnhub, Databento: Seiten nicht lesbar; Alpha Vantage, Marketstack: Xetra-Abdeckung nicht belegt. Quellen: [Twelve Data Pricing](https://twelvedata.com/pricing), [Exchanges](https://twelvedata.com/exchanges?level=pro), [EODHD Intraday](https://eodhd.com/financial-apis/intraday-historical-data-api).
- **Instrumentenliste mit ISIN (Alternative, nicht angebunden):** Deutsche Börse stellt „T7 (Xetra) Alle handelbaren Instrumente“ (CSV `t7-xetr-allTradableInstruments.csv`) auf der [Downloadseite](https://www.cashmarket.deutsche-boerse.com/cash-de/Handel/Handelbare-Werte-Xetra/Downloads) bereit; Felder und Nutzungsbedingungen nicht gelesen.
- Ohne Zugang zeigt die Statusseite die genaue Lücke; Xetra-Titel bleiben „Markt nicht unterstützt“. Ein US-Kurs ist nie Ersatz.

### Indexabdeckung
- **S&P 500:** iShares Core S&P 500 ETF (IVV), `…/latest-holdings.csv` (HTTP 200, Stichtag 23.11.2026, Spalten Ticker, Name, Asset Class, Exchange, Currency; keine ISIN; Lizenzklausel für die Datei nicht gefunden).
- **S&P MidCap 400, S&P SmallCap 600, Nasdaq-100, DAX, MDAX, SDAX, TecDAX:** **keine geprüfte freie Quelle.** STOXX nennt für DAX 40 Werte (ISIN DE0008469008) und „slpublic“-Auswahllisten als frei zugänglich (Dateien/Formate nicht gelesen); die Deutsche-Börse-Seite „DAX-Aktien“ listet 40 Werte ohne Stichtag. Wikipedia-Listen (DAX, Stand der Gewichte 22.09.2025 – veraltet) sind kein verlässlicher Tagesbestand. FMP-Indexendpunkte: Seite gesperrt, nicht verifiziert. → je Index eine CSV-URL in `INDEX_SOURCES` eintragen (z. B. iShares-ETF-Holdings der jeweiligen Fonds, **Lizenz selbst prüfen**); bis dahin steht „Quelle fehlt (Abdeckung nicht prüfbar)“ auf der Statusseite, **nicht** „0 Mitglieder“.

### FMP (US-Fundamentaldaten)
Quartalsdaten (Umsatz, verwässertes EPS) und Earnings je Titel. Nur für US-Titel; für Xetra-Titel bleibt das Wachstumsurteil „offen“ und unterdrückt kein Setup. FMP-Seiten waren für den Abruf gesperrt (HTTP 403): Tarif, Endpunkte und Lizenz bitte selbst prüfen.

### FRED
S&P 500 (`SP500`): CSV ohne Schlüssel, ca. 10 Jahre Historie, Schluss erscheint am Folgetag (Seite: Update 11:05 CST). Reihe ist als „Copyrighted: Pre-Approval Required“ markiert; nach den FRED-Bedingungen nur persönliche, nicht-kommerzielle Nutzung, kein Speichern/Cachen der Inhalte → es wird nur das abgeleitete Ergebnis gespeichert. [FRED](https://fred.stlouisfed.org/series/SP500), [Bedingungen](https://fred.stlouisfed.org/legal/).

### Gmail
[Scopes](https://developers.google.com/gmail/api/auth/scopes): `gmail.send` ist „sensitive“. [users.messages.send](https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send): `POST …/users/me/messages/send`, Body `raw` = base64url-RFC-2822, Antwort mit `id`. [OAuth](https://developers.google.com/identity/protocols/oauth2): Refresh-Token im Status „Testing“ läuft nach **7 Tagen** ab; ungültig u. a. nach Widerruf, **sechs Monaten ohne Nutzung** und Passwortänderung bei Gmail-Scopes; Token-Endpunkt `https://oauth2.googleapis.com/token`, Fehler `invalid_grant`. Nicht verifiziert: Warnseite/Nutzerlimit nicht verifizierter Apps, Größenlimit von `raw`, feste 3600 s Access-Token-Dauer (Google nennt `expires_in`). [Sendelimits](https://support.google.com/mail/answer/22839): „more than 500 emails sent in a day“.
