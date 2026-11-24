# Beispiel-Mails aus dem Replay (TESTDATEN, erfundene Kurse)

Erzeugt mit `npm run replay -- --write docs/BEISPIELMAILS.md`. Adressen und Links sind Platzhalter; Tokens sind nur im Replay gültig.
[TESTDATEN] normal: ok: Tageslauf abgeschlossen
[TESTDATEN] Stundenscan: ok: 1 geprüft, 0 Lücken, 1 neu vorbereitet
[TESTDATEN] 5-Minuten-Überwachung: ok: 3 Kandidaten, 1 ausgelöst, 1 bestätigt, 0 verpasst

### Vorwarnung

**Betreff:** Vorwarnung · DEMO · Base Breakout

```
Vorbereitete Setups (noch KEIN Einstieg) · Stand 24.11.2026 16:36 Uhr MEZ
Feed IEX (Echtzeit, nur ein Handelsplatz; Volumen unterschätzt das Gesamtvolumen)

DEMO · Base Breakout (Stundenchart)
  Auslösemarke: 5-Minuten-Schluss über 102.20
  Geplanter Stopp: 100.89 (Idee widerlegt bei Schluss/Tief unter 100.90)
  Verfall: 24.11.2026 20:30 Uhr MEZ
  Bereits erfüllt: Basis über 8 Kerzen mit 1.29 % Spanne (max. 3 %); Vorheriger Anstieg: Basisbeginn 101.50 über dem Schluss 10 Kerzen zuvor (97.05), ohne kurzen Schub
  Noch offen: 5-Minuten-Schluss über dem Basishoch 102.20 bei Volumen ≥ 1.2× Basisschnitt (Hochrechnung)

Du erhältst eine Einstiegsmail nur, wenn der Auslöser bestätigt und der Kurs frisch geprüft ist. Vorwarnungen lassen sich mit MAIL_PREWARN=false abschalten.
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
• Bestätigung heute: 5-Minuten-Kerze bis 16:05 UTC schloss bei 102.35 über 102.20 | Volumentempo 1560/h ≥ 1200 (hochgerechnet aus 35 Min)

Ist der Einstieg noch sinnvoll? Der Kurs liegt 0.15 R über dem Auslöser (Grenze 0.25 R). Widerlegt ist die Idee unter 100.89.

Marktkontext
S&P 500 · Daten fehlen (weniger als 200 Schlusskurse); letzter abgeschlossener Handelstag wäre 2026-11-23
QQQ-Filter (sperrt Trend-Setups, Erholungs-Setups (Undercut & Rally, First Higher Low) bleiben erlaubt): Stundenschluss 439.43 über SMA20 434.00 → blockiert nichts
Wachstum (Giering-Modell): offen · FMP_API_KEY nicht gesetzt – keine Quartalsdaten

Größenberechnung: begrenzt durch gewicht; Risikobudget 50.00 USD, verfügbar 10000.00 USD, offenes Risiko vorher 0.00 USD.
Depot- und Handelswährung: USD.

Gekauft? Kaufkurs und Stückzahl bestätigen (Link öffnet nur ein Formular, nichts wird gespeichert):
https://x.example/a/s6jsNEdn6nMYqvlM1WZElB0Ywu1WJeax
Nicht gekauft? Dort „ausgelassen“ wählen.
```

### Teilgewinn (+2R erreicht)

**Betreff:** Teilgewinn +2R · DEMO

```
Stand 24.11.2026 17:56 Uhr MEZ
Kurs 105.87 USD hat 2R erreicht (Einstieg 102.45, 1R = 1.56 USD, Marke 105.57).
Empfehlung: ca. 50 % = 9 Stück verkaufen (Teststrategie). Das ist eine GEMELDETE Empfehlung – erst deine Erfassung der tatsächlichen Ausführung zählt.

Danach wird die Restposition per bestätigten höheren Wochentiefs nachgezogen (Stopp steigt nur).

Ausführung erfassen (Teilverkauf, Ausstieg): https://x.example/a/XpDDd66u356P_bl1yMtE7PLLBPUIR31J
```

### Ausstieg (Kurslücke unter dem Stopp)

**Betreff:** Ausstieg · Kurslücke unter Stopp · DEMO

```
Stand 30.11.2026 16:00 Uhr MEZ
Stopp 100.89 USD, Kurs 99.40 USD (30.11.2026 15:59:58 Uhr MEZ).
Kurslücke: Eröffnung 99.80 lag bereits unter dem Stopp 100.89, aktueller Kurs 99.40. Ein Verkauf zum Stoppkurs ist nicht anzunehmen; der tatsächliche Preis ist erst nach deiner Ausführung bekannt.
Restposition: 9 Stück. Verkauf löst du selbst beim Broker aus.

Ausführung erfassen (Teilverkauf, Ausstieg): https://x.example/a/xwFbuksj2ljvixJmAme4z6Rvljn6g1Fx
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
