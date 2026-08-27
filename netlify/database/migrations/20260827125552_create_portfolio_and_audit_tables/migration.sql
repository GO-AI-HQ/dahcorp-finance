CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY,
	"external_id" text NOT NULL,
	"broker" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"cash" double precision DEFAULT 0 NOT NULL,
	"allocation_eligible" boolean DEFAULT false NOT NULL,
	"trade_eligible" boolean DEFAULT false NOT NULL,
	"data_quality" text DEFAULT 'mock' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" serial PRIMARY KEY,
	"account_external_id" text NOT NULL,
	"date" text NOT NULL,
	"amount" double precision NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" serial PRIMARY KEY,
	"symbol" text NOT NULL,
	"effective_date" text NOT NULL,
	"type" text NOT NULL,
	"ratio" double precision,
	"new_symbol" text,
	"cash_per_share" double precision,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" serial PRIMARY KEY,
	"account_external_id" text NOT NULL,
	"symbol" text NOT NULL,
	"shares" double precision DEFAULT 0 NOT NULL,
	"cost_basis_total" double precision DEFAULT 0 NOT NULL,
	"tactical_cost_basis_total" double precision,
	"sleeve" text DEFAULT 'unclassified' NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"opened_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_events" (
	"id" serial PRIMARY KEY,
	"account_external_id" text NOT NULL,
	"symbol" text NOT NULL,
	"pay_date" text NOT NULL,
	"gross_amount" double precision NOT NULL,
	"shares_at_record" double precision DEFAULT 0 NOT NULL,
	"reinvested" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_snapshots" (
	"id" serial PRIMARY KEY,
	"as_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forward_monthly_income" double precision NOT NULL,
	"income_engine_capital" double precision NOT NULL,
	"blended_distribution_rate" double precision,
	"portfolio_value" double precision NOT NULL,
	"basis" text DEFAULT 'avg13w' NOT NULL,
	"contains_mock_data" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_previews" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recommendation_id" integer,
	"account_external_id" text NOT NULL,
	"broker" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"notional" double precision,
	"quantity" double precision,
	"order_type" text DEFAULT 'market' NOT NULL,
	"limit_price" double precision,
	"origin" text DEFAULT 'manual' NOT NULL,
	"sleeve" text DEFAULT 'unclassified' NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"approved_by_risk" boolean DEFAULT false NOT NULL,
	"allowed_notional" double precision DEFAULT 0 NOT NULL,
	"findings" jsonb NOT NULL,
	"impact" jsonb NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"available_capital" double precision DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'claude' NOT NULL,
	"model" text,
	"headline" text DEFAULT '' NOT NULL,
	"confidence" text DEFAULT 'unknown' NOT NULL,
	"brief" jsonb NOT NULL,
	"portfolio_snapshot" jsonb NOT NULL,
	"deterministic_outcome" jsonb NOT NULL,
	"user_action" text DEFAULT 'pending' NOT NULL,
	"user_note" text,
	"acted_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_external_id_idx" ON "accounts" ("external_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_category_idx" ON "audit_log" ("category");--> statement-breakpoint
CREATE INDEX "contributions_date_idx" ON "contributions" ("date");--> statement-breakpoint
CREATE INDEX "corporate_actions_symbol_idx" ON "corporate_actions" ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_account_symbol_idx" ON "holdings" ("account_external_id","symbol");--> statement-breakpoint
CREATE INDEX "holdings_symbol_idx" ON "holdings" ("symbol");--> statement-breakpoint
CREATE INDEX "income_events_pay_date_idx" ON "income_events" ("pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "income_events_natural_idx" ON "income_events" ("account_external_id","symbol","pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "income_snapshots_as_of_idx" ON "income_snapshots" ("as_of");--> statement-breakpoint
CREATE INDEX "order_previews_created_at_idx" ON "order_previews" ("created_at");--> statement-breakpoint
CREATE INDEX "recommendations_created_at_idx" ON "recommendations" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_idx" ON "settings" ("key");