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

DEMO · Base Breakout (Stundenchart)
  Auslösemarke: 5-Minuten-Schluss über 102.20
  Geplanter Stopp: 100.89 USD (Idee widerlegt bei Schluss/Tief unter 100.90)
  Verfall: 24.11.2026 20:30 Uhr MEZ
  Bereits erfüllt: Basis über 8 Kerzen mit 1.29 % Spanne (max. 3 %); Vorheriger Anstieg: Basisbeginn 101.50 über dem Schluss 10 Kerzen zuvor (97.05), ohne kurzen Schub
  Noch offen: 5-Minuten-Schluss über dem Basishoch 102.20 bei Volumen ≥ 1.2× Basisschnitt (Hochrechnung)

Du erhältst eine Einstiegsmail nur, wenn der Auslöser bestätigt, die Markt- und Risikoregeln den Einstieg zulassen und der Kurs frisch geprüft ist; sonst „Nur beobachten“. Vorwarnungen lassen sich mit MAIL_PREWARN=false abschalten.

Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.
```

### Einstieg bestätigt

**Betreff:** Einstieg bestätigt · DEMO · Base Breakout

```
Signal: 24.11.2026 17:05 Uhr MEZ (11:05 New York)
Auslöser: 102.20 · Kurs 102.40 USD, Zeitstempel 24.11.2026 17:05:55 Uhr MEZ, geprüft 17:06:00 (Alter 5 s)
Stopp: 100.89 USD · Abstand 1.51 USD je Aktie (1R)
Stückzahl: 24 (Einsatz 2457.60 USD) · geplantes Risiko 36.24 USD = 0.36 % des Depots
Daten: Feed IEX (Echtzeit, nur ein Handelsplatz; Volumen unterschätzt das Gesamtvolumen) · Limit-Orders bleiben bei dir; Kurs vor Order erneut prüfen.

Warum interessant: Base Breakout
• Base Breakout – erfüllt: Basis über 8 Kerzen mit 1.29 % Spanne (max. 3 %); Vorheriger Anstieg: Basisbeginn 101.50 über dem Schluss 10 Kerzen zuvor (97.05), ohne kurzen Schub
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

Größenberechnung: begrenzt durch gewicht; Risikobudget 50.00 USD, verfügbar 10000.00 USD, offenes Risiko vorher 0.00 USD.
Depot- und Handelswährung: USD.

Gekauft? Kaufkurs und Stückzahl bestätigen (Link öffnet nur ein Formular, nichts wird gespeichert):
https://x.example/a/-akR4ASmuPU4cCdaKBgN8ih5tp5GBmi2
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

Ausführung erfassen (Teilverkauf, Ausstieg): https://x.example/a/_rQ79sOjHKkd5OeYjOzBi8uhPXdg2Gsl
```

### Ausstieg (Kurslücke unter dem Stopp)

**Betreff:** Ausstieg · Kurslücke unter Stopp · DEMO

```
Stand 30.11.2026 16:00 Uhr MEZ
Stopp 100.89 USD, Kurs 99.40 USD (30.11.2026 15:59:58 Uhr MEZ).
Kurslücke: Eröffnung 99.80 lag bereits unter dem Stopp 100.89, aktueller Kurs 99.40. Ein Verkauf zum Stoppkurs ist nicht anzunehmen; der tatsächliche Preis ist erst nach deiner Ausführung bekannt.
Restposition: 9 Stück. Verkauf löst du selbst beim Broker aus.

Ausführung erfassen (Teilverkauf, Ausstieg): https://x.example/a/zsdaaBC8R92ut_tfDQePmPPpVUNMjLB5
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
Trigger: 102.20 USD · Kurs 102.40 USD, Zeitstempel 24.11.2026 17:05:55 Uhr MEZ, geprüft 17:06:00
Geplanter Stopp wäre 100.89 USD – keine Stückzahl, kein Kauf-Link, keine Kaufbestätigung.

Warum interessant: Base Breakout
• Base Breakout – erfüllt: Basis über 8 Kerzen mit 1.29 % Spanne (max. 3 %); Vorheriger Anstieg: Basisbeginn 101.50 über dem Schluss 10 Kerzen zuvor (97.05), ohne kurzen Schub

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

Das Setup bleibt vorbereitet. Ändert sich deine Marktvorgabe, kann ein späterer Trigger wieder zulässig sein; ein inzwischen davongelaufener Kurs gilt dann als „Einstieg verpasst“.

Modellentscheidung des Bots (Regeln: REGELN.md) – keine Anlageberatung und keine ausgeführte Order. Orders löst du selbst aus.
```
