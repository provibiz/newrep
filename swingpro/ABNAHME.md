# Abnahmeliste (ehrlicher Stand)

Funktionierende Software und statistische Profitabilität sind getrennt zu lesen. **Zur Profitabilität gibt es keine Aussage:** Kein Backtest, keine Statistik. Die Regeln sind Modellannahmen (`REGELN.md`). Historische Revisionen der Datenanbieter machen aktuelle Schnittstellen für ungeprüfte Historienvergleiche ungeeignet.

## A. Lokal getestet (112 Tests, `npm test`, kein Netzwerk, Fixtures/Mocks)
- Alle sieben Setups: positive und negative Fälle (`test/patterns.test.ts`; Episodic Pivot in `test/episodic-universe.test.ts`), Base’n Break vs. Base Breakout unterscheidbar.
- Vorbereitet-vs.-ausgelöst: Auslöser nur aus **abgeschlossenen** 5-Minuten-Kerzen; offene Kerze zählt nicht; Stundenschluss-Setup (Episodic Pivot) löst nicht vor 10:30 aus; Volumen-Hochrechnung nicht vor 15 Min.
- Kein Zukunftswissen: Earnings-Kalenderdatum des Gap-Tages ohne belegte Zeit wird verworfen; Wochentief erst nach zwei abgeschlossenen Folgewochen; S&P-Werte nach dem Bewertungstag werden ignoriert.
- Gesamtweg mit Mock-Anbietern: Tageslauf → Stundenscan/Vorwarnung → 5-Minuten-Auslöser → Kurs-/Stoppprüfung → Mail → Kaufbestätigung per Link → +2R-Empfehlung → Erfassung des Teilverkaufs → Wochentief-Stopp → Kursgap → Ausstieg → Ergebnis.
- Verpasster Einstieg, alter/fehlender Kurs, Mailausfall (verspätete Einstiegsmail wird verworfen), kurzer Ausfall (genau eine Mail), doppelte Cron-Läufe, Neustart (neue Objekte, gleiche DB), Paper-Modus (keine Mail, keine Annahme behauptet), QQQ-Filter-Modi, SIP ohne Rechte (gesperrt, keine Umschaltung), fehlende QQQ-Daten (Lauf scheitert sichtbar).
- Splits (Reihe neu geladen, Position markiert), Symbolwechsel, Feiertage/verkürzte Sitzungen (13:00), Sommerzeit-Abweichungswochen Berlin–New York.
- Link-Sicherheit: GET speichert nichts; POST ohne ausdrückliche Bestätigung → 400; doppeltes Absenden idempotent; Status geschützt.
- Last: 400 Titel im Stundenscan → < 150 D1-Abfragen (D1-Batch = 1 Abfrage), ≤ 10 Datenabrufe; zweiter Lauf inkrementell.
- `wrangler deploy --dry-run` bündelt den Worker fehlerfrei.

- **Abnahmefälle aus dem Report vom 25.11.2026** (`test/siebenhaar-2026-11-25.test.ts`, Kursmarken nur in `test/fixtures/siebenhaar.ts`, nachgebaute Testdaten):
  - *Crocs*: weder Zahlenmeldung noch Gap-Tag noch die Tage danach bereiten den Einstieg vor; Trigger über 160 am Inside Day; Stopp-Bezug (Tagestief des Inside Days vom 24.11.) ausgewiesen und als Modellannahme dokumentiert.
  - *Sartorius*: Trigger über 298 EUR, 300 EUR nur Kontext; „Markt nicht unterstützt“ (Anbieter, Kennung, Handelsplatz, Kalender, Währung); kein US-Ersatzkurs für den EUR-Trigger.
  - *Illumina*: Rücklauf nur Vorbereitung → Seitwärtsphase → Rückeroberung EMA10/EMA20; Stopp unter dem Konsolidierungstief; Seitwärtstage und Bestätigungsart konfigurierbar; EMA-Reclaim ≠ EMA-Crossback.
  - *„Trigger erreicht, Depot bleibt in Cash“*: Betreff „Nur beobachten · …“, Grund in Mail, **kein Kauf-Link, keine Position, kein Token**; keine Wiederholung am selben Tag; nach Änderung der Marktvorgabe kann derselbe Trigger zulässig werden.
  - Drei Entscheidungsstufen getrennt gespeichert und angezeigt; Modell-Kennzeichnung; Watchlist-Idee ≠ Trade; Marktlage (Breite, Führung, FTD, verkürzte Woche) mit Universum, Zeitraum, Quelle und ohne Freigabe-Schwelle.

## B. Mit echten Daten getestet
**Nichts.** Es lagen keine Schlüssel vor. Die Doku-Seiten wurden gelesen (siehe `ZUGAENGE.md`), die FRED-CSV-Form (Kopfzeile `observation_date,SP500`, leere Werte an Feiertagen) wurde laut Recherche bestätigt, aber der Parser lief nicht gegen die echte Datei.

## C. Auf Cloudflare getestet
**Nichts.** Kein Deploy, keine D1-Datenbank, kein Cron-Lauf, keine Resend-Mail.

## D. Offen – genau diese Live-Tests und Zugangsdaten fehlen
| Offen | Benötigt | Risiko, falls abweichend |
|---|---|---|
| Alpaca: Antwortformate von `/v2/stocks/snapshots` (Top-Level-Map oder `snapshots`), `bars` mit 30Min/5Min/1Day, Zeitstempel = Kerzenbeginn (Doku nennt es nicht ausdrücklich), SIP-Tageskerzen im Free-Tarif | Alpaca-Paper-Schlüssel | Parser/Zeitfenster anpassen; die Probe auf der Statusseite deckt Zugriffsfehler auf |
| IEX-5-Minuten-Kerzen bei dünn gehandelten Titeln (Lücken = keine Trades) | Alpaca-Schlüssel, Handelszeit | Auslöser seltener; „Datenlücke“ zählt |
| FMP: `income-statement` (Felder `filingDate`, `epsDiluted`, `period`, `fiscalYear`, `reportedCurrency`) und `earnings-calendar` (Free-Tarif? Felder `epsActual`) | FMP-Schlüssel (Free oder bezahlt) | Wachstum bleibt „offen“, Episodic Pivot bleibt aus – Signale bleiben möglich |
| Resend: Domain-Verifizierung, Idempotency-Key-Verhalten bei Wiederholung | Resend-Schlüssel + Domain | Mails scheitern sichtbar (`failed`/`rejected` auf der Statusseite) |
| Cloudflare: Cron-Taktung bei `1,6,11,…`, CPU-Zeit des Tageslaufs (`limits.cpu_ms: 120000`), erste Befüllung über mehrere Läufe, D1-Batchgrößen | Cloudflare-Konto (Workers Paid) | Erste Nacht(en) beobachten; Läufe sind fortsetzbar und idempotent |
| SIP in Echtzeit (nur mit Algo Trader Plus) | Bezahlter Alpaca-Tarif | Ohne Rechte bleibt der Dienst auf IEX |
| Zustellzeit der Mails im Postfach | – (nicht messbar) | Es wird nur die **Annahme durch Resend** protokolliert |
| Paper-Phase mit echten Daten über mehrere Wochen | alle oben | Erst danach `MODE=live` |

## E. Bekannte Einschränkungen (Design)
- Nur **Long**, nur USD-Handel; EUR nur mit dokumentiertem Wechselkurs.
- Episodic Pivot nur mit **Quartalszahlen**; kein Nachrichten-/Pressemitteilungs-Scan.
- Tageschart-Setups nutzen größere Spannen, die ungeprüfte Modellannahmen sind.
- Die drei Fälle aus dem Report sind **nachgebaute Formationen**, keine Original-Kursdaten. Mit echten Kursverläufen von Crocs, Sartorius und Illumina wurde nicht getestet; offen bleibt, ob die Modellannahmen (Mindesttage, Spannen, EMA-Regeln) die echten Charts erfassen.
- Die Marktbreite des Systems ist nicht identisch mit der Statistik der Quelle (andere Universum-Abgrenzung); die Zahlen 123/465 sind nur Testdaten.
- Sartorius und andere Xetra-Titel bleiben „Markt nicht unterstützt“, bis ein Datenanbieter, ein Xetra-Handelskalender und EUR-Handelsrechnung angebunden sind.
- Ein generisches Tages-Base’n-Break kann in den Tagen direkt nach einer Kurslücke vor dem Inside-Day-Einstieg vorbereitet werden (anderes Setup, eigene Meldung).
- Außerplanmäßige Börsenschließungen erkennt nur der `/v2/clock`-Abgleich im Live-Betrieb.
- Die Beschränkung auf 400 überwachte Titel (`MAX_WATCH`) ist eine Subrequest-Entscheidung, keine Marktaussage.
