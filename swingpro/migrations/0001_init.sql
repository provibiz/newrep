-- SwingPro: Grundschema. Alle Zeiten UTC-Millisekunden, sofern nicht anders angegeben.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE assets (
  symbol TEXT PRIMARY KEY, asset_id TEXT NOT NULL, name TEXT, exchange TEXT,
  included INTEGER NOT NULL, excluded_reason TEXT, first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_assets_included ON assets(included);

-- Kerzenreihen als JSON je Symbol und Zeitrahmen (inkrementell fortgeschrieben, kein Komplett-Download)
CREATE TABLE series (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, last_end INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, tf)
);

CREATE TABLE metrics (
  symbol TEXT PRIMARY KEY, asof TEXT NOT NULL, price REAL, adv_usd REAL, range_pct REAL, ret63 REAL, rs_pct REAL,
  passed INTEGER NOT NULL, reason TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_metrics_passed ON metrics(passed);

CREATE TABLE scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, run_key TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, stats TEXT, error TEXT
);
CREATE INDEX idx_scan_runs_kind ON scan_runs(kind, started_at);

CREATE TABLE errors (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, scope TEXT NOT NULL, message TEXT NOT NULL);

-- Vorbereitete Setups (Vorwarnung). id = symbol|setup|timeframe|armed_at -> ein Setup feuert höchstens einmal.
CREATE TABLE prepared (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, setup TEXT NOT NULL, timeframe TEXT NOT NULL,
  armed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, trigger_price REAL NOT NULL, stop_price REAL NOT NULL,
  state TEXT NOT NULL, state_reason TEXT, data TEXT NOT NULL, prewarn_outbox_id TEXT, signal_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX idx_prepared_state ON prepared(state, symbol);

CREATE TABLE signals (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, setups TEXT NOT NULL, signal_time INTEGER NOT NULL,
  status TEXT NOT NULL, status_reason TEXT, trigger_price REAL NOT NULL, stop_price REAL,
  observed_price REAL, quote_time INTEGER, checked_at INTEGER, shares INTEGER, planned_risk_usd REAL,
  ctx TEXT NOT NULL, outbox_id TEXT, mode TEXT NOT NULL, feed TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX idx_signals_symbol ON signals(symbol, signal_time);

-- Mail-Postausgang: id ist zugleich Idempotenzschlüssel beim Anbieter.
CREATE TABLE outbox (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, text_body TEXT NOT NULL, html_body TEXT,
  state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, provider_id TEXT, accepted_at INTEGER, error TEXT,
  created_at INTEGER NOT NULL, send_by INTEGER, signal_id TEXT
);
CREATE INDEX idx_outbox_state ON outbox(state);

CREATE TABLE positions (
  id TEXT PRIMARY KEY, signal_id TEXT NOT NULL UNIQUE, symbol TEXT NOT NULL, status TEXT NOT NULL,
  entry REAL, shares INTEGER, fees REAL NOT NULL DEFAULT 0, initial_stop REAL, stop REAL,
  opened_at INTEGER, closed_at INTEGER, shares_sold INTEGER NOT NULL DEFAULT 0,
  partial_recommended_at INTEGER, stagnation_hinted_at INTEGER, realized_pnl_usd REAL,
  needs_review INTEGER NOT NULL DEFAULT 0, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX idx_positions_status ON positions(status);

CREATE TABLE position_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, position_id TEXT NOT NULL, ts INTEGER NOT NULL, type TEXT NOT NULL,
  data TEXT NOT NULL, idem_key TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_pos_events ON position_events(position_id, ts);

-- Aktions-Links: nur der Hash wird gespeichert.
CREATE TABLE tokens (hash TEXT PRIMARY KEY, ref_id TEXT NOT NULL, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
