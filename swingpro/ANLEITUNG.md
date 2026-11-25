# Anleitung: vom leeren Cloudflare-Konto zum sicheren Paper-Lauf

Der Dienst ist ein Cloudflare Worker (TypeScript) mit Cron Triggers und D1-Datenbank. Er gibt nur Empfehlungen und löst nie Orders aus. Mails gehen **ausschließlich ausgehend** über die Gmail API an dich; der Bot liest, durchsucht und indexiert dein Postfach nicht. Standard ist `MODE=paper`: alles wird protokolliert, aber **keine Mail versendet** – außer der Testmail, die du selbst auslöst.

Nichts davon ist für dich eingerichtet worden. Schritte mit **(Kosten)** verursachen laufende Kosten (siehe `ZUGAENGE.md`). Secrets gibst du nur in deinem Terminal ein (`wrangler secret put`, verdeckte Abfrage) – nie im Chat, nie in Dateien.

## 0. Voraussetzungen
- Node.js ≥ 20, Terminal
- Cloudflare-Konto mit **Workers Paid, 5 USD/Monat** (Cron mit größerem Universum braucht mehr CPU-Zeit als der Free-Tarif mit 10 ms) **(Kosten)**
- Alpaca-Konto (kostenloses Paper-Konto) mit API-Schlüssel für die US-Daten
- Gmail-Konto (dein privates) und ein Google-Cloud-Projekt (kostenlos) für die Versandfreigabe
- Optional: Financial-Modeling-Prep-Schlüssel (US-Quartalsdaten, Episodic Pivot, Konsolidierung nach Zahlen)
- Für Deutschland: Xetra-Kursdaten-Zugang (siehe Schritt 7, **(Kosten)** – ohne ihn bleibt der deutsche Markt als Lücke sichtbar, es wird nichts gebucht)

## 1. Projekt vorbereiten
```bash
cd swingpro
npm install
npm test                 # 166 lokale Tests, kein Netzwerk
npm run replay           # Replay mit TESTDATEN (USA + Xetra), zeigt Beispielmails
npx tsx scripts/blindrun.ts --fixture   # Blindlauf mit nachgebauten Daten (kein Echtdaten-Nachweis)
npx wrangler login
```

## 2. Datenbank
```bash
npx wrangler d1 create swingpro        # database_id in wrangler.jsonc (d1_databases[0]) eintragen
npm run migrate:remote
```

## 3. Gmail-Freigabe einrichten (einmalig, nur ausgehender Versand)
1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen, die **Gmail API** aktivieren.
2. **OAuth-Zustimmungsbildschirm**: Typ „Extern“, dich selbst als Testnutzer eintragen, Scope **nur** `https://www.googleapis.com/auth/gmail.send` (laut Google ein „sensitive“ Scope).
   **Wichtig:** Im Status „Testing“ läuft ein Refresh-Token laut Google nach **7 Tagen** ab. Stelle den Veröffentlichungsstatus auf **„In production“** (eigene, nicht verifizierte App nur für dich; Google zeigt beim Freigeben eine Warnseite – dein eigener Account, du bestätigst sie bewusst). Das Verhalten nicht verifizierter Apps habe ich nicht in Googles Dokumentation gelesen; prüfe die aktuelle Google-Hilfe („unverified app“).
3. **OAuth-Client** vom Typ **„Desktop-App“** erzeugen. Client-ID und -Secret nur in deinem Terminal verwenden:
   ```bash
   export GMAIL_CLIENT_ID=...    export GMAIL_CLIENT_SECRET=...
   npx tsx scripts/gmail-auth.ts          # öffnet keinen Browser selbst: Adresse kopieren, freigeben
   ```
   Das Skript nutzt PKCE über `http://127.0.0.1:<Port>`, fordert Offline-Zugriff, prüft, dass **genau** `gmail.send` freigegeben wurde, und übergibt das Refresh-Token **ohne Ausgabe** per Stdin an `wrangler secret put GMAIL_REFRESH_TOKEN`. Mit `--no-wrangler` läuft nur der Trockenlauf.
4. Client-ID und -Secret als Secrets speichern:
   ```bash
   npx wrangler secret put GMAIL_CLIENT_ID
   npx wrangler secret put GMAIL_CLIENT_SECRET
   ```
5. `wrangler.jsonc` → `vars`: `MAIL_FROM` (deine Gmail-Adresse, z. B. `SwingPro <du@gmail.com>`; Gmail setzt den Absender auf dein Konto) und `MAIL_TO` (Zieladresse, kann dieselbe sein).

**Sichere Speicherung:** Refresh-Token, Client-Secret und alle Schlüssel liegen nur als Cloudflare Secrets. Access-Tokens (ca. 1 Stunde gültig) werden bei Bedarf erneuert und nur im Speicher des Workers gehalten, nie in der Datenbank, nie in Logs; Fehlertexte werden von Schlüsselmustern bereinigt.

**Token-Erneuerung:** automatisch bei jedem Versand (Refresh-Token → Access-Token). Das Refresh-Token selbst bleibt gültig, bis es widerrufen wird.

**Wenn die Freigabe widerrufen wird** (du entziehst den Zugriff unter myaccount.google.com/permissions, Passwortänderung bei Gmail-Scopes, mehr als sechs Monate ungenutzt, „Testing“-Ablauf nach 7 Tagen, Client gelöscht): Gmail antwortet `invalid_grant`. Der Dienst
- sendet nichts mehr und lässt Mails im Postausgang **warten** (kein Versuch wird verbraucht),
- zeigt auf der Statusseite rot „Freigabe-Problem … neu autorisieren“,
- **verwirft abgelaufene Einstiegsmails** nach `ENTRY_MAIL_MAX_AGE_MIN` (10 Min) – nach der Neu-Autorisierung werden keine verspäteten Einstiege nachgeschickt; Tagesberichte (12 h) werden noch nachgesendet,
- scannt und protokolliert weiter (Paper-Protokoll bleibt vollständig).
Neu autorisieren: Schritt 3 wiederholen (altes Refresh-Token wird durch `secret put` ersetzt).

**Doppelversand:** Die Gmail API hat keinen Idempotenzschlüssel. Der Postausgang beansprucht jede Mail atomar und wiederholt bei **unklarem Ausgang** (Netzwerkabbruch) bewusst nicht automatisch (Status `unknown` auf der Statusseite): lieber eine fehlende als eine doppelte Einstiegsmail.

## 4. Übrige Secrets
```bash
npx wrangler secret put ALPACA_KEY_ID
npx wrangler secret put ALPACA_SECRET
npx wrangler secret put FMP_API_KEY            # optional
npx wrangler secret put TWELVEDATA_API_KEY     # nur für den deutschen Markt (Schritt 7)
npx wrangler secret put STATUS_TOKEN           # Passwort der Statusseite, ≥ 16 Zeichen (z. B. openssl rand -hex 24)
npx wrangler secret put TOKEN_PEPPER           # zufällig, z. B. openssl rand -hex 32
```

## 5. Einstellungen (`wrangler.jsonc` → `vars`)
`CAPITAL`, `RISK_PERCENT` (0,5), `MAX_WEIGHT_PERCENT` (25), `MAX_STOP_PCT` (10), `DATA_FEED` (`iex` kostenlos), `MARKETS` (`US`; `US,DE` nur mit Xetra-Zugang und `FX_USD_PER_EUR`, `FX_DATE`, `FX_SOURCE`). Marktvorgabe: Standard ist die **automatische Entscheidung aus der Marktlage** (`AUTO_STANCE=true`), keine tägliche Freigabe nötig. Alle Variablen: `src/config.ts`, Bedeutung: `REGELN.md`.

## 6. Deployen (erst nach deiner Freigabe) und Cron
```bash
npm run deploy
```
Die Adresse `https://swingpro.<subdomain>.workers.dev` als `BASE_URL` eintragen (für Bestätigungslinks) und ein zweites Mal deployen. Cron-Änderungen brauchen bis zu 15 Minuten.

## 7. Deutscher Markt (optional, nur mit Zugang)
Ohne Zugang zeigt die Statusseite die genaue Lücke („Datenzugang fehlt: Xetra-Kursdaten … benötigt: …“). Laut Preisseite von Twelve Data (Stand 25.11.2026) liefert „Grow“ (29 USD/Monat) „EOD global equities“, „Pro“ (99 USD/Monat) „Real-time EU market data“; ob Xetra-5-Minuten-Kerzen in deinem Tarif enthalten sind, ist **nicht verifiziert** – teste vor dem Buchen mit der Berechtigungsprobe (Statusseite). Der deutsche Vormittagsscan braucht Intraday mit geringer Verzögerung. ISIN-Felder kosten bei Twelve Data ein teures Add-on; ohne ISIN wird das Instrument über MIC + Mnemonic + Name geführt (Statusseite zeigt „ISIN fehlt“).

## 8. Schrittfolge bis zum sicheren Paper-Lauf
1. Schritte 1–5 (ohne Deployment, nichts kostet).
2. Auf Wunsch: Workers Paid abschließen (5 USD) → Schritt 6 deployen. `MODE` bleibt `paper`.
3. Statusseite öffnen (`/status`, Passwort = `STATUS_TOKEN`) → „Berechtigungen neu prüfen“. Prüfen: Alpaca, SIP-Tageskerzen, FRED, FMP, ggf. Xetra.
4. „Testmail senden“ (die erste echte Mail; Statusseite zeigt „von Gmail angenommen“, **nicht** den Eingang – den prüfst du selbst im Postfach/auf dem Handy).
5. „Tageslauf“ anstoßen (oder Cron ab 21:00 UTC abwarten). Der erste Lauf füllt das Universum über mehrere Takte; danach zeigt die Statusseite je Markt: verfügbar, ausgeschlossen, Datenlücken, Abdeckung je Index, auf Setups geprüft.
6. Mehrere Wochen Paper-Betrieb: Kandidaten, Marken, Signale und Entscheidungen stehen im **Paper-Protokoll** (Kerzenschluss, Datenverfügbarkeit, Triggererkennung, letzter Kurs, Mailannahme, Kaufbestätigung getrennt). `candidate_log` ist unveränderlich.
7. Erst danach `MODE=live` (nach deiner ausdrücklichen Entscheidung).

## 9. Marktvorgabe
Normalbetrieb automatisch. Eine manuelle Vorgabe (`offen`/`selektiv`/`cash`, je Markt oder für alle) setzt du auf der Statusseite **mit Begründung und Ablaufzeit** (höchstens 14 Tage); danach gilt wieder die automatische Entscheidung. Bei veralteten oder fehlenden Marktdaten gilt der Standard `cash` (`AUTO_STALE_STANCE`), nie eine Freigabe.

## Kosten stoppen
`npx wrangler delete`; Workers Paid im Cloudflare-Dashboard kündigen; Gmail-Freigabe unter myaccount.google.com/permissions entziehen.
