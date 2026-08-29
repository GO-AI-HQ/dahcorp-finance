CREATE TABLE IF NOT EXISTS market_intelligence_events (
  id SERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  source_class TEXT NOT NULL,
  source_url TEXT,
  source_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
  sector TEXT NOT NULL,
  event_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
  latency_class TEXT NOT NULL DEFAULT 'unknown',
  direction TEXT NOT NULL DEFAULT 'unknown',
  severity TEXT NOT NULL DEFAULT 'info',
  sentiment_score DOUBLE PRECISION,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  one_day_outcome JSONB,
  five_day_outcome JSONB,
  twenty_day_outcome JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_intelligence_occurred_idx
  ON market_intelligence_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS market_intelligence_sector_idx
  ON market_intelligence_events (sector, occurred_at DESC);

CREATE INDEX IF NOT EXISTS market_intelligence_event_type_idx
  ON market_intelligence_events (event_type, occurred_at DESC);
