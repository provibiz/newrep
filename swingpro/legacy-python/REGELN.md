# Signalregeln und Grenzen
Alle Alarme setzen den bisherigen QQQ-Marktfilter voraus. Modellparameter sind Entscheidungen für diesen Scanner. Siebenhaars Grafik nennt sieben Setups, veröffentlicht aber keine eindeutige maschinelle Definition aller sieben. Treffen mehrere Muster zu, nennt eine Meldung alle Treffer.

| Muster | Eigene prüfbare Definition |
|---|---|
| Undercut & Rally | Stundentief unter dem Tief der vorigen elf Kerzen, Schluss wieder darüber und über dem vorigen Schluss. |
| First Higher Low | Bestätigte lokale Tiefpunkte, höheres zweites Tief und Schluss über Bestätigungsmarke. Details in ANLEITUNG.md. |
| Wedge Pop | Zwei Vierstundenblöcke. Der zweite hat niedrigere Hochs und Tiefs, aber kleinere Handelsspanne. Anschließend Schluss über dessen Hoch bei erhöhtem Volumen gegenüber diesem Block. |
| EMA-Crossback | Bei steigendem EMA20 lag der vorangehende Schluss über dem EMA. Die neue Stunde berührt bzw. unterschreitet diesen vorherigen EMA und schließt über dem Hoch der Vorstunde. EMA auf 31-Stunden-Fenster initialisiert. |
| Base’n Break | Kursanstieg um mindestens 3 % in fünf Stunden vor bzw. bis zum Beginn der kurzen Basis. Vier Stunden mit maximal 2,5 % Spanne, dann Schluss über deren Hoch. |
| Base Breakout | Ausbruch aus längerer Stundenbasis. Standard acht Kerzen, höchstens 3 % Spanne, mindestens 1,2-faches Basisvolumen, vorheriger Anstieg. |
| Episodic Pivot | Teilmodell für Quartalszahlen. Erste reguläre Stunde, Eröffnung mindestens 8 % über dem letzten regulären Halbstundenschluss des Vortags, Schluss mindestens auf Eröffnung, mindestens doppeltes Medianvolumen der letzten fünf bis zehn vergleichbaren Eröffnungsstunden. FMP muss tatsächliches EPS für aktuellen oder vorherigen Handelstag melden. Zeitliche Nähe belegt keine Kausalität. Andere Nachrichten werden nicht untersucht. |

## Rollen der zwei weiteren Ansätze
Baron: Vortagesschluss des tatsächlichen S&P 500 und einfaches Mittel der letzten 200 verfügbaren Tagesschlusskurse (FRED SP500). Bei einer fehlenden jüngsten Sitzung Meldung als fehlend. Angezeigt als Kontext, keine zusätzliche Sperre und kein Hebelprodukt. Quellen: https://fred.stlouisfed.org/series/SP500 und https://stock3.com/news/wie-gut-dass-wir-ausgestiegen-sind-17406998

Giering: Eigenes Teilmodell der wachstumsorientierten Aktienauswahl. Für jeden technischen Treffer Vergleich des letzten veröffentlichten Quartals mit demselben Geschäftsquartal des Vorjahrs. Ab 20 % Umsatzwachstum und 25 % Wachstum des verwässerten Gewinns je Aktie erscheint „Wachstumskandidat“. Positive Vorjahresbasen und gleiche Berichtswährung erforderlich. Bei jüngsten Daten älter als 180 Tage, fehlenden Rechten oder unbrauchbarem Vergleich bleibt das Urteil offen. Erst am Folgetag eines Filings verwendbar. Das Label priorisiert die Prüfung eines möglichen Läufers. Charttechnik, institutionelle Beteiligung und andere CAN-SLIM-Komponenten werden dadurch nicht vollständig abgebildet.

FMP_API_KEY ist für Earnings und Quartalsdaten erforderlich. Datenrechte und mögliche Gebühren beim Anbieter prüfen. Die neue API-Abfrage wird nur für technische Treffer bzw. für Kurslücken mit passendem Volumen ausgeführt. Bei Ausfall bleibt ein preisbasierter Treffer zustellbar. Ein Earnings-Pivot braucht eine erfolgreiche Bestätigung. FRED und Finanzdaten werden pro Prozess und Tag nach erfolgreichem Abruf zwischengespeichert. Historische Revisionen machen die aktuellen Schnittstellen ungeeignet für einen ungeprüften historischen Performancevergleich.

Grundlagen: https://stock3.com/news/dirks-depot-update-warten-auf-den-fat-pitch-17411561 · https://stock3.com/experten/lisa-giering-396541 · https://site.financialmodelingprep.com/developer/docs/stable/income-statement · https://site.financialmodelingprep.com/developer/docs/stable/earnings-company
