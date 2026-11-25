-- Drei getrennte Entscheidungen: Setup vorbereitet (prepared) · technischer Trigger erreicht (signals.signal_time)
-- · Einstieg nach Markt- und Risikoregeln zulässig (signals.permission). Jede Zeile trägt Herkunft/Quelle.
ALTER TABLE prepared ADD COLUMN origin TEXT NOT NULL DEFAULT 'model';   -- model = Modellentscheidung des Bots, idea = veröffentlichte Watchlist-Idee (extern)
ALTER TABLE prepared ADD COLUMN source TEXT;
ALTER TABLE signals ADD COLUMN permission TEXT;                          -- permitted | watch_only | NULL (z. B. verpasst)
ALTER TABLE signals ADD COLUMN permission_reasons TEXT;
ALTER TABLE signals ADD COLUMN prepared_at INTEGER;
ALTER TABLE signals ADD COLUMN origin TEXT NOT NULL DEFAULT 'model';

-- Marktbreite je Symbol (aus den Tageskerzen, 52-Wochen-Fenster)
ALTER TABLE metrics ADD COLUMN nh INTEGER;     -- neues 52-Wochen-Hoch am letzten Handelstag
ALTER TABLE metrics ADD COLUMN nl INTEGER;
ALTER TABLE metrics ADD COLUMN a50 INTEGER;    -- Schluss über SMA50
ALTER TABLE metrics ADD COLUMN a200 INTEGER;
ALTER TABLE metrics ADD COLUMN n252 INTEGER;   -- Anzahl Handelstage Historie (für die Aufnahme in die Breite nötig: ≥ 252)

-- Täglich bewertete Marktlage (getrennt vom einzelnen Chart)
CREATE TABLE regime (asof TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
