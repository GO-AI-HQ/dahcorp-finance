/**
 * DAHCorp Finance — calculation scopes and holding verification.
 *
 * Phase 1.1 introduces an explicit answer to the question "which capital is
 * this number about?". Before this module every calculation ran against the
 * whole household portfolio, which meant a Roth IRA dividend ETF and a
 * Coverdell REIT diluted the modeled distribution rate of the taxable income
 * engine — and therefore inflated the capital required to reach the $500 per
 * month objective.
 *
 * Pure and deterministic like the rest of `src/core`: no prices, no I/O.
 */

import type { Account, AccountType, Sleeve } from './types.js';

/**
 * The three scopes a calculation can be expressed in.
 *
 * - `TAXABLE_INCOME_ENGINE` — taxable accounts, income-engine sleeve only.
 *   This is the sleeve that funds the $150 / $500 / $1,000 monthly objective
 *   and it is the default for every income calculation.
 * - `ALL_TAXABLE` — every taxable-account position, whatever the sleeve.
 * - `ENTIRE_PORTFOLIO` — every account, including Roth IRA and education.
 */
export type CalculationScope = 'TAXABLE_INCOME_ENGINE' | 'ALL_TAXABLE' | 'ENTIRE_PORTFOLIO';

export const CALCULATION_SCOPES: CalculationScope[] = [
  'TAXABLE_INCOME_ENGINE',
  'ALL_TAXABLE',
  'ENTIRE_PORTFOLIO',
];

export const CALCULATION_SCOPE_LABELS: Record<CalculationScope, string> = {
  TAXABLE_INCOME_ENGINE: 'Taxable Income Engine',
  ALL_TAXABLE: 'All Taxable',
  ENTIRE_PORTFOLIO: 'Entire Portfolio',
};

export const CALCULATION_SCOPE_DESCRIPTIONS: Record<CalculationScope, string> = {
  TAXABLE_INCOME_ENGINE:
    'Taxable accounts, income-engine sleeve only. The capital that funds the monthly income objective.',
  ALL_TAXABLE: 'Every position held in a taxable account, across all sleeves.',
  ENTIRE_PORTFOLIO:
    'Every account including Roth IRA and education. Long-term holdings are included and will dilute income rates.',
};

/** Narrowest scope first, so `scopeRank` can compare breadth. */
const SCOPE_RANK: Record<CalculationScope, number> = {
  TAXABLE_INCOME_ENGINE: 0,
  ALL_TAXABLE: 1,
  ENTIRE_PORTFOLIO: 2,
};

export function scopeRank(scope: CalculationScope): number {
  return SCOPE_RANK[scope];
}

export function parseCalculationScope(value: unknown): CalculationScope | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (CALCULATION_SCOPES as string[]).includes(upper) ? (upper as CalculationScope) : null;
}

/**
 * Whether a holding's ownership and cost basis have been verified.
 *
 * Phase 1 seeds two confirmed positions (NVDY and YMAG). Everything else in
 * the fixture set exists to demonstrate calculations and must never trigger a
 * live decision until a brokerage adapter verifies it.
 */
export type VerificationStatus = 'CONFIRMED' | 'SIMULATED' | 'UNVERIFIED';

export const VERIFICATION_STATUSES: VerificationStatus[] = ['CONFIRMED', 'SIMULATED', 'UNVERIFIED'];

export function parseVerificationStatus(value: unknown): VerificationStatus | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (VERIFICATION_STATUSES as string[]).includes(upper)
    ? (upper as VerificationStatus)
    : null;
}

/**
 * Anything without an explicit status is treated as CONFIRMED.
 *
 * Defaulting to CONFIRMED keeps hand-entered and adapter-sourced holdings
 * behaving exactly as they did before Phase 1.1; the fixtures opt *into*
 * SIMULATED explicitly.
 */
export function verificationOf(holding: { verification?: VerificationStatus | null }): VerificationStatus {
  return holding.verification ?? 'CONFIRMED';
}

/** Only CONFIRMED holdings may drive a live decision. */
export function isVerified(status: VerificationStatus): boolean {
  return status === 'CONFIRMED';
}

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  CONFIRMED: 'Confirmed',
  SIMULATED: 'Simulated',
  UNVERIFIED: 'Unverified',
};

/**
 * Prefix a trigger label with its verification status, e.g. an ARMED harvest
 * rule on a simulated position reads `SIMULATED — ARMED: …`.
 */
export function decorateTriggerLabel(status: VerificationStatus, label: string): string {
  return isVerified(status) ? label : `${status} — ${label}`;
}

/** Which account types each scope admits. */
const SCOPE_ACCOUNT_TYPES: Record<CalculationScope, AccountType[] | null> = {
  TAXABLE_INCOME_ENGINE: ['taxable'],
  ALL_TAXABLE: ['taxable'],
  ENTIRE_PORTFOLIO: null,
};

export function accountInScope(account: Pick<Account, 'type'>, scope: CalculationScope): boolean {
  const types = SCOPE_ACCOUNT_TYPES[scope];
  return types == null || types.includes(account.type);
}

/** Sleeves the income engine is built from. */
export const INCOME_ENGINE_SLEEVE: Sleeve = 'income_engine';

/** Whether a sleeve is admitted by a scope, independent of the account. */
export function sleeveInScope(sleeve: Sleeve, scope: CalculationScope): boolean {
  if (scope === 'TAXABLE_INCOME_ENGINE') return sleeve === INCOME_ENGINE_SLEEVE;
  return true;
}

/** Whether a position belongs to a scope, given its account type and sleeve. */
export function positionInScope(
  position: { accountType: AccountType; sleeve: Sleeve },
  scope: CalculationScope,
): boolean {
  return accountInScope({ type: position.accountType }, scope) && sleeveInScope(position.sleeve, scope);
}

/**
 * Human-readable reason a position sits outside the selected scope, or null
 * when it is inside. Surfaced in the UI so an excluded holding never looks
 * like a missing holding.
 */
export function scopeExclusionReason(
  position: { accountType: AccountType; sleeve: Sleeve },
  scope: CalculationScope,
): string | null {
  if (!accountInScope({ type: position.accountType }, scope)) {
    return `${ACCOUNT_TYPE_LABELS[position.accountType]} account is outside the ${CALCULATION_SCOPE_LABELS[scope]} scope.`;
  }
  if (!sleeveInScope(position.sleeve, scope)) {
    return `Sleeve is not the income engine, so it is outside the ${CALCULATION_SCOPE_LABELS[scope]} scope.`;
  }
  return null;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  taxable: 'Taxable',
  roth_ira: 'Roth IRA',
  education: 'Education',
  other: 'Other',
};

/**
 * Which income sleeves a scope counts as income-producing.
 *
 * The taxable income engine is deliberately narrower than "anything that pays
 * cash": REIT dividend holdings live in retirement and education accounts and
 * pay a fraction of the engine's rate, so counting them collapses the blended
 * distribution rate used to size the capital requirement.
 */
export function incomePositionInScope(
  position: { accountType: AccountType; sleeve: Sleeve },
  scope: CalculationScope,
): boolean {
  if (!accountInScope({ type: position.accountType }, scope)) return false;
  if (scope === 'TAXABLE_INCOME_ENGINE') return position.sleeve === INCOME_ENGINE_SLEEVE;
  return position.sleeve === INCOME_ENGINE_SLEEVE || position.sleeve === 'reit_dividend';
}

/** Whole-portfolio risk rules that can be switched on deliberately. */
export interface WholePortfolioRules {
  /** Apply the single-position ceiling across every account, not just taxable. */
  concentration: boolean;
  /** Apply the single-exposure ceiling across every account. */
  exposure: boolean;
  /** Apply sleeve ceilings and the leveraged-sleeve cap across every account. */
  sleeve: boolean;
}

export const DEFAULT_WHOLE_PORTFOLIO_RULES: WholePortfolioRules = {
  concentration: false,
  exposure: false,
  sleeve: false,
};

export type RiskRuleKind = keyof WholePortfolioRules;

/**
 * The scope a *risk* limit is measured in.
 *
 * Deliberately not the calculation scope. Measuring concentration inside the
 * income-engine sleeve alone would make the ceiling tighter than the strategy
 * itself: with two positions in the sleeve, every buy immediately exceeds a
 * 35% single-position limit, blocking the very trades the engine exists to
 * make. Risk is therefore measured across all taxable capital by default, and
 * across the entire portfolio when either the order touches a non-taxable
 * account or a whole-portfolio rule has been explicitly configured.
 */
export function riskScopeFor(
  kind: RiskRuleKind,
  accountType: AccountType,
  rules: WholePortfolioRules,
): CalculationScope {
  if (rules[kind]) return 'ENTIRE_PORTFOLIO';
  return accountType === 'taxable' ? 'ALL_TAXABLE' : 'ENTIRE_PORTFOLIO';
}
