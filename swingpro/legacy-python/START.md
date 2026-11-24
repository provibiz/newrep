# SwingAlarm auf einem dauerhaft laufenden Rechner
Der Dienst lädt an jedem US-Handelstag die veröffentlichte S&P-500-Titelliste von datasets/s-and-p-500-companies. Die Zugehörigkeit zum Index ist die Auswahlregel für große US-Aktien. Er prüft alle gelieferten Titel mit genügend Daten. Umfang, US-Dollar als Rechenwährung, QQQ-Marktfilter und Stundentakt sind Modellentscheidungen. Die sieben Stunden-Setups und die Daten für Baron und das Giering-Modell stehen in REGELN.md. FMP_API_KEY in .env setzen und beim Datenanbieter den Zugang zu Quartalsberichten und Earnings prüfen. Ohne diesen Zugang fehlen Wachstumsurteil und Ereignisbestätigung. Die Daten des S&P 500 kommen von FRED. Aktien außerhalb des Index und 5-Minuten-Einstiege werden nicht erfasst. Der dort beschriebene Einzelaufruf ist zusätzlich für Offline-Tests enthalten.

## Einmal einrichten
1. ZIP auf einen dauerhaft eingeschalteten Linux-Rechner mit installiertem Docker und Docker Compose entpacken. Keine Freigabe eingehender Ports erforderlich. Docker muss nach einem Neustart mitstarten.
2. In Alpaca ein Paper-Konto anlegen und dessen API-Schlüssel erzeugen. Für die Kursdaten verwendet der Dienst den IEX-Feed, für die Handelszeiten den US-Börsenkalender.
3. Versandweg wählen. Für E-Mail in Resend eine Absenderdomain verifizieren und einen API-Key mit Sendeberechtigung erzeugen. In .env ALERT_CHANNEL=email, RESEND_API_KEY, MAIL_FROM (Adresse der verifizierten Domain) und MAIL_TO (dein Postfach) eintragen. Telegram-Felder können leer bleiben. Die Testnachricht in Schritt 5 prüft den gewählten Versandweg.
   Alternativ ALERT_CHANNEL=telegram wählen. In Telegram bei @BotFather mit /newbot einen Bot anlegen. Diesem eigenen Bot anschließend im privaten Chat /start schicken. Für die Chat-ID kann man das untenstehende lokale Hilfsprogramm verwenden.
4. env.vorlage im Ordner SwingAlarm in .env kopieren und dort die Alpaca-Felder und die Felder des gewählten Versandwegs befüllen. Bei Bedarf Kapital in USD, Risikobudget und maximale Positionsgröße ändern. Die .env privat halten.
5. Im Ordner SwingAlarm ausführen:

       docker compose up -d --build
       docker compose logs --tail 30
       docker compose exec swingalarm python -c "from alarm import notify; notify('SwingAlarm: Testnachricht')"

   Den Eingang der Testnachricht im Postfach bzw. Chat prüfen. Die erste abgeschlossene Analyse erscheint im Protokoll. Beim Betrieb ohne Docker kann man die Variablen aus der Vorlage in der Umgebung setzen und mit Python 3.10+ dauerhaft python alarm.py laufen lassen.
6. Stoppen mit docker compose down. Nach Änderungen an .env erneut docker compose up -d ausführen. Das benannte Volume speichert bestätigte Zustellungen und abgeschlossene Scanblöcke.

## Eigene Telegram-Chat-ID ermitteln
Lokal python chat_id.py starten, den Token verdeckt eingeben und die ausgegebenen privaten Chats dem eigenen Namen zuordnen. Wenn nichts erscheint, dem Bot eine neue Nachricht schicken und erneut versuchen. Für diesen Dienst einen eigenen Bot verwenden.

## Wann kommt eine Meldung?
Der erste Scan beginnt ab 10:32 Uhr New Yorker Zeit für die Kerze bis 10:30 Uhr. Weitere Scans laufen stündlich bis zum Schluss der letzten vollständigen Stunde (regulär 15:30). Die verbleibende halbe Handelsstunde wird ausgelassen. Kalender und Sommerzeit werden berücksichtigt. Ohne Treffer wird keine Nachricht versendet. Im Log stehen Datenlücken, Fehler und die Summen der in diesem Durchlauf neu abgearbeiteten Blöcke. Fehlgeschlagene Abrufe werden minütlich bis Minute 49 wieder versucht. Verspätete Signale werden verworfen. Nach einem Ausfall können deshalb Alarme fehlen. Bei unterbrochener Verbindung unmittelbar nach Telegram-Annahme kann eine Nachricht doppelt eintreffen.

Es gibt keine Brokeranbindung zur Orderausführung. Die angezeigte Stückzahl wird für jeden Vorschlag einzeln aus dem konfigurierten Kapital berechnet. Vor einer Order aktuellen Kurs, vorhandene Positionen und verfügbares Kapital prüfen. Die Trefferquote der Modellregeln ist ungetestet.
