import { boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * DAHCorp Finance persistence.
 *
 * What lives here: things the investor owns and edits (accounts, positions,
 * received income, contributions, corporate actions), the deterministic policy
 * (settings), and the audit record (recommendations, order previews, events).
 *
 * What deliberately does not live here: prices, quotes and distribution
 * histories. Those are fetched from a market-data provider on each request so
 * the dashboard can never show a stale number it believes is current.
 */

/** Single-row-per-key JSON store for the strategy config and UI preferences. */
export const settings = pgTable(
  'settings',
  {
    id: serial().primaryKey(),
    key: text().notNull(),
    value: jsonb().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('settings_key_idx').on(table.key)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: serial().primaryKey(),
    externalId: text('external_id').notNull(),
    broker: text().notNull(),
    name: text().notNull(),
    type: text().notNull(),
    role: text().notNull().default(''),
    cash: doublePrecision().notNull().default(0),
    allocationEligible: boolean('allocation_eligible').notNull().default(false),
    tradeEligible: boolean('trade_eligible').notNull().default(false),
    dataQuality: text('data_quality').notNull().default('mock'),
    archived: boolean().notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('accounts_external_id_idx').on(table.externalId)],
);

export const holdings = pgTable(
  'holdings',
  {
    id: serial().primaryKey(),
    accountExternalId: text('account_external_id').notNull(),
    symbol: text().notNull(),
    shares: doublePrecision().notNull().default(0),
    costBasisTotal: doublePrecision('cost_basis_total').notNull().default(0),
    /** Separate basis for tactical harvest math when it differs from the tax lot. */
    tacticalCostBasisTotal: doublePrecision('tactical_cost_basis_total'),
    sleeve: text().notNull().default('unclassified'),
    legacy: boolean().notNull().default(false),
    /**
     * CONFIRMED | SIMULATED | UNVERIFIED. Only CONFIRMED holdings may drive a
     * live risk, concentration, harvest or allocation decision. Rows the
     * investor enters are CONFIRMED by default; demonstration fixtures and
     * anything awaiting a brokerage adapter are marked otherwise.
     */
    verification: text().notNull().default('CONFIRMED'),
    openedAt: text('opened_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('holdings_account_symbol_idx').on(table.accountExternalId, table.symbol),
    index('holdings_symbol_idx').on(table.symbol),
  ],
);

/** Cash actually received. The audited income number, as opposed to the model. */
export const incomeEvents = pgTable(
  'income_events',
  {
    id: serial().primaryKey(),
    accountExternalId: text('account_external_id').notNull(),
    symbol: text().notNull(),
    payDate: text('pay_date').notNull(),
    grossAmount: doublePrecision('gross_amount').notNull(),
    sharesAtRecord: doublePrecision('shares_at_record').notNull().default(0),
    reinvested: boolean().notNull().default(true),
    source: text().notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('income_events_pay_date_idx').on(table.payDate),
    uniqueIndex('income_events_natural_idx').on(table.accountExternalId, table.symbol, table.payDate),
  ],
);

export const contributions = pgTable(
  'contributions',
  {
    id: serial().primaryKey(),
    accountExternalId: text('account_external_id').notNull(),
    date: text().notNull(),
    amount: doublePrecision().notNull(),
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('contributions_date_idx').on(table.date)],
);

export const corporateActions = pgTable(
  'corporate_actions',
  {
    id: serial().primaryKey(),
    symbol: text().notNull(),
    effectiveDate: text('effective_date').notNull(),
    type: text().notNull(),
    ratio: doublePrecision(),
    newSymbol: text('new_symbol'),
    cashPerShare: doublePrecision('cash_per_share'),
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('corporate_actions_symbol_idx').on(table.symbol)],
);

/**
 * Every Claude recommendation, with the portfolio and market snapshot it was
 * made against and the deterministic verdict that followed. This is the record
 * that makes it possible to judge, later, whether the agent added value.
 */
export const recommendations = pgTable(
  'recommendations',
  {
    id: serial().primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    question: text().notNull(),
    availableCapital: doublePrecision('available_capital').notNull().default(0),
    /** 'claude' or 'deterministic' when the model was unavailable. */
    source: text().notNull().default('claude'),
    model: text(),
    headline: text().notNull().default(''),
    confidence: text().notNull().default('unknown'),
    /** Full structured brief. */
    brief: jsonb().notNull(),
    /** Portfolio snapshot as presented to the model. */
    portfolioSnapshot: jsonb('portfolio_snapshot').notNull(),
    /** Deterministic baseline plan and risk-engine decision. */
    deterministicOutcome: jsonb('deterministic_outcome').notNull(),
    /** 'pending' | 'approved' | 'rejected' | 'edited' | 'expired'. */
    userAction: text('user_action').notNull().default('pending'),
    userNote: text('user_note'),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    /** Outcome recorded later, for retrospective evaluation. */
    result: jsonb(),
  },
  (table) => [index('recommendations_created_at_idx').on(table.createdAt)],
);

/** Proposed orders. Nothing in this build ever moves one to 'placed'. */
export const orderPreviews = pgTable(
  'order_previews',
  {
    id: serial().primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    recommendationId: integer('recommendation_id'),
    accountExternalId: text('account_external_id').notNull(),
    broker: text().notNull(),
    symbol: text().notNull(),
    side: text().notNull(),
    notional: doublePrecision(),
    quantity: doublePrecision(),
    orderType: text('order_type').notNull().default('market'),
    limitPrice: doublePrecision('limit_price'),
    origin: text().notNull().default('manual'),
    sleeve: text().notNull().default('unclassified'),
    rationale: text().notNull().default(''),
    approvedByRisk: boolean('approved_by_risk').notNull().default(false),
    allowedNotional: doublePrecision('allowed_notional').notNull().default(0),
    findings: jsonb().notNull(),
    impact: jsonb().notNull(),
    /** 'preview' | 'approved' | 'rejected' | 'expired'. Never 'placed'. */
    status: text().notNull().default('preview'),
  },
  (table) => [index('order_previews_created_at_idx').on(table.createdAt)],
);

/** Append-only audit trail: sessions, config changes, errors, agent calls. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial().primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    category: text().notNull(),
    action: text().notNull(),
    severity: text().notNull().default('info'),
    message: text().notNull().default(''),
    detail: jsonb(),
  },
  (table) => [index('audit_log_created_at_idx').on(table.createdAt), index('audit_log_category_idx').on(table.category)],
);

/**
 * Periodic income snapshots. Income Velocity needs a prior measurement to
 * separate market-driven change from contribution- and DRIP-driven change, so
 * the figures are recorded as they are computed.
 */
export const incomeSnapshots = pgTable(
  'income_snapshots',
  {
    id: serial().primaryKey(),
    asOf: text('as_of').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    forwardMonthlyIncome: doublePrecision('forward_monthly_income').notNull(),
    incomeEngineCapital: doublePrecision('income_engine_capital').notNull(),
    blendedDistributionRate: doublePrecision('blended_distribution_rate'),
    portfolioValue: doublePrecision('portfolio_value').notNull(),
    basis: text().notNull().default('avg13w'),
    containsMockData: boolean('contains_mock_data').notNull().default(true),
  },
  (table) => [uniqueIndex('income_snapshots_as_of_idx').on(table.asOf)],
);
