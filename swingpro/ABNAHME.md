# Abnahmeliste (ehrlicher Stand)

Funktionierende Software und statistische Profitabilität sind getrennt zu lesen. **Zur Profitabilität gibt es keine Aussage:** kein Backtest, keine Statistik. Die Regeln sind Modellannahmen (`REGELN.md`).

## A. Lokal getestet (166 Tests, `npm test`, kein Netzwerk, Mocks und nachgebaute Testdaten)
- **Setups:** alle sieben Siebenhaar-Muster (positiv/negativ), Base’n Break ≠ Base Breakout, drei Tages-Pfade (Konsolidierung nach Quartalszahlen, mehrwöchige Basis, EMA-Reclaim ≠ EMA-Crossback; Rücktest = Vorwarnung, Einstieg gesperrt bis zur Stabilisierung), Vorbereitet → Trigger (abgeschlossene 5-Minuten-Kerze; Stunden-/Tagesschluss-Setups nicht früher) → Zulässigkeit.
- **Kein Zukunftswissen:** Katalysator nur mit belegter Veröffentlichungszeit, Wochentief erst nach zwei abgeschlossenen Folgewochen, Blindlauf-Anbieter gibt nichts nach dem Stichtag preis.
- **Cash → offen:** Trigger in „cash“ → „Nur beobachten“; danach „offen“: Kurs weggelaufen → „Einstieg verpasst“ (eine Mail), sonst **genau eine** Einstiegsmail; Setup inzwischen ungültig → keine Mail. Gesperrte/verpasste Signale enthalten keinen Kauf-Link und legen keine Position an.
- **Marktvorgabe:** automatisch (Breite, Anteil über SMA50, Wachstumsführung, S&P vs. SMA200; FTD gibt nie frei), veraltete Daten → Cash, Schwellen konfigurierbar, manuelle Vorgabe nur mit Begründung + Ablauf, Rückfall nach Ablauf; Integrationstest bärisch → „Nur beobachten“ mit automatischen Gründen → später zulässig ohne Formular.
- **Stoppweite:** Standard 10 %: synthetischer Illumina-Fall (Stopp > 10 %) → „Nur beobachten · Risikoregel Stopp …“, einmal je Setup, kein Link. Verlorener Swing wird nicht umgedeutet, Stopp nicht gesenkt.
- **Gmail:** Token-Erneuerung, RFC-2822/UTF-8-Betreff, nur `gmail.send` (zu weiter Scope wird abgelehnt), `invalid_grant` → Warteschlange + Statusmeldung, abgelaufene Einstiegsmails verworfen, atomares Beanspruchen gegen Doppelversand, unklarer Ausgang → keine Wiederholung, Kopfzeilen-Injektion verhindert, keine Secrets in Fehlertexten.
- **Märkte:** Xetra-Kalender (Feiertage 2026/27, 30.12. verkürzt, Sommer-/Winterzeit), Aktiengattung/ISIN/Währung, ETF-/Fremdwährungs-/Duplikat-Ausschluss, Indexabdeckung je Index (inkl. „Quelle fehlt“, nicht zuordenbar, außerhalb der Indizes), Mehrfachmitgliedschaft → ein Alarm, deutscher Vormittagsscan (US idle, Xetra löst auf EUR-Kurs aus), USD-Kurs für EUR-Trigger abgelehnt, fehlender Zugang → genaue Lücke + Tarif, FX-Pflicht, Xetra-Berechtigungsprobe.
- **Eigenständigkeit:** Blindlauf mit nachgebauten Daten (Crocs/Illumina/Sartorius-Formen werden ohne Suchziel gefunden; Auswertung erst danach), **Gegenproben** (gleiche Formation anderer Ticker/Kursniveau erkannt; Ticker ohne Formation und Ticker mit zu kurzer Konsolidierung → kein Alarm), Quellcode enthält keine Ticker/Kursmarken der Beispiele.
- **Paper-Protokoll:** getrennte Zeitstempel, Kandidaten/Marken vor dem Trigger gespeichert, `candidate_log` per Trigger unveränderlich, Statusseite zeigt „Annahme ≠ Eingang“.
- Last: 400 Titel im Stundenscan < 150 D1-Abfragen; `wrangler deploy --dry-run` bündelt fehlerfrei.

## B. Mit echten Daten getestet
**Nichts.** Es lagen keine Schlüssel/Zugänge vor. Der **historische Blindlauf mit Echtdaten wurde nicht ausgeführt** (Blocker: Alpaca-Schlüssel; für Deutschland zusätzlich Xetra-Zugang). Das Werkzeug existiert (`scripts/blindrun.ts --live`); es nutzt das **heutige** Instrumentenverzeichnis und weist deshalb ausdrücklich **keinen** historischen Echtdaten-Nachweis aus. Für Crocs, Illumina und Sartorius gibt es **keinen** Echtdaten-Nachweis; die Fixtures sind nachgebaute Formen.

## C. Auf Cloudflare getestet
**Nichts.** Kein Deploy, keine D1-Datenbank, kein Cron-Lauf, keine Gmail-Mail.

## D. Offen – Live-Prüfungen
| Offen | Benötigt | Risiko, falls abweichend |
|---|---|---|
| Gmail: OAuth-Einrichtung, „In production“-Verhalten unverifizierter App, echter Versand, Eingang auf dem Handy | Google-Cloud-Projekt, OAuth-Client, Freigabe durch dich | Mails bleiben in der Warteschlange; Statusseite zeigt Problem |
| Alpaca: Formate von `bars`/`snapshots`, Kerzenzeit = Beginn, SIP-Tageskerzen im Free-Tarif | Alpaca-Paper-Schlüssel | Parser/Zeitfenster anpassen; Probe zeigt Zugriffsfehler |
| Xetra: Twelve-Data-Endpunkte/Felder, 5-Minuten-Kerzen und Echtzeit für XETR im gebuchten Tarif, Rate-Limits (Grow: 55 Credits/Min), ISIN-Verfügbarkeit | Twelve-Data-Schlüssel mit passendem Tarif (voraussichtlich Pro) | Deutscher Scan bleibt aus bzw. verzögert; Berechtigungsprobe zeigt es |
| Xetra-Kalender gegen den offiziellen PDF-Kalender, Zeiten des 30.12. | – | falsche Handelstage |
| Indexlisten für S&P 400/600, Nasdaq-100, DAX/MDAX/SDAX/TecDAX (Quelle, Lizenz, Format) | je Index eine CSV-Quelle in `INDEX_SOURCES` | Abdeckung „Quelle fehlt“ |
| FMP: Felder `income-statement`/`earnings`, Free-Tarif, Xetra-Abdeckung | FMP-Schlüssel | Wachstum „offen“, Konsolidierung nach Zahlen ohne Katalysator-Daten aus |
| Historischer Blindlauf mit Echtdaten (heutiges Verzeichnis, daher kein Nachweis) und mit zeitpunktgenauem Universum (archivierter Bestand nötig) | Alpaca-Schlüssel, Archivdaten | – |
| Cloudflare: Cron-Takt `7–21 UTC`, CPU-Zeit, erste Befüllung über mehrere Läufe (je Markt), D1-Batchgrößen | Cloudflare Workers Paid | erste Nächte beobachten; Läufe sind fortsetzbar und idempotent |
| Vorwärts-Paper-Betrieb über mehrere Wochen | alle oben | erst danach `MODE=live` |

## E. Bekannte Einschränkungen
- Nur **Long**. Handelswährungen USD und EUR; Umrechnung nur mit dokumentiertem Kurs.
- Xetra: nur Tages-Setups (5-Minuten-Trigger), kein Stunden-Scan, kein Episodic Pivot, kein Wachstumsurteil (FMP-Abdeckung nicht verifiziert), kein Führungsgruppen-/Index-Erholungsversuch (keine Daten angebunden).
- Die Beispiele aus dem Report sind **nachgebaute Formen**; ob die Modellannahmen (Mindesttage, Spannen, EMA-Regeln) die echten Charts erfassen, ist offen.
- Marktbreite des Systems ≠ Statistik der Quelle (anderes Universum); 123/465 sind nur Testdaten.
- Ein generisches Tages-Base’n-Break kann nach einer Kurslücke vor dem Inside-Day-Einstieg ein eigenes Setup vorbereiten (eigene Meldung).
- Die Schwellen der automatischen Marktvorgabe sind ungeprüfte Modellannahmen; fehlende Daten zählen vorsichtig als bärisch/Cash.
- Außerplanmäßige Börsenschließungen erkennt nur der US-`/v2/clock`-Abgleich; Xetra hat keinen.
