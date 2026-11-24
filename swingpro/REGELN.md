# Regeln, Annahmen und Grenzen

Drei Ebenen werden getrennt geführt:

- **Belegt (Quelle)**: Was öffentlich zugeordnet werden kann. Quellenangaben stammen aus dem übernommenen Projekt (`legacy-python/REGELN.md`); die stock3-Artikel wurden bei dieser Umsetzung **nicht erneut gelesen**.
- **Modellannahme (M)**: Eigene, prüfbare Definition dieses Projekts. Siebenhaars Grafik nennt sieben Setups, veröffentlicht aber keine eindeutige maschinelle Definition. Alle Schwellen unten sind Modellentscheidungen, keine Expertenregeln.
- **Persönliche Vorgabe (P)**: Dein Handelsziel und Risikorahmen.

Die Trefferquote und Profitabilität der Regeln sind **ungetestet** (siehe ABNAHME.md).

## 1. Die sieben Setups (Siebenhaar-Grafik, Definitionen = M)

Zweistufig: **Vorbereitung** (nur abgeschlossene Kerzen) und **Auslöser** (abgeschlossene 5-Minuten-Kerze). `Std.` = Stundenkerzen 09:30–10:30, 10:30–11:30 … (aus zwei 30-Minuten-Kerzen); Tages-Setups nutzen dieselben Regeln auf Tageskerzen mit größeren Spannen (`DAILY` in `src/patterns.ts`, ungeprüft). Die letzte halbe Handelsstunde (15:30–16:00) bildet keine Stundenkerze; nach 15:30 gibt es keine neuen Einstiege.

| Setup | Vorbereitung (bekannt, wenn die Stundenkerze schließt) | Auslöser in der laufenden Stunde (5-Minuten-Kerze) | Zeiteinheit | Datenbedarf | Bekannte Grenzen |
|---|---|---|---|---|---|
| **Undercut & Rally** | Tief unter dem Tief der vorigen 11 Kerzen, Schluss darüber **und** über dem Vorschluss. Das Original verlangte genau diesen **Stundenschluss** als Signal – er ist jetzt die *Vorwarnung*, kein Einstieg. | 5-Min-Schluss über dem Hoch der Undercut-Kerze; Kurs unter dem Undercut-Tief verwirft. Stopp: Undercut-Tief − 1 ct. | Std. (Verfall 6 Std.), Tag | ≥ 13 Kerzen | „Rally“-Auslöser (Hoch der Reversal-Kerze) ist eine Modellwahl. Erholungs-Setup: vom QQQ-Trendfilter ausgenommen. |
| **First Higher Low** | In 30 Kerzen zwei bestätigte Tiefs (je 2 höhere Nachbarn), das zweite höher und ≥ 3 Kerzen später, das erste ist das tiefste davor; kein Schluss bisher über dem Auslöser. | 5-Min-Schluss über dem höchsten Hoch der zweiten Tiefkerze und ihrer zwei Folgekerzen; Laufende Stunde unterschreitet das 2. Tief nicht. Stopp: 2. Tief − 1 ct. | Std. (3 Std.), Tag | ≥ 30 Kerzen | Original löste per Stundenschluss aus; 5-Min-Bestätigung ist früher, aber mit dem **gleichen vorab bekannten Level**. Erholungs-Setup. |
| **Wedge Pop** | Zwei 4-Kerzen-Blöcke: zweiter mit niedrigeren Hochs und Tiefs, kleinerer Spanne. | 5-Min-Schluss über dem Hoch des 2. Blocks **und** hochgerechnetes Stundenvolumen ≥ Schnitt des 2. Blocks (frühestens nach 15 Min). | Std. (3 Std.), Tag | ≥ 8 Kerzen | **Volumen-Hochrechnung** (Tempo × 60 Min) ist eine Näherung; das Original prüfte das fertige Stundenvolumen. |
| **EMA-Crossback** | EMA20 (Start: Mittel der ersten 20 von 30 Schlüssen) steigt, letzter Schluss über dem EMA und höchstens 1,5 % darüber (Rücksetzer in Reichweite). | Laufende Stunde berührt/unterschreitet den EMA der Vorkerze **und** 5-Min-Schluss über dem Hoch der Vorkerze. Stopp: min(Vorkerzen-Tief, EMA, Tief der laufenden Stunde) − 1 ct. | Std. (2 Std.), Tag | ≥ 30 Kerzen | Die 1,5 %-Nähe ist eine neue Vorwarn-Bedingung (sonst wäre fast jeder Aufwärtstrend „vorbereitet“). |
| **Base’n Break** | **Schub**: Schluss zu Sockelbeginn ≥ 3 % über dem Schluss 5 Kerzen davor, danach **4 Kerzen** mit ≤ 2,5 % Spanne („Flagge“). | 5-Min-Schluss über dem Sockelhoch. Stopp: Sockeltief − 1 ct. | Std. (4 Std.), Tag | ≥ 10 Kerzen | |
| **Base Breakout** | **Basis über 8 Kerzen** mit ≤ 3 % Spanne, Basisbeginn über dem Schluss 10 Kerzen davor, **ohne** den Schub von Base’n Break. | 5-Min-Schluss über dem Basishoch **und** Volumentempo ≥ 1,2 × Basisschnitt. Stopp: Basistief − 1 ct. | Std. (4 Std.), Tag | ≥ 18 Kerzen | |
| **Episodic Pivot** | Gap ≥ 8 % (Eröffnung vs. Vortagesschluss) **und** belegter Katalysator „Quartalszahlen“ (siehe 3). Erkennung nach der Eröffnung per Snapshot. | **Ausdrücklich Stundenschluss**: erste Handelsstunde (09:30–10:30) abgeschlossen, Schluss ≥ Eröffnung, Volumen ≥ 2 × Median der letzten 5–10 ersten Handelsstunden (≥ 5 nötig). Kein früheres Signal. Stopp: Tief der ersten Stunde − 1 ct. | Std. (1. Stunde), Fenster 60 Min | 5–10 Tage Stundenhistorie, FMP | **Nur Quartalszahlen**; Pressemitteilungen, Zulassungen, Übernahmen werden nicht untersucht. Zeitliche Nähe belegt keine Kausalität. |

**Base’n Break vs. Base Breakout:** Beide Definitionen können auf dieselbe Kursstrecke passen. Sie schließen sich jetzt aus: Liegt unmittelbar vor dem kurzen Sockel ein Schub ≥ 3 %, zählt der Ausbruch ausschließlich als Base’n Break. Testfall: `test/patterns.test.ts`.

**Mehrere Setups gleichzeitig:** Eine Mail nennt alle. Es gilt der engste Stopp aller beteiligten Setups und der niedrigste Auslöser.

**Derselbe Ausbruch:** Jedes vorbereitete Setup löst höchstens einmal aus (`prepared.id`). Wird dieselbe Struktur in der nächsten Stunde erneut erkannt (Auslöser ±1 %), entsteht keine zweite Vorwarnung. Ein späteres Setup derselben Aktie gilt als *neuer eigenständiger Ausbruch*, sobald seit dem letzten Signal ein Stundenschluss unter dem früheren Auslöser lag.

## 2. Marktkontext

| Regel | Quelle / Art | Zeiteinheit | Datenbedarf | Grenzen |
|---|---|---|---|---|
| **S&P 500 gegen SMA200 (Baron)**: Schluss der **letzten vollständig abgeschlossenen Sitzung** vs. einfaches Mittel der letzten 200 Schlusskurse. Zeigt Datum, Schluss, SMA. Nur Information, sperrt nichts; Zustand wird je Signal protokolliert (`signals.ctx`). | Quelle: stock3-Artikel in `legacy-python/REGELN.md`; Umsetzung M | Tag | FRED `SP500`, ≥ 200 Werte | FRED veröffentlicht den Schluss erst am **Folgetag** (laut FRED-Seite, Stand 24.11.2026: Update ~11:05 CST). Vormittags fehlt der Vortag oft; die Mail sagt das ausdrücklich und zeigt den letzten verfügbaren Wert. **Lizenz:** S&P-500-Reihe ist urheberrechtlich geschützt (nur persönliche, nicht-kommerzielle Nutzung; kein Caching) – es werden nur abgeleitete Werte gespeichert. |
| **QQQ-Stundenfilter** (bisheriger Marktfilter): Schluss > SMA20 der Stundenschlüsse **oder** frisch ausgelöstes First Higher Low in QQQ. | Übernommen (M) | Std. | QQQ-Stundenreihe | **Zielkonflikt:** Der alte Filter sperrte *alle* Setups, auch Erholungssignale (Undercut & Rally, First Higher Low) – genau die Phase unter der Trendlinie. Neuer Standard `QQQ_FILTER=block_trend_setups`: blockiert nur Trend-/Fortsetzungs-Setups. `block_all` stellt das alte Verhalten her, `info` hebt die Sperre auf. Welche Regel blockiert hat, steht in `signals` (`status='blocked'`, `status_reason`) und in der Mail („blockiert nichts“ / „blockiert n Setup-Typen“). |

## 3. Wachstum und Katalysator

| Regel | Quelle / Art | Zeiteinheit | Datenbedarf | Grenzen |
|---|---|---|---|---|
| **Giering-Teilmodell**: Umsatz und verwässertes EPS des letzten Quartals vs. **demselben Vorjahresquartal**; Schwellen 20 % / 25 % (`GROWTH_MIN_*`). Ausgabe: Berichtszeitraum, Filing-Datum, beide Prozentwerte. | Orientierung: Giering (stock3); Schwellen = M | Quartal | FMP `income-statement?period=quarter` | Nur Etikett („Wachstumskandidat – möglicher längerer Läufer“). **Unterdrückt nie ein technisches Signal.** Befund „offen“ mit Erklärung bei: Daten fehlen, Vorjahres-EPS ≤ 0, Währung abweichend, Daten > 180 Tage, kein Vorjahresquartal. Filings gelten erst ab dem Folgetag (Veröffentlichungszeit ungeklärt). Revisionen machen aktuelle Schnittstellen für Historienvergleiche ungeeignet. |
| **Katalysator Episodic Pivot**: EPS-Ist-Wert vorhanden **und** nachweislich vor der Entscheidung bekannt. Datum des Vortags genügt; Meldung am Gap-Tag nur mit `timing=bmo` oder belegter `availableAt`-Zeit. Im Live-Betrieb gilt ein beim Abruf vorhandener Ist-Wert als belegt. | M | Tag | FMP `earnings-calendar` | Das FMP-Feld für die Uhrzeit ist **nicht verifiziert**. Ein bloßes Kalenderdatum macht eine Meldung nach Börsenschluss nicht zum Signal am Vormittag (`test/units.test.ts`). Für Historien-/Replay-Tests zählt die tatsächliche Veröffentlichungszeit, sonst wird verworfen. |

## 4. Universum (Modellentscheidungen M)

| Schritt | Regel (Standard, per Variable änderbar) |
|---|---|
| Börsen | Nasdaq und NYSE (`EXCHANGES`), aktiv, handelbar, Alpaca-Klasse `us_equity`. |
| Ausschlüsse | ETF/ETN/Fonds, Warrants, Units, Rights, Preferred, Notes (Namens- und Symbolheuristik; Alpaca liefert kein ETF-Flag), SPACs, Symbolformen außer `ABC` bzw. `ABC.A/.B`. Restrisiko: Fehlklassifikation einzelner Titel; Korrektur über `EXCLUDE_SYMBOLS` / `INCLUDE_SYMBOLS`. |
| ADRs | **Ausgeschlossen** (`INCLUDE_ADRS=false`): Quartalszahlen oft als 20-F in anderer Währung → Wachstumsurteil unzuverlässig. Zuschaltbar. |
| Neuemissionen | Alpaca-Attribut `ipo` → ausgeschlossen; sonst zu wenig Historie (< 130 Handelstage, `MIN_HISTORY_DAYS`) → „Datenlücke“, bis genug Historie vorliegt. |
| Symbolwechsel | Über die Alpaca-Asset-ID: neues Symbol, gleiche ID → alte Reihe verworfen und im Tagesbericht gemeldet; Symbol von anderem Wertpapier übernommen → Reihe verworfen. |
| Splits | Tages- und Stundenreihen sind Split-bereinigt abgerufen. Weicht beim inkrementellen Nachladen ein überlappender Schlusskurs um > 0,5 % ab, wird die Reihe neu geladen; offene Positionen werden zur **manuellen Prüfung** markiert, automatisches Nachziehen pausiert. |
| Vorauswahl täglich | Kurs ≥ 10 USD (`MIN_PRICE`); Ø-Dollarumsatz 20 Tage ≥ 20 Mio. USD (`MIN_DOLLAR_VOLUME`, **Daily-Feed SIP**); Ø-Tagesspanne (H−L)/C 2–12 % (`MIN_RANGE_PCT`, `MAX_RANGE_PCT`); relative Stärke: 63-Tage-Rendite im oberen Perzentil ≥ 50 (`MIN_RS_PERCENTILE`); Obergrenze 400 überwachte Titel (`MAX_WATCH`, Subrequest-Budget). Der Bericht weist aus: verfügbar, ausgeschlossen (nach Grund), Datenlücken, liquide, geprüft. |

## 5. Einstiegsprüfung und Risiko

| Regel | Art | Details |
|---|---|---|
| Frischer Kurs vor jeder Einstiegsmail | M | Snapshot (Ask, sonst letzter Trade). Älter als `MAX_QUOTE_AGE_SEC` (120 s) oder fehlend → **kein** Einstieg; nach 3 Fehlversuchen gibt der Kandidat auf. Mail zeigt Kurs, Zeitstempel, Prüfzeit, Alter. |
| „Einstieg verpasst“ | M | Kurs − Auslöser > `MAX_CHASE_R` (0,25 R, R = Auslöser − Stopp) → Status verpasst, kein Kauf empfohlen. Kurs unter Auslöser → nicht bestätigt; Stopp-Abstand außerhalb 0,5–10 % → verworfen. |
| Stückzahl neu mit frischem Kurs | P/M | = min(Risikobudget / (Kurs − Stopp), Gewichtsgrenze / Kurs, freies Kapital / Kurs, Restbudget Gesamtrisiko / (Kurs − Stopp)). |
| Risiko je Trade / Gewicht | **P** | 0,5 % (`RISK_PERCENT`) / 25 % (`MAX_WEIGHT_PERCENT`). |
| Gesamtrisiko, Positionen | M | `MAX_OPEN_RISK_PERCENT` 3 % (Summe (Kurs − aktueller Stopp) × Rest), `MAX_POSITIONS` 8. Gebundenes Kapital offener Positionen wird abgezogen. |
| Währung | **P** | Standard USD. `ACCOUNT_CURRENCY=EUR` nur mit `FX_USD_PER_EUR`, `FX_DATE`, `FX_SOURCE` (z. B. EZB-Referenzkurs); der Kurs steht in der Mail. Orders laufen immer in USD; Umrechnung nur zur Anzeige und Budgetierung. |

## 6. Positionsbegleitung (Teststrategie, P)

| Regel | Details |
|---|---|
| Start erst nach **ausdrücklicher** Kaufbestätigung | Link öffnet nur ein Formular (GET ändert nichts); Speichern braucht POST mit Bestätigung. 1R = tatsächlicher Einstieg − anfänglicher Stopp. |
| +2R | Bei Kurs ≥ Einstieg + 2R: Mail „Teilgewinn“ mit ~50 % (`PARTIAL_FRACTION`). Das ist eine **gemeldete Empfehlung**; Verkaufsmenge und -preis zählen erst, wenn du die tatsächliche Ausführung erfasst (`partial_executed`). |
| Restposition | Stopp folgt **bestätigten Wochentiefs**: Wochentief tiefer als die Vorwoche und tiefer als die **zwei folgenden abgeschlossenen Wochen**; es steht damit erst nach der zweiten Folgewoche fest (keine Zukunftsdaten). Nur Wochen nach der Einstiegswoche. Stopp = Wochentief − 1 ct. **Der Stopp steigt nur**, nie fällt er. |
| Stopp / Kurslücke | Kurs ≤ Stopp → Ausstiegsmail. Lag die Eröffnung bereits unter dem Stopp, steht ausdrücklich „Verkauf zum Stoppkurs nicht anzunehmen“. Realisierte Ergebnisse stammen ausschließlich aus deinen erfassten Ausführungen. |
| Seitwärts | ≥ 15 Handelstage ohne ≥ 1R → einmaliger Zeithinweis. |
| Länger halten | Das System hält nichts automatisch: Nach dem Teilverkauf läuft der Wochentief-Stopp; ob du 6–12 Monate hältst, entscheidest du. Der Wachstumsbefund der Mail ist nur ein Hinweis. |
| Orders | Das System löst **nie** Orders aus. |
