# SwingBot
Lokaler Scanner für Long-Ideen in ungehebelten US-Aktien in USD. Er prüft eine vorgegebene Watchlist je Aufruf und schreibt Vorschläge ins Terminal. Alle Vorschläge sind Einzelalternativen auf Basis desselben Kapitalbetrags. Offene Positionen und verfügbares Cash werden nicht eingelesen.

## In einer Minute ausprobieren
ZIP entpacken und im Ordner SwingBot mit Python 3.10 oder neuer starten. Windows: Bei fehlenden Zeitzonendaten zuerst `python -m pip install tzdata` ausführen. Je nach Installation heißt der Befehl python3 oder py.

    python swingbot.py --csv beispiel.csv --symbols DEMO,RUHIG,TIEF --replay 2026-11-23T20:35:00Z

Die Beispieldaten sind erfunden. Erwartet werden ein Basisausbruch für DEMO, WARTEN für RUHIG und ein höheres Tief für TIEF.

## Eigene Watchlist mit Marktdaten
Für den Online-Scan werden die Umgebungsvariablen APCA_API_KEY_ID und APCA_API_SECRET_KEY eines Alpaca-Paper-Kontos mit IEX-Datenzugang benötigt. Schlüssel nur lokal setzen. Der Scanner liest US-Handelskalender und historische Kursdaten über HTTPS.

    python swingbot.py --alpaca --symbols NVDA,MSFT,PLTR --capital 10000 --risk 0.5 --weight 25

Am aussagekräftigsten ist ein Aufruf einige Minuten nach jeder vollen Handelsstunde ab 10:30 Uhr New Yorker Zeit. Für wiederkehrende Ausführung denselben Aufruf lokal im Aufgabenplaner oder Cron hinterlegen. Der Datenfeed IEX bildet einen einzelnen Handelsplatz ab. Ergebnisse können sich insbesondere beim Volumen von konsolidierten Kursen unterscheiden. Der Scanner verbindet jeweils zwei abgeschlossene 30-Minuten-Kerzen ab regulärer US-Eröffnung. Die verbleibende halbe Stunde vor Handelsschluss entfällt. Feiertage und verkürzte Sitzungen berücksichtigt der Online-Modus über den Handelskalender. Es gibt zwei Minuten Datenpuffer.

Alternativ Kursdaten als UTF-8-CSV im Format der Beispieldatei laden (Komma als Trennzeichen, Dezimalpunkt). Eine Zeile je Symbol und abgeschlossener Stunde, end = Ende der Kerze inklusive UTC-Offset. Splitbereinigte, zeitlich lückenlose Stundenkurse der regulären Sitzung für QQQ und die Watchlist bereitstellen. Für aktuelle Daten --replay weglassen. Historische Daten nur mit ausdrücklichem Replay auswerten. Die Datenqualität einer eigenen CSV liegt beim Anwender.

## Was als Signal zählt
Die folgenden Schwellen sind eigene Modellannahmen für diese Umsetzung. QQQ dient als Nasdaq-100-Stellvertreter. Der Scanner erweitert die beiden Grundmuster um die in REGELN.md beschriebenen Regeln.

* Marktfilter: Schlusskurs von QQQ über dem einfachen Mittel der letzten 20 Stunden oder neu bestätigtes First Higher Low nach untenstehender Regel.
* First Higher Low: In 31 Stunden werden Tiefs mit zwei höheren Nachbarkerzen auf jeder Seite gesucht. Von den letzten zwei bestätigten Tiefs muss das erste bis zum zweiten das tiefste im Beobachtungsfenster sein. Das zweite liegt höher und mindestens drei Kerzen später. Der erste Schluss über dem höchsten Hoch der zweiten Tiefkerze und ihrer zwei Folgekerzen löst das Signal aus. Zwischenzeitliches Unterschreiten oder Berühren des zweiten Tiefs verwirft es. Spätestens sechs Kerzen nach dem zweiten Tief muss das Signal kommen.
* Stundenbasis: Der Kurs zu Beginn der Basis liegt über dem Schluss zehn Stunden zuvor. Die acht abgeschlossenen Basiskerzen überspannen höchstens 3 % vom Tief bis zum Hoch. Die jüngste Kerze schließt über dem Basishoch und hat mindestens das 1,2-Fache des mittleren Basisvolumens. Anpassbar mit --base-bars, --width (Prozent) und --volume (Faktor).
* Eintrittsreferenz ist der letzte bestätigte Schlusskurs. Stopp ein Cent unter dem auf Cent abgerundeten tiefsten Kurs der bislang erfassten heutigen Stundenkerzen. Stückzahl = abgerundetes Minimum aus Kapitalobergrenze / Referenz und Risikobudget / Abstand zum Stopp. Die Vorgaben gelten in USD. Bei einem abweichenden Ausführungskurs muss die Größe neu berechnet werden. Gebühren, Spreads und Kurslücken können den tatsächlichen Verlust erhöhen.
* QQQ-Daten älter als 90 Minuten sperren den Scan. Nicht übereinstimmende Zeitreihen sperren das einzelne Symbol. Bei gleichzeitigem Signal beider Setups wird das höhere Tief ausgewiesen.

Die Ausgabe ist eine Momentaufnahme. Der lokale CSV-Modus enthält reine Preissignale. Online-Kontext und Earnings-Pivot werden im Alarmdienst ergänzt. 5-Minuten-Timing, Teilverkäufe und Verwaltung laufender Trades fehlen. Die Beispielprüfung misst die Programmfunktion. Zur statistischen Güte oder Profitabilität liegen keine Backtestergebnisse vor.

## Quellen
[Siebenhaars Preiszyklus](https://stock3.com/news/dirks-depot-update-warten-auf-den-fat-pitch-17411561) · [Stundenbasis](https://stock3.com/news/die-base-im-stundenchart-handle-nur-dieses-setup-14384210) · [Risiko je Position](https://stock3.com/news/dirks-depot-update-warten-auf-die-naechste-chance-17286308) · [Alpaca-Kursdaten](https://docs.alpaca.markets/us/reference/stockbars) · [Handelskalender](https://docs.alpaca.markets/us/reference/legacycalendar)
