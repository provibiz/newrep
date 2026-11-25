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

### Ergänzung vom 25.11.2026 (Report „HUANG-OVER – Der Kater nach der Party“): drei weitere Einstiegspfade
Quelle der Fälle: TraderMacher-Report von Dirk Siebenhaar vom 25.11.2026. Die Mail beschreibt die Fälle in Worten und Charts, nennt aber weder Parameter noch Definitionen. **Alle Zahlen unten sind Modellannahmen** (konfigurierbar). Die Kursmarken der Fälle stehen ausschließlich in `test/fixtures/siebenhaar.ts`.

| Setup | Vorbereitung (Tageschart) | Auslöser | Stopp / Bezug | Datenbedarf | Bekannte Grenzen |
|---|---|---|---|---|---|
| **Konsolidierung nach Quartalszahlen** (Crocs) | Kurslücke ≥ 8 % (`ERC_MIN_GAP_PCT`) mit belegtem Katalysator „Quartalszahlen“ (wie Episodic Pivot), danach **mindestens 5 Handelstage** Konsolidierung (`ERC_MIN_DAYS`), Lücke nicht gefüllt, Spanne der letzten 5 Tage ≤ 8 % (`ERC_MAX_RANGE_PCT`), EMA10 > EMA20 und EMA20 steigt, Kurs ≥ EMA20, **letzte Kerze ist ein Inside Day**. Rückblick 30 Tage (`ERC_LOOKBACK_DAYS`). | 5-Min-Schluss über dem **Hoch des Inside Days**. **Weder die Zahlenmeldung noch die erste Kurslücke noch die Tage direkt danach lösen aus** (Test: `test/siebenhaar-2026-11-25.test.ts`). | **Modellannahme:** Die Quelle schreibt nur „unter dem Tagestief“. Wir beziehen den Stopp auf das **Tief des Inside Days** (Datum steht in Vorwarnung und Mail). Alternative `ERC_STOP_BASIS=breakout_day`: Tief des Ausbruchstags. | Tageskerzen, FMP `earnings` je Titel mit Lücke (max. 30 Abrufe je Tageslauf, `ERC_MAX_FMP_CALLS`) | Ohne Katalysator-Daten (FMP) keine Vorbereitung. Gap-Tag-Meldung ohne belegte Uhrzeit zählt nicht. |
| **Mehrwöchige Basis** (Sartorius) | Mindestens 15 Handelstage (`MWB_MIN_DAYS`) seitwärts mit Spanne ≤ 10 % (`MWB_MAX_RANGE_PCT`) nach Anstieg ≥ 10 % (`MWB_PRIOR_RISE_PCT`), EMA20 steigt unter dem Kurs, Schluss ≤ 4 % unter dem Basishoch (`MWB_MAX_DIST_PCT`), letzte Kerze ist ein Inside Day. Ersetzt im Tageschart den generischen Basisausbruch derselben Strecke. | 5-Min-Schluss über dem **Hoch des Inside Days**. Das **Basishoch/die runde Marke bleibt Kontext** (in Vorwarnung als „Kontext, KEIN Trigger“ gezeigt). | Tief des Inside Days (Modellannahme wie oben). | Tageskerzen **in der Währung des Instruments** | **Nur mit Datenabdeckung**: siehe 4a. Ohne sie „Markt nicht unterstützt“, kein Ersatzkurs. |
| **EMA-Reclaim** (Illumina) – getrennt vom EMA-Crossback | Kurs **unter EMA10 und EMA20** (EMA20 fällt) nach einem Abverkauf; **Rücklauf aufs alte Ausbruchsniveau** (lokales Hoch, das später um ≥ 20 % überboten wurde, Test mit 3 % Toleranz; schaltbar `EMA_RECLAIM_LEVEL_TEST`) – **der Rücktest erzeugt die Vorwarnung**; der Einstieg bleibt **gesperrt**, bis die **Seitwärtsphase** (≥ 3 Tage, Spanne ≤ 6 %) steht. Trigger und Stopp wandern bis dahin täglich mit (Stopp vorläufig). | Rückeroberung von **EMA10 und EMA20** (Trigger = höherer der beiden). **Bestätigungsart konfigurierbar** (`EMA_RECLAIM_CONFIRM`): `intraday` = 5-Min-Schluss darüber (Standard), `daily_close` = vollständiger Tagesschluss nach Börsenschluss. | **Unter dem Tief der Konsolidierung** (Seitwärtsphase), nicht unter dem Rücklauf-Niveau. | Tageskerzen | **Weder eine feste Zahl Seitwärtstage noch eine Schlusskursbestätigung steht in der Quelle** – beide sind sichtbare, konfigurierbare Modellannahmen (`EMA_RECLAIM_MIN_SIDEWAYS_DAYS`, `EMA_RECLAIM_CONFIRM`). Trigger wandert mit den EMAs (Vorbereitung wird täglich aktualisiert). |

**EMA-Crossback vs. EMA-Reclaim:** Crossback = Rücksetzer **in einem Aufwärtstrend** (EMA20 steigt, Kurs darüber, Berührung des EMA). Reclaim = Rückeroberung **nach einem Abverkauf** (Kurs unter beiden EMAs, EMA20 fällt). Beide schließen sich per Definition aus (Test).

### Drei getrennte Entscheidungen (Datenmodell, Oberfläche, E-Mail)
| Stufe | Frage | Gespeichert in | Mail / Oberfläche |
|---|---|---|---|
| 1. **Setup vorbereitet** | Passt die Struktur, ist der Trigger definiert? | `prepared` (Zeit `created_at`, `origin`, `source`) | Vorwarnung („Stufe 1 von 3 … noch KEIN Trigger, KEIN Einstieg“) |
| 2. **Technischer Trigger erreicht** | Hat eine abgeschlossene Kerze den Auslöser bestätigt? | `signals.signal_time` | Zeile „Technischer Trigger erreicht“ |
| 3. **Einstieg zulässig** (konfigurierte Markt- und Risikoregeln) | Marktvorgabe, QQQ-Filter, frischer Kurs, Verpasst-Grenze, Größe/Risiko | `signals.permission` (`permitted`/`watch_only`), `permission_reasons` | „Einstieg bestätigt“ **oder** „Nur beobachten · … · Grund“ |

Jedes vom Bot erzeugte Signal trägt die Kennzeichnung **„Modellentscheidung des Bots – keine Anlageberatung und keine ausgeführte Order“**. Eine **veröffentlichte Watchlist-Idee** (`origin=idea`, Quelle genannt) ist **kein ausgeführter Trade**: sie wird als externe Vorbereitung importiert und durchläuft dieselben drei Stufen; eine Position entsteht erst durch deine ausdrückliche Kaufbestätigung. Ist Stufe 3 „nein“, enthält die Mail **keinen Kauf-Link, keine Stückzahl, keine Positionsanlage**.

### 4a. Datenabdeckung für Nicht-US-Instrumente (Sartorius)
Ein Instrument gilt nur als unterstützt, wenn **alle fünf** Prüfungen bestehen: Datenanbieter (Alpaca: nur Nasdaq/NYSE), Wertpapierkennung (ISIN-Prüfsumme und Anbieter-Zuordnung), Handelsplatz, **Handelskalender** (nur NYSE implementiert) und **Währung** (Stückzahl/Risiko nur in USD). Sonst: **„Markt nicht unterstützt“** mit den Einzelgründen (Statusseite, Import-Ergebnis). Es wird **nie ein US-Kurs als Ersatz für einen EUR-Trigger** verwendet: `checkEntry` lehnt Kurse in abweichender Währung ab (`currency_mismatch`).

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
| „Einstieg verpasst“ | M | Kurs − Auslöser > `MAX_CHASE_R` (0,25 R, R = Auslöser − Stopp) → Status verpasst, kein Kauf empfohlen. Kurs unter Auslöser → nicht bestätigt; Stopp-Abstand außerhalb 0,5–10 % (`MIN_STOP_PCT`, `MAX_STOP_PCT`) → **„Nur beobachten“ mit Begründung** („Risikoregel Stopp: Stopp 11,1 % entfernt (Maximum 10 %)“), einmal je Setup, kein Kauf-Link. |
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

## 7. Marktzustand getrennt vom einzelnen Chart (Information, keine Freigabe-Schwelle)
Quelle des Falls: Report vom 25.11.2026 (Erholungsversuch im Abwärtstrend, 123 neue Hochs gegenüber 465 neuen Tiefs, fehlende Führung durch Wachstumsaktien, Follow-Through-Day allein genügt nicht). **Die Mail nennt keinen allgemeingültigen numerischen Schwellenwert für eine Marktfreigabe – dieses System erfindet keinen.** Es dokumentiert den Zustand und lässt dich die Marktvorgabe setzen.

| Komponente | Umsetzung (M) | Universum · Zeitraum · Quelle | Grenzen |
|---|---|---|---|
| Marktbreite | Anzahl neuer 52-Wochen-Hochs/-Tiefs, Anteil über SMA50/SMA200 | Nasdaq-/NYSE-Stammaktien nach den Ausschlüssen aus Abschnitt 4 mit ≥ 252 Handelstagen Historie · 252 Handelstage · Alpaca-Tageskerzen (`DAILY_FEED`) | **Nicht identisch mit der Börsenstatistik der Quelle** – Zahlen anderer Anbieter sind nicht reproduzierbar. Neuemissionen und Symbole mit Lücken fehlen. |
| Führungsgruppen | Relative Stärke (63 Handelstage) der SPDR-Sektor-ETFs vs. SPY; Wachstumsgruppen XLK/XLY/XLC (`GROWTH_GROUPS`) „führen“, wenn ≥ 2 der Top 3 dazugehören | Sektor-ETFs · 63 Tage · Alpaca-Tageskerzen | Sektor-ETF-Zuordnung ist eine Modellwahl; Branchen-Untergruppen (z. B. Biotech, Medizintechnik) fehlen. |
| Erholungsversuch / Follow-Through-Day | Tag 1 = erster Plus-Schluss nach dem tiefsten Schluss der letzten 40 Tage; FTD = ab Tag 4 (`FTD_MIN_DAY`) ≥ 1,25 % (`FTD_MIN_GAIN_PCT`) bei höherem Volumen | SPY, QQQ · Tageskerzen | Modellregel, **nur Information**; ein FTD allein gibt nichts frei. |
| Verkürzte Handelstage | Feiertage und 13:00-Schlüsse der Handelswoche (NYSE-Kalender) | NYSE-Kalender | |

**Marktvorgabe (P, Entscheidung für die konkrete Lage, kein Algorithmus):** `open` (normale Regeln), `selective` (nur `STANCE_SELECTIVE_SETUPS`, z. B. First Higher Low, mit optionalem geplanten Einsatz `STANCE_WEIGHT_MIN/MAX` als Gewichtsgrenze) oder `cash` (kein Einstieg, nur „Nur beobachten“). Setzbar per Variable `MARKET_STANCE` oder auf der Statusseite (mit Notiz und Zeitstempel). Die in der Quelle genannten Werte (100 % Cash, 20–25 % Einsatz beim höheren Tief) sind **Entscheidungen des Autors für diese Lage**, keine Standardwerte dieses Systems.

## 8. Märkte, Identität, Abdeckung (USA + Xetra)
| Thema | Umsetzung | Grenzen |
|---|---|---|
| Märkte | `MARKETS=US` (Standard) oder `US,DE`. Je Markt eigener Kalender, Währung, Datenanbieter, Marktlage, Universum, Läufe. USA: Nasdaq/NYSE, USD, Alpaca. Deutschland: Xetra, EUR, Twelve Data (Standard-Adapter). | Xetra-Adapter nur mit Mocks getestet; Tarif/Intraday-Rechte offen (`ZUGAENGE.md`). Xetra: nur Tages-Setups mit 5-Minuten-Trigger, kein Stunden-Scan und kein Episodic Pivot. |
| Identität | Schlüssel `MIC:Mnemonic` für Xetra (`XETR:SRT3`), Ticker für USA. Gespeichert: Handelsplatz (MIC), Währung, ISIN (falls geliefert und prüfsummengültig), **Aktiengattung** (`common`, `preferred` für „Vz.“, `class_a/b`). Vorzugsaktien sind eigene Instrumente mit eigener ISIN und eigener Alarmlogik. Gleiche ISIN mehrfach → „Duplikat (gleiche ISIN)“ ausgeschlossen. | Ohne ISIN vom Anbieter: Identität über MIC + Mnemonic (Symbolwechsel dann nicht erkennbar). |
| Xetra-Filter | Stamm- und Vorzugsaktien in EUR; ETF/ETC/ETN/Fonds/Zertifikate/Anleihen/Optionsscheine und Hinterlegungsscheine ausgeschlossen (Typ des Anbieters, sonst Namensheuristik). Vorauswahl: Kurs ≥ 5 EUR (`DE_MIN_PRICE`), Ø-Umsatz ≥ 5 Mio. EUR (`DE_MIN_TURNOVER_EUR`), Spanne und relative Stärke wie USA, max. 150 Titel (`DE_MAX_WATCH`). | Schwellen sind Modellannahmen. |
| Mehrfachmitgliedschaft | Ein Instrument = eine Zeile; Indexzugehörigkeiten sind nur Tags (`index_members`). Prepared-ID je Instrument/Setup → **ein** Alarm. | |
| Abdeckungskontrolle | S&P 500, MidCap 400, SmallCap 600, Nasdaq-100 / DAX, MDAX, SDAX, TecDAX: Mitglieder · erfasst · aktuelle Daten · Filter (nach Grund) · auf Setups geprüft · nicht zuordenbar; dazu „außerhalb der Indizes“. Statusseite und Tagesbericht. Das Universum entsteht nicht aus den Indizes. | Nur S&P 500 hat eine geprüfte Standardquelle; sonst „Quelle fehlt“. |
| Datenlücken | Fehlt der Zugang, steht Anbieter, Tarif und genaue Lücke auf der Statusseite; der Markt wird nicht gescannt; nichts wird gebucht. | |
| Währung/Kapital | Stückzahl, Risiko und Kapital in der Handelswährung des Instruments; Positionen anderer Währung werden mit dem dokumentierten Kurs (`FX_USD_PER_EUR`, Datum, Quelle in der Mail) umgerechnet; ohne Kurs wird nie umgerechnet. Ein Kurs in abweichender Währung löst nie aus (`currency_mismatch`). | |

## 9. Kandidatenliste, Herkunft der Marken
- Der Scanner startet **ohne vorgegebene Ticker oder Preise**. Täglich je Markt: Liquidität, Handelsspanne, relative Stärke (63-Tage-Rendite-Perzentil) → Kandidatenliste mit **Rang** und Begründung (`candidate_log`, nur INSERT, per Trigger unveränderlich).
- Jede Vorwarnung/Einstiegs-/Beobachtungsmail beantwortet: **Warum auf der Liste** (Rang, RS, Liquidität, Spanne, Indizes) · **welche abgeschlossenen Kerzen** Trigger, Stopp und Struktur erzeugten („Auslösemarke = Hoch der abgeschlossenen Kerze vom …“) · **was auslöst** · **wo widerlegt** · **wann verfällt**.
- **Runde Marken** (z. B. nächstes Vielfaches, höchstens 3 % über dem Trigger) sind **nur Kontext** und überschreiben nie die aus dem Chart abgeleitete Marke.
- Ein früherer Ausbruch aus einer anderen Formation ist ein **eigenes Setup** mit eigener ID und eigener Marke; im Tageschart ersetzen die Inside-Day-Pfade den generischen Basisausbruch derselben Strecke.

## 10. Automatische Marktentscheidung (Normalbetrieb)
Reihenfolge je Markt: **(1)** manuelle Vorgabe (nur mit Begründung **und** Ablaufzeit ≤ 14 Tage) → **(2)** automatische Modellentscheidung → **(3)** veraltete/fehlende Daten → `AUTO_STALE_STANCE` (Standard `cash`).
Automatik (Modellannahmen, konfigurierbar, keine Börsenregel): „bärische Merkmale“ zählen – Verhältnis neuer Hochs/Tiefs < 1 (`AUTO_MIN_HIGH_LOW_RATIO`), Anteil über SMA50 < 40 % (`AUTO_MIN_ABOVE50_PCT`), Wachstumsgruppen führen nicht, (USA) S&P 500 unter SMA200, Marktbreite nicht bewertbar (zählt als bärisch). **≥ 3 Merkmale → Cash**, **≥ 1 → selektiv** (nur `STANCE_SELECTIVE_SETUPS`, Standard First Higher Low + EMA-Reclaim, optional Gewichtsgrenze), sonst **offen**. Follow-Through-Day und Erholungsversuch sind nur Information und geben nie frei. Marktlage älter als 3 Sitzungen (`AUTO_STALE_SESSIONS`) oder fehlend → Standard `cash`. Der QQQ-Stundenfilter gilt nur für US-Titel.
Mail-„Regelstatus“: **Sperren** (Marktvorgabe, QQQ-Filter, Stoppweite, Kapital/Risiko, Kursprüfung) · **nur Kontext** (Baron S&P vs. SMA200, Giering-Wachstum, QQQ-Info, Kontextmarken) · **fehlende Daten** (FRED, FMP, Marktlage, Führung). Baron und Giering sperren nie.
**Deutscher Vormittag:** Bekannt ist nur der Schluss des letzten abgeschlossenen US-Handelstags; der S&P-500-Wert dafür steht bei FRED erst am US-Folgetag. Er ist reiner Kontext und sperrt keinen Xetra-Einstieg. Die deutsche Marktlage (Breite aus dem Xetra-Universum) entscheidet; Führungsgruppen und Index-Erholungsversuch sind für Deutschland „nicht bewertet“ (keine Daten angebunden).

## 11. Vom Trigger zur Mail (Sperre, verpasst, Cash → offen)
„Einstieg bestätigt“ nur wenn: Trigger (abgeschlossene Kerze) · Marktvorgabe/QQQ zulässig · frischer Kurs in der Handelswährung (≤ 120 s) · Abstand ≤ 0,25 R vom Trigger · Stoppweite 0,5–10 % · Stückzahl ≥ 1 nach Kapital-/Gesamtrisiko. Sonst **„Nur beobachten“** (mit Grund) oder **„Einstieg verpasst“**; beide ohne Kauf-Link, ohne Position. Trigger in „cash“ → später „offen“: ist der Kurs weggelaufen → „verpasst“; sonst genau **eine** Einstiegsmail (Tests `Entscheidender Test`).

## 12. Blindlauf und Paper-Protokoll (Beweiswert)
- **Blindlauf** (`src/blindrun.ts`): je Stichtag nur Kerzen ≤ Sitzungsschluss, keine 5-Minuten-Kerzen/Quotes; Ziele werden erst **nach** dem Lauf ausgewertet (im Universum · Daten · Vorauswahl · Rang · Formation · eigene Marke · Status, sonst erster Ausschlussgrund). Beweiswert: nur „belegt“ bei historischen Echtdaten **und** zeitpunktgenauem Universum; heutiger Bestand oder erfundene Kurse → „NICHT BELEGT“ (steht im Bericht).
- **Paper-Protokoll:** Kerzenschluss (`signal_time`), Datenverfügbarkeit (`data_available_at`), Triggererkennung (`detected_at`), letzter geprüfter Kurs (`quote_time`/`checked_at`), Mailannahme durch Gmail (`outbox.accepted_at`), Kaufbestätigung (`positions.opened_at`) sind getrennte Spalten. Annahme durch Gmail ≠ Eingang.
