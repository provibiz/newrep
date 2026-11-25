# Beispiel-Mails aus dem Replay (TESTDATEN, erfundene Kurse)

Erzeugt mit `npm run replay -- --write docs/BEISPIELMAILS.md`. Adressen und Links sind Platzhalter; Tokens sind nur im Replay gültig.
[TESTDATEN] normal: ok: Tageslauf abgeschlossen
[TESTDATEN] Stundenscan: ok: 1 geprüft, 0 Lücken, 1 neu vorbereitet
[TESTDATEN] 5-Minuten-Überwachung: ok: 3 Kandidaten, 1 ausgelöst, 1 bestätigt, 0 verpasst

### Vorwarnung

**Betreff:** Vorwarnung · DEMO · Base Breakout

```
Stufe 1 von 3 – Setup vorbereitet (noch KEIN Trigger, KEIN Einstieg) · Stand 24.11.2026 16:36 Uhr MEZ
Feed IEX (Echtzeit, nur ein Handelsplatz; Volumen unterschätzt das Gesamtvolumen)

DEMO: Warum auf der Kandidatenliste: Rang 1 von 1 im Markt – Relative Stärke: 63-Tage-Rendite 22.5 % = Perzentil 100 im Markt USA (Nasdaq/NYSE); Liquidität: Ø-Umsatz 20 Tage 196.4 Mio USD; Handelsspanne: Ø-Tagesspanne 3.0 %; Kurs 101.00 USD; außerhalb der kontrollierten Indizes (trotzdem gescannt)
DEMO · Base Breakout (Stundenchart) · Markt: USA (Nasdaq/NYSE, USD)
  Auslösemarke: 5-Minuten-Schluss über 102.20
  Geplanter Stopp: 100.89 USD (Idee widerlegt bei Schluss/Tief unter 100.90)
  Kontext: 105.00 USD (runde Marke – nur Kontext, ersetzt die aus dem Chart abgeleitete Marke nicht)
  Verfall: 24.11.2026 20:30 Uhr MEZ
  Herkunft der Marken: Struktur beruht auf abgeschlossenen Stundenkerzen bis 24.11.2026 16:30 Uhr MEZ (Schluss 101.70) | Auslösemarke 102.20 = Hoch der abgeschlossenen Kerze vom 24.11.2026 16:30 Uhr MEZ | Stopp 100.89 = Tief 100.90 der abgeschlossenen Kerze vom 24.11.2026 16:30 Uhr MEZ minus 1 Cent; die Idee ist widerlegt bei Schluss/Tief darunter
  Bereits erfüllt: Basis über 8 Kerzen mit 1.29 % Spanne (max. 3 %); Vorheriger Anstieg: Basisbeginn 101.50 über dem Schluss 10 Kerzen zuvor (97.05), ohne kurzen Schub
  Noch offen: 5-Minuten-Schluss über dem Basishoch 102.20 bei Volumen ≥ 1.2× Basisschnitt (Hochrechnung)

Du erhältst eine Einstiegsmail nur, wenn der Auslöser bestätigt, die Markt- und Risikoregeln den Einstieg zulassen und der Kurs frisch geprüft ist; sonst „Nur beobachten“. Vorwarnungen lassen sich mit MAIL_PREWARN=false abschalten.

Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.
```

### Einstieg bestätigt

**Betreff:** Einstieg bestätigt · DEMO · Base Breakout

```
Signal: 24.11.2026 17:05 Uhr MEZ (11:05 New York) · Modellentscheidung
Auslöser: 102.20 · Kurs 102.40 USD, Zeitstempel 24.11.2026 17:05:55 Uhr MEZ, geprüft 17:06:00 (Alter 5 s)
Stopp: 100.89 USD · Abstand 1.51 USD je Aktie (1R)
Stückzahl: 24 (Einsatz 2457.60 USD) · geplantes Risiko 36.24 USD = 0.36 % des Depots
Markt: USA (Nasdaq/NYSE, USD) · Daten: Alpaca IEX (Echtzeit, ein Handelsplatz) · Limit-Orders bleiben bei dir; Kurs vor Order erneut prüfen.

Warum interessant: Base Breakout
Warum auf der Kandidatenliste: Rang 1 von 1 im Markt – Relative Stärke: 63-Tage-Rendite 22.5 % = Perzentil 100 im Markt USA (Nasdaq/NYSE); Liquidität: Ø-Umsatz 20 Tage 196.4 Mio USD; Handelsspanne: Ø-Tagesspanne 3.0 %; Kurs 101.00 USD; außerhalb der kontrollierten Indizes (trotzdem gescannt)
• Base Breakout – erfüllt: Basis über 8 Kerzen mit 1.29 % Spanne (max. 3 %); Vorheriger Anstieg: Basisbeginn 101.50 über dem Schluss 10 Kerzen zuvor (97.05), ohne kurzen Schub
  Herkunft der Marken: Struktur beruht auf abgeschlossenen Stundenkerzen bis 24.11.2026 16:30 Uhr MEZ (Schluss 101.70) | Auslösemarke 102.20 = Hoch der abgeschlossenen Kerze vom 24.11.2026 16:30 Uhr MEZ | Stopp 100.89 = Tief 100.90 der abgeschlossenen Kerze vom 24.11.2026 16:30 Uhr MEZ minus 1 Cent; die Idee ist widerlegt bei Schluss/Tief darunter
  Kontext (kein Trigger): 105.00 USD (runde Marke – nur Kontext, ersetzt die aus dem Chart abgeleitete Marke nicht)
• Bestätigung heute: abgeschlossene 5-Minuten-Kerze schloss bei 102.35 über dem Auslöser 102.20 | Volumentempo 1560/h ≥ 1200 (hochgerechnet aus 35 Min)

Ist der Einstieg noch sinnvoll? Der Kurs liegt 0.15 R über dem Auslöser (Grenze 0.25 R). Widerlegt ist die Idee unter 100.89.

Entscheidungsstufen (getrennt):
  1. Setup vorbereitet: 24.11.2026 16:36 Uhr MEZ – ja
  2. Technischer Trigger erreicht: 24.11.2026 17:05 Uhr MEZ – ja
  3. Einstieg nach Markt- und Risikoregeln zulässig: JA – Marktvorgabe: offen (normale Regeln) (aus der Konfiguration)

Marktkontext
Marktbreite: nicht bewertet (zu wenig Daten)
Führungsgruppen: nicht bewertet (Daten fehlen)
Handelswoche: Do 26.11. geschlossen (Thanksgiving); Fr 27.11. verkürzt (Schluss 13:00 New York) – Signale und Volumen sind weniger aussagekräftig
S&P 500 · Daten fehlen (weniger als 200 Schlusskurse); letzter abgeschlossener Handelstag wäre 2026-11-23
QQQ-Filter (sperrt Trend-Setups, Erholungs-Setups (Undercut & Rally, First Higher Low) bleiben erlaubt): Stundenschluss 439.43 über SMA20 434.00 → blockiert nichts
Wachstum (Giering-Modell): offen · FMP_API_KEY nicht gesetzt – keine Quartalsdaten

Regelstatus:
  Sperren: keine – alle sperrenden Regeln (Marktvorgabe, QQQ-Filter, Stoppweite, Kapital/Risiko, Kursprüfung) lassen den Einstieg zu
  Nur Kontext (sperrt nicht): Baron: S&P 500 · Daten fehlen (weniger als 200 Schlusskurse); letzter abgeschlossener Handelstag wäre 2026-11-23 | Giering: Wachstum (Giering-Modell): offen · FMP_API_KEY nicht gesetzt – keine Quartalsdaten | QQQ-Marktfilter: QQQ-Filter (sperrt Trend-Setups, Erholungs-Setups (Undercut & Rally, First Higher Low) bleiben erlaubt): Stundenschluss 439.43 über SMA20 434.00 → blockiert nichts | Kontextmarke 105.00 USD – runde Marke – nur Kontext, ersetzt die aus dem Chart abgeleitete Marke nicht
  Fehlende Daten: S&P-500-Daten (FRED) | Wachstumsdaten (FMP_API_KEY nicht gesetzt – keine Quartalsdaten) | Führungsgruppen (nur Information)

Größenberechnung: begrenzt durch gewicht; Risikobudget 50.00 USD, verfügbar 10000.00 USD, offenes Risiko vorher 0.00 USD.
Depot- und Handelswährung: USD.

Gekauft? Kaufkurs und Stückzahl bestätigen (Link öffnet nur ein Formular, nichts wird gespeichert):
https://x.example/a/nUE8D_uN3dJjKDnWzoYEFsjoeA4-ZyX0
Nicht gekauft? Dort „ausgelassen“ wählen.

Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.
```

### Teilgewinn (+2R erreicht)

**Betreff:** Teilgewinn +2R · DEMO

```
Stand 24.11.2026 17:56 Uhr MEZ
Kurs 105.87 USD hat 2R erreicht (Einstieg 102.45, 1R = 1.56 USD, Marke 105.57).
Empfehlung: ca. 50 % = 9 Stück verkaufen (Teststrategie). Das ist eine GEMELDETE Empfehlung – erst deine Erfassung der tatsächlichen Ausführung zählt.

Danach wird die Restposition per bestätigten höheren Wochentiefs nachgezogen (Stopp steigt nur).

Ausführung erfassen (Teilverkauf, Ausstieg): https://x.example/a/Ac4hXpAcesKOas4jb3v9oezOkhj46Y4y
```

### Ausstieg (Kurslücke unter dem Stopp)

**Betreff:** Ausstieg · Kurslücke unter Stopp · DEMO

```
Stand 30.11.2026 16:00 Uhr MEZ
Stopp 100.89 USD, Kurs 99.40 USD (30.11.2026 15:59:58 Uhr MEZ).
Kurslücke: Eröffnung 99.80 lag bereits unter dem Stopp 100.89, aktueller Kurs 99.40. Ein Verkauf zum Stoppkurs ist nicht anzunehmen; der tatsächliche Preis ist erst nach deiner Ausführung bekannt.
Der Swing hat seinen vorgesehenen Ausstieg erreicht. Er wird nicht nachträglich zu einem Langfristinvestment umgedeutet; ein Trailing-Stopp oder längeres Halten gilt nur für Positionen, die vorher den Teilgewinn erreicht haben.
Restposition: 9 Stück. Verkauf löst du selbst beim Broker aus.

Ausführung erfassen (Teilverkauf, Ausstieg): https://x.example/a/qaloYPp8MW-BBNLfEElpZvB8vL55ObB2
```

[TESTDATEN] Geschlossen: {"status":"closed","shares_sold":18,"realized_pnl_usd":0.6999999999999744} (realisiert vor Kaufgebühr 1,00 USD)
[TESTDATEN] missed: ok: Tageslauf abgeschlossen
[TESTDATEN] Stundenscan: ok: 1 geprüft, 0 Lücken, 1 neu vorbereitet
[TESTDATEN] 5-Minuten-Überwachung: ok: 3 Kandidaten, 1 ausgelöst, 0 bestätigt, 1 verpasst

### Einstieg verpasst

**Betreff:** Einstieg verpasst · DEMO · Base Breakout

```
Signal: 24.11.2026 17:05 Uhr MEZ
Auslöser: 102.20 · Kurs 103.40 (24.11.2026 17:05:57 Uhr MEZ)
Stopp (geplant): 100.89
Status: Kurs ist dem Auslöser 0.92 R davongelaufen (Grenze 0.25 R)

Es wird kein Kauf empfohlen. Für dieses Setup kommt keine weitere Meldung; ein neuer, eigenständiger Ausbruch löst wieder aus.
```
[TESTDATEN] watch: ok: Tageslauf abgeschlossen
[TESTDATEN] Stundenscan: ok: 1 geprüft, 0 Lücken, 1 neu vorbereitet
[TESTDATEN] 5-Minuten-Überwachung: ok: 3 Kandidaten, 1 ausgelöst, 0 bestätigt, 0 verpasst

### Nur beobachten (Trigger erreicht, Depot bleibt in Cash)

**Betreff:** Nur beobachten · DEMO · Base Breakout

```
NUR BEOBACHTEN – kein Einstieg. Technischer Trigger erreicht, aber Einstieg nicht zulässig.
Grund: Marktvorgabe: Cash (kein neuer Einstieg) (aus der Konfiguration) – Erholungsversuch im Abwärtstrend – Breite und Führung fehlen noch – Depot bleibt in Cash, kein Einstieg, nur Beobachtung
Signal: 24.11.2026 17:05 Uhr MEZ (11:05 New York) · Modellentscheidung
Markt: USA (Nasdaq/NYSE, USD) · Trigger: 102.20 USD · Kurs 102.40 USD, Zeitstempel 24.11.2026 17:05:55 Uhr MEZ, geprüft 17:06:00
Geplanter Stopp wäre 100.89 USD – keine Stückzahl, kein Kauf-Link, keine Kaufbestätigung.

Warum interessant: Base Breakout
Warum auf der Kandidatenliste: Rang 1 von 1 im Markt – Relative Stärke: 63-Tage-Rendite 22.5 % = Perzentil 100 im Markt USA (Nasdaq/NYSE); Liquidität: Ø-Umsatz 20 Tage 196.4 Mio USD; Handelsspanne: Ø-Tagesspanne 3.0 %; Kurs 101.00 USD; außerhalb der kontrollierten Indizes (trotzdem gescannt)
• Base Breakout – erfüllt: Basis über 8 Kerzen mit 1.29 % Spanne (max. 3 %); Vorheriger Anstieg: Basisbeginn 101.50 über dem Schluss 10 Kerzen zuvor (97.05), ohne kurzen Schub
  Herkunft der Marken: Struktur beruht auf abgeschlossenen Stundenkerzen bis 24.11.2026 16:30 Uhr MEZ (Schluss 101.70) | Auslösemarke 102.20 = Hoch der abgeschlossenen Kerze vom 24.11.2026 16:30 Uhr MEZ | Stopp 100.89 = Tief 100.90 der abgeschlossenen Kerze vom 24.11.2026 16:30 Uhr MEZ minus 1 Cent; die Idee ist widerlegt bei Schluss/Tief darunter
  Kontext (kein Trigger): 105.00 USD (runde Marke – nur Kontext, ersetzt die aus dem Chart abgeleitete Marke nicht)

Entscheidungsstufen (getrennt):
  1. Setup vorbereitet: 24.11.2026 16:36 Uhr MEZ – ja
  2. Technischer Trigger erreicht: 24.11.2026 17:05 Uhr MEZ – ja
  3. Einstieg nach Markt- und Risikoregeln zulässig: NEIN – Marktvorgabe: Cash (kein neuer Einstieg) (aus der Konfiguration) – Erholungsversuch im Abwärtstrend – Breite und Führung fehlen noch – Depot bleibt in Cash, kein Einstieg, nur Beobachtung

Marktlage (Modellbewertung, kein fester Freigabe-Schwellenwert)
Marktvorgabe: Cash (kein neuer Einstieg) (aus der Konfiguration) – Erholungsversuch im Abwärtstrend – Breite und Führung fehlen noch
Marktbreite: nicht bewertet (zu wenig Daten)
Führungsgruppen: nicht bewertet (Daten fehlen)
Handelswoche: Do 26.11. geschlossen (Thanksgiving); Fr 27.11. verkürzt (Schluss 13:00 New York) – Signale und Volumen sind weniger aussagekräftig
QQQ-Filter (sperrt Trend-Setups, Erholungs-Setups (Undercut & Rally, First Higher Low) bleiben erlaubt): Stundenschluss 439.43 über SMA20 434.00 → blockiert nichts

Regelstatus:
  Sperren: Marktvorgabe: Cash (kein neuer Einstieg) (aus der Konfiguration) – Erholungsversuch im Abwärtstrend – Breite und Führung fehlen noch – Depot bleibt in Cash, kein Einstieg, nur Beobachtung
  Nur Kontext (sperrt nicht): Baron: S&P 500 · Daten fehlen (weniger als 200 Schlusskurse); letzter abgeschlossener Handelstag wäre 2026-11-23 | Giering: Wachstum (Giering-Modell): offen · FMP_API_KEY nicht gesetzt – keine Quartalsdaten | QQQ-Marktfilter: QQQ-Filter (sperrt Trend-Setups, Erholungs-Setups (Undercut & Rally, First Higher Low) bleiben erlaubt): Stundenschluss 439.43 über SMA20 434.00 → blockiert nichts | Kontextmarke 105.00 USD – runde Marke – nur Kontext, ersetzt die aus dem Chart abgeleitete Marke nicht
  Fehlende Daten: S&P-500-Daten (FRED) | Wachstumsdaten (FMP_API_KEY nicht gesetzt – keine Quartalsdaten) | Führungsgruppen (nur Information)

Das Setup bleibt vorbereitet. Ändert sich deine Marktvorgabe, kann ein späterer Trigger wieder zulässig sein; ein inzwischen davongelaufener Kurs gilt dann als „Einstieg verpasst“.

Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.
```
[TESTDATEN] Xetra: ok: Tageslauf abgeschlossen
[TESTDATEN] Xetra-Vormittagsscan: ok: 1 Kandidaten, 1 ausgelöst, 1 bestätigt, 0 verpasst

### Xetra: Vorwarnung (Tageschart, EUR)

**Betreff:** Vorwarnung · SRT3 · Mehrwöchige Basis

```
Stufe 1 von 3 – Setup vorbereitet (noch KEIN Trigger, KEIN Einstieg) · Stand 24.11.2026 18:00 Uhr MEZ
Feed IEX (Echtzeit, nur ein Handelsplatz; Volumen unterschätzt das Gesamtvolumen)

SRT3: Warum auf der Kandidatenliste: Rang 1 von 1 im Markt – Relative Stärke: 63-Tage-Rendite 22.0 % = Perzentil 100 im Markt Deutschland (Xetra); Liquidität: Ø-Umsatz 20 Tage 29.4 Mio EUR; Handelsspanne: Ø-Tagesspanne 2.2 %; Kurs 292.80 EUR; außerhalb der kontrollierten Indizes (trotzdem gescannt)
SRT3 · Mehrwöchige Basis (Tageschart) · Markt: Xetra (EUR)
  Auslösemarke: 5-Minuten-Schluss über 298.00
  Geplanter Stopp: 291.49 EUR (Idee widerlegt bei Schluss/Tief unter 291.50)
  Stopp-Bezug: Tagestief des Inside Days vom 2026-11-24 (291.50). Modellannahme: die Quelle nennt nur „unter dem Tagestief“
  Kontext: 300.00 EUR (Basishoch/Marke – Kontext, KEIN Trigger)
  Verfall: 01.12.2026 17:30 Uhr MEZ oder Invalidierung
  Herkunft der Marken: Struktur beruht auf abgeschlossenen Tageskerzen bis 2026-11-24 (Schluss 292.80) | Auslösemarke 298.00 = Hoch der abgeschlossenen Kerze vom 2026-11-24 | Stopp 291.49 = Tief 291.50 der abgeschlossenen Kerze vom 2026-11-24 minus 1 Cent; die Idee ist widerlegt bei Schluss/Tief darunter
  Bereits erfüllt: Basis über 15 Handelstage mit 5.6 % Spanne (max. 10 %) nach einem Anstieg von ≥ 10 %; Steigender EMA20 (291.97) unter dem Kurs 292.80; Inside Day am 2026-11-24: Hoch 298.00, Tief 291.50
  Noch offen: 5-Minuten-Schluss über dem Hoch des Inside Days (298.00); das Basishoch 300.00 ist nur Kontext

Du erhältst eine Einstiegsmail nur, wenn der Auslöser bestätigt, die Markt- und Risikoregeln den Einstieg zulassen und der Kurs frisch geprüft ist; sonst „Nur beobachten“. Vorwarnungen lassen sich mit MAIL_PREWARN=false abschalten.

Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.
```

### Xetra: Einstieg bestätigt (deutscher Vormittag, EUR)

**Betreff:** Einstieg bestätigt · SRT3 · Mehrwöchige Basis

```
Signal: 25.11.2026 09:40 Uhr MEZ · Modellentscheidung
Auslöser: 298.00 · Kurs 298.40 EUR, Zeitstempel 25.11.2026 09:41:56 Uhr MEZ, geprüft 09:42:00 (Alter 4 s)
Stopp: 291.49 EUR · Abstand 6.91 EUR je Aktie (1R)
Stopp-Bezug: Tagestief des Inside Days vom 2026-11-24 (291.50). Modellannahme: die Quelle nennt nur „unter dem Tagestief“
Stückzahl: 6 (Einsatz 1790.40 EUR (≈ 1969.44 USD)) · geplantes Risiko 41.46 EUR (≈ 45.61 USD) = 0.46 % des Depots
Markt: Xetra (EUR) · Daten: Xetra-Attrappe (TESTDATEN, EUR) · Limit-Orders bleiben bei dir; Kurs vor Order erneut prüfen.

Warum interessant: Mehrwöchige Basis
Warum auf der Kandidatenliste: Rang 1 von 1 im Markt – Relative Stärke: 63-Tage-Rendite 22.0 % = Perzentil 100 im Markt Deutschland (Xetra); Liquidität: Ø-Umsatz 20 Tage 29.4 Mio EUR; Handelsspanne: Ø-Tagesspanne 2.2 %; Kurs 292.80 EUR; außerhalb der kontrollierten Indizes (trotzdem gescannt)
• Mehrwöchige Basis – erfüllt: Basis über 15 Handelstage mit 5.6 % Spanne (max. 10 %) nach einem Anstieg von ≥ 10 %; Steigender EMA20 (291.97) unter dem Kurs 292.80; Inside Day am 2026-11-24: Hoch 298.00, Tief 291.50
  Herkunft der Marken: Struktur beruht auf abgeschlossenen Tageskerzen bis 2026-11-24 (Schluss 292.80) | Auslösemarke 298.00 = Hoch der abgeschlossenen Kerze vom 2026-11-24 | Stopp 291.49 = Tief 291.50 der abgeschlossenen Kerze vom 2026-11-24 minus 1 Cent; die Idee ist widerlegt bei Schluss/Tief darunter
  Kontext (kein Trigger): 300.00 EUR (Basishoch/Marke – Kontext, KEIN Trigger)
• Bestätigung heute: abgeschlossene 5-Minuten-Kerze schloss bei 298.15 über dem Auslöser 298.00

Ist der Einstieg noch sinnvoll? Der Kurs liegt 0.06 R über dem Auslöser (Grenze 0.25 R). Widerlegt ist die Idee unter 291.49.

Entscheidungsstufen (getrennt):
  1. Setup vorbereitet: 24.11.2026 18:00 Uhr MEZ – ja
  2. Technischer Trigger erreicht: 25.11.2026 09:40 Uhr MEZ – ja
  3. Einstieg nach Markt- und Risikoregeln zulässig: JA – Marktvorgabe: offen (normale Regeln) (aus der Konfiguration)

Marktkontext
Marktbreite: nicht bewertet (zu wenig Daten)
Führungsgruppen: nicht bewertet (Daten fehlen)
Erholungsversuch/Follow-Through-Day: nicht bewertet (keine Indexdaten für DAX/MDAX angebunden)
Handelswoche: keine verkürzten oder ausgefallenen Handelstage
S&P 500 · Daten fehlen (weniger als 200 Schlusskurse); letzter abgeschlossener Handelstag wäre 2026-11-24
QQQ-Filter: gilt nur für US-Titel (für Xetra nicht angewendet; es gibt keinen US-Ersatz für deutsche Titel)
Wachstum (Giering-Modell): offen · Quartalsdaten für Xetra-Titel nicht angebunden (FMP-Abdeckung für Xetra nicht verifiziert) – Setup wird dadurch nicht unterdrückt

Regelstatus:
  Sperren: keine – alle sperrenden Regeln (Marktvorgabe, Stoppweite, Kapital/Risiko, Kursprüfung) lassen den Einstieg zu
  Nur Kontext (sperrt nicht): Baron: S&P 500 · Daten fehlen (weniger als 200 Schlusskurse); letzter abgeschlossener Handelstag wäre 2026-11-24 | Giering: Wachstum (Giering-Modell): offen · Quartalsdaten für Xetra-Titel nicht angebunden (FMP-Abdeckung für Xetra nicht verifiziert) – Setup wird dadurch nicht unterdrückt | Kontextmarke 300.00 EUR – Basishoch/Marke – Kontext, KEIN Trigger
  Fehlende Daten: S&P-500-Daten (FRED) | Wachstumsdaten (Quartalsdaten für Xetra-Titel nicht angebunden (FMP-Abdeckung für Xetra nicht verifiziert) – Setup wird dadurch nicht unterdrückt) | Führungsgruppen (nur Information)
  US-Informationen am deutschen Vormittag: Beim deutschen Vormittagsscan ist nur der Schluss des letzten abgeschlossenen US-Handelstags (2026-11-24) bekannt; er ist reiner Kontext und sperrt keinen Xetra-Einstieg. Die US-Börse ist noch geschlossen oder hat gerade erst geöffnet, der S&P-500-Wert für diesen Tag erscheint bei FRED erst am US-Folgetag.

Größenberechnung: begrenzt durch risiko; Risikobudget 45.45 EUR (≈ 50.00 USD), verfügbar 9090.91 EUR (≈ 10000.00 USD), offenes Risiko vorher 0.00 EUR (≈ 0.00 USD).
Wechselkurs: 1 EUR = 1.1 USD (EZB-Referenzkurs (Beispiel), 2026-11-20) – Order in Handelswährung EUR, Depot in USD.

Gekauft? Kaufkurs und Stückzahl bestätigen (Link öffnet nur ein Formular, nichts wird gespeichert):
https://x.example/a/MXX5IErL19enr8jeWIDRMjqrmwgGGMPh
Nicht gekauft? Dort „ausgelassen“ wählen.

Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.
```
