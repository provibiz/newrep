# Anleitung: vom leeren Cloudflare-Konto zur ersten Testmail

Der Dienst ist ein Cloudflare Worker (TypeScript) mit Cron Triggers und einer D1-Datenbank. Er gibt nur Empfehlungen und löst nie Orders aus. Sobald du etwas einrichtest, gilt zunächst `MODE=paper`: es wird protokolliert, aber **keine Mail versendet** – außer der Testmail, die du selbst auslöst.

Schritte mit **(Kosten)** verursachen laufende Kosten; vorher lies `ZUGAENGE.md`. Nichts davon wurde für dich eingerichtet.

## 0. Was du brauchst
- Node.js ≥ 20 und ein Terminal
- Cloudflare-Konto, **Workers Paid (5 USD/Monat)** – Cron-Läufe mit größerem Universum brauchen mehr CPU-Zeit als im Free-Tarif (10 ms) erlaubt ist **(Kosten)**
- Alpaca-Konto (kostenloses Paper-Konto genügt) mit API-Schlüssel
- Resend-Konto und eine **verifizierte Absenderdomain** (ohne eigene Domain darf Resend nur an die Kontoadresse senden)
- Optional: Financial-Modeling-Prep-Schlüssel (Wachstumsdaten, Episodic Pivot)

## 1. Projekt vorbereiten
```bash
cd swingpro
npm install
npm test            # 84 lokale Tests, kein Netzwerk
npm run replay      # Replay mit TESTDATEN, zeigt Beispielmails in der Konsole
npx wrangler login  # öffnet den Browser, meldet bei Cloudflare an
```

## 2. Datenbank anlegen
```bash
npx wrangler d1 create swingpro
```
Die ausgegebene `database_id` trägst du in `wrangler.jsonc` unter `d1_databases[0].database_id` ein. Dann:
```bash
npm run migrate:remote
```

## 3. Geheimnisse setzen (nie in den Chat oder in Dateien)
Jeder Befehl fragt den Wert verdeckt ab:
```bash
npx wrangler secret put ALPACA_KEY_ID
npx wrangler secret put ALPACA_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put FMP_API_KEY        # optional
npx wrangler secret put STATUS_TOKEN       # Passwort der Statusseite, mind. 16 Zeichen, z. B. Ausgabe von: openssl rand -hex 24
npx wrangler secret put TOKEN_PEPPER       # zufällig, z. B.: openssl rand -hex 32
```
Es wird nichts davon protokolliert; Fehlermeldungen werden von Schlüssel-artigen Teilen bereinigt.

## 4. Resend: Domain verifizieren
Im Resend-Dashboard die Domain (empfohlen: Subdomain wie `mail.deinedomain.de`) anlegen und die gezeigten DNS-Einträge setzen. Wichtig: Resend-CNAMEs **nicht** über den Cloudflare-Proxy („orange Wolke“) führen. Danach in `wrangler.jsonc` unter `vars`:
```jsonc
"MAIL_FROM": "SwingPro <signal@mail.deinedomain.de>",
"MAIL_TO": "du@deinedomain.de"
```

## 5. Einstellungen prüfen (`wrangler.jsonc` → `vars`)
Kapital (`CAPITAL`), Risiko je Trade (`RISK_PERCENT`, Start 0,5), Gewicht (`MAX_WEIGHT_PERCENT`, Start 25), Datenfeed (`DATA_FEED`: `iex` kostenlos; `sip` nur mit bezahlter Echtzeit-Berechtigung). Bei EUR-Depot **zusätzlich** `ACCOUNT_CURRENCY=EUR`, `FX_USD_PER_EUR`, `FX_DATE`, `FX_SOURCE` – sonst startet der Dienst nicht. Alle Variablen: `src/config.ts` und `REGELN.md`.

## 6. Deployen
```bash
npm run deploy
```
Wrangler zeigt die Adresse `https://swingpro.<dein-subdomain>.workers.dev`. Trage sie als `BASE_URL` in `wrangler.jsonc` ein (sie wird für die Bestätigungslinks gebraucht) und deploye ein zweites Mal. Cron-Änderungen können bis zu 15 Minuten brauchen.

## 7. Erste Prüfung und erste Testmail
1. `https://swingpro.<…>.workers.dev/status` öffnen. Benutzername beliebig, Passwort = `STATUS_TOKEN`.
2. **„Berechtigungen neu prüfen“** klicken. Die Tabelle zeigt, was kostenlos funktioniert (IEX, SIP-Tageskerzen, FRED) und wofür ein bezahlter Tarif nötig ist (SIP-Echtzeit, FMP-Quartalsdaten). Es wird nie stillschweigend auf einen anderen Feed umgeschaltet.
3. **„Testmail senden“** klicken. Das ist die erste echte Mail. Die Statusseite zeigt „angenommen“ vom Anbieter; die Zustellzeit im Postfach wird **nicht** gemessen.
4. **„Tageslauf“** klicken (oder auf den Cron ab 21:00 UTC warten). Die erste Befüllung des Universums kann einige Läufe dauern; der Tageslauf setzt sich selbst fort. Danach zeigt die Statusseite Universum, Ausschlüsse, Datenlücken.

## 8. Paper-Phase, dann live
Im Paper-Modus laufen alle Stufen auf echten Daten, Signale landen in der Datenbank (Signalzeit, Kurszeit, Prüfzeit getrennt), Mails werden nur protokolliert (`dry_run`). Beobachte einige Wochen Statusseite und Tagesberichte. Erst dann `MODE=live` setzen und deployen. Der tägliche Bericht kommt auch ohne Signale – bleibt er aus, ist der Dienst ausgefallen.

## 9. Bei Ausfall
Bei Fehlern sendet der Dienst **keine verspäteten Einstiegsmails** (Sendefenster `ENTRY_MAIL_MAX_AGE_MIN`, Standard 10 Minuten; danach `dropped_late`). Fehlende Läufe und konkrete Fehler stehen auf der Statusseite unter „Letzte Läufe“ und „Fehler“.

## Kosten stoppen
`npx wrangler delete` entfernt den Worker; Workers Paid kündigst du im Cloudflare-Dashboard.
