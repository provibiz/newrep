# SwingPro (Cloudflare)

Swing-Trading-Assistent als Cloudflare Worker: findet selbständig Aktien (Nasdaq/NYSE sowie Xetra, ohne Watchlist), meldet **Vorwarnungen** und **bestätigte Einstiege** per E-Mail und begleitet einen von dir bestätigten Kauf bis zum Ausstieg. **Empfehlungen only – Orders löst nur du aus.**

| Datei | Inhalt |
|---|---|
| `ANLEITUNG.md` | vom leeren Cloudflare-Konto zur ersten Testmail |
| `REGELN.md` | Tabelle: Quelle, Regel, Zeiteinheit, Datenbedarf, Grenzen (belegt / Modellannahme / persönliche Vorgabe) |
| `ZUGAENGE.md` | Zugänge, Datenrechte, Kosten mit Quellen und Stand |
| `ABNAHME.md` | ehrlich: lokal getestet / echte Daten / Cloudflare / offen |
| `docs/BEISPIELMAILS.md` | Vorwarnung, Einstieg, verpasster Einstieg, Teilgewinn, Ausstieg (Replay, TESTDATEN) |
| `legacy-python/` | übernommener Prototyp (Docker/Python), nur zur Nachvollziehbarkeit |

## Ablauf
```
Tageslauf (nach Börsenschluss, fortsetzbar)     Stundenscan (:36 NY nach voller Stunde)      5-Minuten-Überwachung (nur Kandidaten)
Assets → Ausschlüsse → Tageskerzen (inkrementell) → Stundenkerzen inkrementell → Setups vorbereiten   abgeschlossene 5-Min-Kerze über Auslöser?
→ Vorauswahl (Preis, Dollarumsatz, Spanne, RS)       → Vorwarnung (eigene Mail)                       → QQQ-Filter → frischer Kurs → Stopp & Stückzahl neu
→ Tages-Setups → Positionsprüfung → Tagesbericht                                                       → bestätigt | verpasst | nicht prüfbar → Mail
                                                          Kaufbestätigung per Link (POST) → 2R-Teilverkauf → Wochentief-Stopp → Ausstieg
```
Technik: Worker + Cron Triggers (`1,6,11,… 7–21 UTC` Takt für Xetra und USA, `*/10 21–23 UTC` Tageslauf), D1 (Reihen als JSON je Instrument, Läufe, Signale, Kandidatenprotokoll, Postausgang, Positionen), **Gmail API** (nur `gmail.send`, ausgehend). Jeder Lauf hat einen eindeutigen Schlüssel (`scan_runs.run_key`); Doppelversand verhindert der Postausgang (atomares Beanspruchen, kein automatisches Wiederholen bei unklarem Ausgang), Positionsereignisse haben `idem_key`.

## Befehle
```bash
npm test            # lokale Tests
npm run typecheck
npm run replay      # Replay mit klar gekennzeichneten TESTDATEN
npm run deploy      # nach ANLEITUNG.md
```
Drei getrennte Entscheidungen: **Setup vorbereitet** → **Trigger erreicht** → **Einstieg zulässig** (sonst „Nur beobachten“). Neue Pfade: Konsolidierung nach Quartalszahlen, mehrwöchige Basis, EMA-Reclaim; Nicht-US-Märkte ohne Datenabdeckung heißen „Markt nicht unterstützt“. Details und Modellannahmen: `REGELN.md`.

Zeiten in Mails: Europe/Berlin (mit Hinweis in den Wochen mit abweichender Sommerzeit), Kursstempel mit Sekunden.
