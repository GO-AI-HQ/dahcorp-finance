CREATE TABLE IF NOT EXISTS "shadow_decisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "market_date" text NOT NULL,
  "fingerprint" text NOT NULL,
  "strategy" text NOT NULL,
  "symbol" text NOT NULL,
  "action" text NOT NULL,
  "account_external_id" text,
  "price" double precision DEFAULT 0 NOT NULL,
  "score" double precision DEFAULT 0 NOT NULL,
  "suggested_notional" double precision DEFAULT 0 NOT NULL,
  "rationale" text DEFAULT '' NOT NULL,
  "model_source" text DEFAULT 'deterministic' NOT NULL,
  "model" text,
  "signals" jsonb NOT NULL,
  "risk_verdict" jsonb,
  "status" text DEFAULT 'shadow' NOT NULL,
  "outcome" jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS "shadow_decisions_fingerprint_idx"
  ON "shadow_decisions" USING btree ("fingerprint");
CREATE INDEX IF NOT EXISTS "shadow_decisions_created_at_idx"
  ON "shadow_decisions" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "shadow_decisions_market_date_idx"
  ON "shadow_decisions" USING btree ("market_date");
CREATE INDEX IF NOT EXISTS "shadow_decisions_symbol_idx"
  ON "shadow_decisions" USING btree ("symbol");
