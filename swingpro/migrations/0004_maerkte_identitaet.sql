-- Mehrere Märkte (USA, Xetra), eindeutige Instrumentenidentität, Indexmitgliedschaften, Kandidatenprotokoll
ALTER TABLE assets ADD COLUMN market TEXT NOT NULL DEFAULT 'US';
ALTER TABLE assets ADD COLUMN mic TEXT;
ALTER TABLE assets ADD COLUMN isin TEXT;
ALTER TABLE assets ADD COLUMN share_class TEXT;      -- common | preferred | class_a | class_b | other
ALTER TABLE assets ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE metrics ADD COLUMN market TEXT NOT NULL DEFAULT 'US';
ALTER TABLE metrics ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE prepared ADD COLUMN market TEXT NOT NULL DEFAULT 'US';
ALTER TABLE positions ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE positions ADD COLUMN market TEXT NOT NULL DEFAULT 'US';
ALTER TABLE signals ADD COLUMN market TEXT NOT NULL DEFAULT 'US';
ALTER TABLE signals ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
-- Paper-Protokoll: Kerzenschluss (signal_time) · Datenverfügbarkeit · Triggererkennung · letzter geprüfter Kurs (quote_time/checked_at) werden getrennt festgehalten
ALTER TABLE signals ADD COLUMN data_available_at INTEGER;
ALTER TABLE signals ADD COLUMN detected_at INTEGER;

CREATE TABLE index_members (
  index_id TEXT NOT NULL, inst_key TEXT NOT NULL, member_symbol TEXT NOT NULL, source TEXT NOT NULL, asof TEXT NOT NULL,
  PRIMARY KEY (index_id, inst_key)
);
CREATE INDEX idx_index_members_inst ON index_members(inst_key);

-- Täglicher, unveränderlicher Kandidatenstand (nur INSERT): Rang, Begründung, Zeitpunkt der Aufzeichnung – vor dem weiteren Kursverlauf
CREATE TABLE candidate_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, asof TEXT NOT NULL, market TEXT NOT NULL, inst_key TEXT NOT NULL, rank INTEGER NOT NULL,
  score REAL NOT NULL, reasons TEXT NOT NULL, recorded_at INTEGER NOT NULL, UNIQUE (asof, market, inst_key)
);
CREATE INDEX idx_candidate_log_asof ON candidate_log(asof, market, rank);
