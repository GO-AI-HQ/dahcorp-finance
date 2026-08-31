import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import type { ServerContext } from './context.mts';
import { INCOME_UNIVERSE, WATCHLISTS } from '../../src/core/universe.js';
import { getFmpDistributions, storedFmpSnapshots } from './fmpDistributionProvider.mts';
import { latestIntelligenceEventByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const PURPOSE = 'income_intelligence_snapshot';
const DISCOVERY_LIMIT_PER_GROUP = 6;
const MAX_ANALYZED_CANDIDATES = 20;
const SHIPPING_INCOME_SYMBOLS = ['SBLK', 'DAC', 'INSW', 'GSL', 'CMBT'];

type RuntimeEnv = Record<string, string | undefined>;

export type IncomeCandidateCategory = 'option_income' | 'dividend_compounder' | 'high_yield_equity' | 'cyclical_income';
export type MutationAction = 'ADD' | 'REDUCE' | 'REPLACE' | 'REWEIGHT' | 'HOLD';

interface FmpCalendarRow {
  symbol?: string | null;
  date?: string | null;
  recordDate?: string | null;
  paymentDate?: string | null;
  declarationDate?: string | null;
  adjDividend?: number | null;
  dividend?: number | null;
  yield?: number | null;
  frequency?: string | null;
}

interface FmpScreenerRow {
  symbol?: string | null;
  companyName?: string | null;
  marketCap?: number | null;
  sector?: string | null;
  industry?: string | null;
  price?: number | null;
  lastAnnualDividend?: number | null;
  volume?: number | null;
  exchange?: string | null;
  exchangeShortName?: string | null;
  country?: string | null;
  isEtf?: boolean | null;
  isFund?: boolean | null;
  isActivelyTrading?: boolean | null;
}

export interface UpcomingIncomeEvent {
  symbol: string;
  exDate: string;
  recordDate: string | null;
  paymentDate: string | null;
  declarationDate: string | null;
  amountPerShare: number | null;
  frequency: string | null;
  source: 'fmp_calendar' | 'fmp_company_snapshot';
}

export interface IncomeCandidate {
  symbol: string;
  name: string;
  category: IncomeCandidateCategory;
  price: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  volume: number | null;
  trailing12mCashPerShare: number | null;
  trailingYieldPct: number | null;
  thirteenWeekAnnualizedYieldPct: number | null;
  payoutCount12m: number;
  payoutVariability: 'low' | 'moderate' | 'high' | 'unknown';
  payoutCoefficientOfVariation: number | null;
  observedAnnualGrowthStreakYears: number;
  officialAristocratStatus: 'not_verified';
  dataAsOf: string;
  notes: string[];
}

export interface StrategyMutationProposal {
  action: MutationAction;
  symbol: string | null;
  compareWith: string | null;
  headline: string;
  why: string;
  missingEvidence: string[];
  requiresModeling: true;
  requiresPolicyApproval: boolean;
}

export interface IncomeIntelligenceSnapshot {
  version: 'income-v1';
  asOf: string;
  upcoming: UpcomingIncomeEvent[];
  candidates: IncomeCandidate[];
  sourceStatus: {
    calendar: 'live' | 'fallback' | 'unavailable';
    screener: 'live' | 'fallback' | 'unavailable';
    distributions: 'live' | 'partial' | 'unavailable';
  };
  callsUsed: number;
  note: string;
}

function envValue(key: string, env?: RuntimeEnv): string | undefined {
  if (env?.[key] != null) return env[key];
  if (process.env[key] != null) return process.env[key];
  try {
    const netlify = (globalThis as typeof globalThis & { Netlify?: { env?: { get?: (name: string) => string | undefined } } }).Netlify;
    return netlify?.env?.get?.(key);
  } catch {
    return undefined;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const number = numberOrNull(value);
  return number != null && number > 0 ? number : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  const valueText = text(value);
  if (!valueText) return null;
  const date = valueText.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizeSymbol(value: unknown): string | null {
  const valueText = text(value)?.toUpperCase() ?? null;
  return valueText && /^[A-Z0-9.^-]{1,12}$/.test(valueText) ? valueText : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function coefficientOfVariation(values: number[]): number | null {
  const avg = mean(values);
  if (avg == null || avg <= 0 || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance) / avg;
}

function payoutVariability(cv: number | null): IncomeCandidate['payoutVariability'] {
  if (cv == null) return 'unknown';
  if (cv <= 0.18) return 'low';
  if (cv <= 0.45) return 'moderate';
  return 'high';
}

function annualGrowthStreak(rows: Array<{ exDate: string; amountPerShare: number }>, asOf: string): number {
  const currentYear = Number(asOf.slice(0, 4));
  const annual = new Map<number, number>();
  for (const row of rows) {
    const year = Number(row.exDate.slice(0, 4));
    if (!Number.isFinite(year) || year >= currentYear) continue;
    annual.set(year, (annual.get(year) ?? 0) + row.amountPerShare);
  }
  const years = [...annual.keys()].sort((a, b) => b - a);
  if (years.length < 2) return 0;
  let streak = 0;
  for (let index = 0; index < years.length - 1; index += 1) {
    const newer = years[index];
    const older = years[index + 1];
    if (newer - older !== 1) break;
    if ((annual.get(newer) ?? 0) <= (annual.get(older) ?? 0)) break;
    streak += 1;
  }
  return streak;
}

function categoryFor(symbol: string, row: FmpScreenerRow | undefined, growthStreak: number): IncomeCandidateCategory {
  const name = (row?.companyName ?? '').toLowerCase();
  if (SHIPPING_INCOME_SYMBOLS.includes(symbol)) return 'cyclical_income';
  if (INCOME_UNIVERSE.includes(symbol) || /yieldmax|covered call|option income|high income/i.test(name)) return 'option_income';
  if (growthStreak >= 5) return 'dividend_compounder';
  return 'high_yield_equity';
}

function preRank(row: FmpScreenerRow): number {
  const price = positive(row.price);
  const dividend = positive(row.lastAnnualDividend);
  const indicatedYield = price && dividend ? (dividend / price) * 100 : 0;
  const liquidityBonus = Math.min(3, Math.log10(Math.max(1, numberOrNull(row.volume) ?? 0)) / 2);
  return indicatedYield + liquidityBonus;
}

async function fmpGet<T>(path: string, params: URLSearchParams, env?: RuntimeEnv, fetchImpl: typeof fetch = fetch): Promise<T> {
  const apiKey = envValue('FMP_API_KEY', env)?.trim();
  if (!apiKey) throw new Error('FMP is not configured.');
  const query = new URLSearchParams(params);
  query.set('apikey', apiKey);
  const response = await fetchImpl(`${FMP_BASE_URL}${path}?${query.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`FMP returned HTTP ${response.status}.`);
  return await response.json() as T;
}

function calendarEvent(row: FmpCalendarRow, source: UpcomingIncomeEvent['source'], today: string, maxDate: string): UpcomingIncomeEvent | null {
  const symbol = normalizeSymbol(row.symbol);
  const exDate = isoDate(row.date);
  if (!symbol || !exDate || exDate < today || exDate > maxDate) return null;
  return {
    symbol,
    exDate,
    recordDate: isoDate(row.recordDate),
    paymentDate: isoDate(row.paymentDate),
    declarationDate: isoDate(row.declarationDate),
    amountPerShare: positive(row.adjDividend) ?? positive(row.dividend),
    frequency: text(row.frequency),
    source,
  };
}

async function upcomingFromStoredCompanySnapshots(today: string, maxDate: string): Promise<UpcomingIncomeEvent[]> {
  const snapshots = await storedFmpSnapshots([...new Set([...INCOME_UNIVERSE, ...SHIPPING_INCOME_SYMBOLS])]);
  const out: UpcomingIncomeEvent[] = [];
  for (const [symbol, snapshot] of snapshots) {
    for (const row of snapshot.rows) {
      const event = calendarEvent({ ...row, symbol }, 'fmp_company_snapshot', today, maxDate);
      if (event) out.push(event);
    }
  }
  return out.sort((a, b) => a.exDate.localeCompare(b.exDate)).slice(0, 40);
}

async function fetchUpcomingCalendar(today: string, maxDate: string, env?: RuntimeEnv): Promise<{ events: UpcomingIncomeEvent[]; calls: number; status: IncomeIntelligenceSnapshot['sourceStatus']['calendar'] }> {
  try {
    const rows = await fmpGet<FmpCalendarRow[]>('/dividends-calendar', new URLSearchParams(), env);
    const events = Array.isArray(rows)
      ? rows.map((row) => calendarEvent(row, 'fmp_calendar', today, maxDate)).filter((row): row is UpcomingIncomeEvent => row != null)
      : [];
    if (events.length) return { events: events.sort((a, b) => a.exDate.localeCompare(b.exDate)).slice(0, 80), calls: 1, status: 'live' };
  } catch {
    // Fall through to company snapshots. Calendar access can vary by FMP plan.
  }
  const fallback = await upcomingFromStoredCompanySnapshots(today, maxDate);
  return { events: fallback, calls: 1, status: fallback.length ? 'fallback' : 'unavailable' };
}

async function fetchScreen(env?: RuntimeEnv): Promise<{ rows: FmpScreenerRow[]; calls: number; status: IncomeIntelligenceSnapshot['sourceStatus']['screener'] }> {
  const common = {
    country: 'US',
    isFund: 'false',
    isActivelyTrading: 'true',
    dividendMoreThan: '0',
    priceMoreThan: '3',
    volumeMoreThan: '5000',
    limit: '60',
  };
  try {
    const [stocks, etfs] = await Promise.all([
      fmpGet<FmpScreenerRow[]>('/company-screener', new URLSearchParams({ ...common, isEtf: 'false', marketCapMoreThan: '250000000' }), env),
      fmpGet<FmpScreenerRow[]>('/company-screener', new URLSearchParams({ ...common, isEtf: 'true' }), env),
    ]);
    const pick = (rows: FmpScreenerRow[]) => (Array.isArray(rows) ? rows : [])
      .filter((row) => normalizeSymbol(row.symbol) && positive(row.price))
      .sort((a, b) => preRank(b) - preRank(a))
      .slice(0, DISCOVERY_LIMIT_PER_GROUP);
    const merged = [...pick(stocks), ...pick(etfs)];
    return { rows: merged, calls: 2, status: merged.length ? 'live' : 'unavailable' };
  } catch {
    return { rows: [], calls: 2, status: 'unavailable' };
  }
}

function candidateFrom(
  symbol: string,
  screen: FmpScreenerRow | undefined,
  distributions: Array<{ exDate: string; amountPerShare: number }>,
  asOf: string,
): IncomeCandidate {
  const price = positive(screen?.price);
  const asOfMs = Date.parse(`${asOf}T23:59:59Z`);
  const trailingStart = asOfMs - 365 * 86_400_000;
  const thirteenStart = asOfMs - 91 * 86_400_000;
  const trailing = distributions.filter((row) => Date.parse(`${row.exDate}T12:00:00Z`) >= trailingStart);
  const thirteen = distributions.filter((row) => Date.parse(`${row.exDate}T12:00:00Z`) >= thirteenStart);
  const trailingCash = trailing.length ? trailing.reduce((sum, row) => sum + row.amountPerShare, 0) : null;
  const thirteenCash = thirteen.length ? thirteen.reduce((sum, row) => sum + row.amountPerShare, 0) : null;
  const cv = coefficientOfVariation([...trailing].sort((a, b) => b.exDate.localeCompare(a.exDate)).slice(0, 13).map((row) => row.amountPerShare));
  const streak = annualGrowthStreak(distributions, asOf);
  const category = categoryFor(symbol, screen, streak);
  const notes: string[] = [];
  if (category === 'option_income') notes.push('High distributions must be judged together with NAV/price retention and tax character; headline yield alone is not enough.');
  if (category === 'cyclical_income') notes.push('Shipping/cyclical payouts can change sharply with freight markets and company capital-allocation decisions.');
  if (streak >= 5) notes.push(`${streak}-year distribution-growth streak observed in the available FMP history; this is not an official S&P Dividend Aristocrat designation.`);
  if (!price) notes.push('Current discovery price is unavailable, so yield comparisons remain incomplete.');
  return {
    symbol,
    name: text(screen?.companyName) ?? symbol,
    category,
    price,
    marketCap: positive(screen?.marketCap),
    sector: text(screen?.sector),
    industry: text(screen?.industry),
    volume: positive(screen?.volume),
    trailing12mCashPerShare: trailingCash,
    trailingYieldPct: price && trailingCash ? (trailingCash / price) * 100 : null,
    thirteenWeekAnnualizedYieldPct: price && thirteenCash ? ((thirteenCash * (365 / 91)) / price) * 100 : null,
    payoutCount12m: trailing.length,
    payoutVariability: payoutVariability(cv),
    payoutCoefficientOfVariation: cv,
    observedAnnualGrowthStreakYears: streak,
    officialAristocratStatus: 'not_verified',
    dataAsOf: asOf,
    notes,
  };
}

function candidateOrder(a: IncomeCandidate, b: IncomeCandidate): number {
  const aYield = a.trailingYieldPct ?? -1;
  const bYield = b.trailingYieldPct ?? -1;
  const stability = (value: IncomeCandidate['payoutVariability']) => value === 'low' ? 3 : value === 'moderate' ? 2 : value === 'high' ? 1 : 0;
  // This is display/research ordering only. It is not a trade score.
  return bYield - aYield || stability(b.payoutVariability) - stability(a.payoutVariability) || b.observedAnnualGrowthStreakYears - a.observedAnnualGrowthStreakYears;
}

async function persistSnapshot(snapshot: IncomeIntelligenceSnapshot): Promise<number> {
  const event: IntelligenceEvent = {
    fingerprint: `income-intelligence-${snapshot.asOf.slice(0, 10)}`,
    occurredAt: snapshot.asOf,
    discoveredAt: snapshot.asOf,
    source: 'DAHCorp income discovery',
    sourceClass: 'market_benchmark',
    sourceUrl: 'https://financialmodelingprep.com/',
    sourceQuality: 0.9,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: `${snapshot.candidates.length} income candidates and ${snapshot.upcoming.length} upcoming distribution events reviewed`,
    summary: snapshot.note,
    symbols: [...new Set([...snapshot.candidates.map((row) => row.symbol), ...snapshot.upcoming.map((row) => row.symbol)])],
    latency: 'near_real_time',
    direction: 'neutral',
    severity: 'info',
    sentimentScore: null,
    metadata: { purpose: PURPOSE, incomeIntelligence: snapshot },
  };
  return persistIntelligenceEvents([event]);
}

export async function refreshIncomeIntelligence(env?: RuntimeEnv): Promise<{ snapshot: IncomeIntelligenceSnapshot; persisted: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
  const [calendar, screen] = await Promise.all([
    fetchUpcomingCalendar(today, maxDate, env),
    fetchScreen(env),
  ]);

  const screenBySymbol = new Map<string, FmpScreenerRow>();
  for (const row of screen.rows) {
    const symbol = normalizeSymbol(row.symbol);
    if (symbol) screenBySymbol.set(symbol, row);
  }
  const seedSymbols = [...new Set([
    ...screenBySymbol.keys(),
    ...INCOME_UNIVERSE,
    ...SHIPPING_INCOME_SYMBOLS,
    ...WATCHLISTS.reitDividend,
  ])].slice(0, MAX_ANALYZED_CANDIDATES);

  const distributions = await getFmpDistributions(seedSymbols, today, 9_500, { env });
  const bySymbol = new Map<string, Array<{ exDate: string; amountPerShare: number }>>();
  for (const row of distributions.events) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push({ exDate: row.exDate, amountPerShare: row.amountPerShare });
    bySymbol.set(row.symbol, list);
  }
  const candidates = seedSymbols
    .map((symbol) => candidateFrom(symbol, screenBySymbol.get(symbol), bySymbol.get(symbol) ?? [], today))
    .filter((row) => row.payoutCount12m > 0 || row.trailingYieldPct != null)
    .sort(candidateOrder)
    .slice(0, MAX_ANALYZED_CANDIDATES);

  const fmpRows = distributions.statuses.filter((row) => row.rows > 0).length;
  const snapshot: IncomeIntelligenceSnapshot = {
    version: 'income-v1',
    asOf: new Date().toISOString(),
    upcoming: calendar.events,
    candidates,
    sourceStatus: {
      calendar: calendar.status,
      screener: screen.status,
      distributions: fmpRows === distributions.statuses.length && fmpRows > 0 ? 'live' : fmpRows > 0 ? 'partial' : 'unavailable',
    },
    callsUsed: calendar.calls + screen.calls + distributions.callsUsed,
    note: 'This research looks for income opportunities without changing the approved portfolio by itself. Upcoming distributions are event timing, not free return; price normally adjusts around the ex-date. All buy, sell, replacement and reweighting ideas still require Modeling Lab, safety checks and investor approval.',
  };
  return { snapshot, persisted: await persistSnapshot(snapshot) };
}

function isSnapshot(value: unknown): value is IncomeIntelligenceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<IncomeIntelligenceSnapshot>;
  return row.version === 'income-v1' && typeof row.asOf === 'string' && Array.isArray(row.candidates) && Array.isArray(row.upcoming);
}

export async function loadIncomeIntelligence(): Promise<IncomeIntelligenceSnapshot | null> {
  const event = await latestIntelligenceEventByPurpose(PURPOSE);
  const value = event?.metadata?.incomeIntelligence;
  return isSnapshot(value) ? value : null;
}

function stabilityRank(value: IncomeCandidate['payoutVariability']): number {
  return value === 'low' ? 3 : value === 'moderate' ? 2 : value === 'high' ? 1 : 0;
}

export function buildStrategyMutationProposals(ctx: ServerContext, snapshot: IncomeIntelligenceSnapshot | null): StrategyMutationProposal[] {
  if (!snapshot) return [];
  const held = new Set(ctx.income.positions.map((position) => position.symbol.toUpperCase()));
  const heldResearch = snapshot.candidates.filter((row) => held.has(row.symbol));
  const unheld = snapshot.candidates.filter((row) => !held.has(row.symbol) && row.trailingYieldPct != null);
  const proposals: StrategyMutationProposal[] = [];

  const bestHeld = [...heldResearch].sort(candidateOrder)[0] ?? null;
  const challenger = unheld.find((row) => {
    if (row.trailingYieldPct == null || row.payoutCount12m < 3) return false;
    if (!bestHeld?.trailingYieldPct) return row.trailingYieldPct >= 5;
    return row.trailingYieldPct >= bestHeld.trailingYieldPct + 3
      && stabilityRank(row.payoutVariability) >= Math.max(1, stabilityRank(bestHeld.payoutVariability) - 1);
  }) ?? null;

  if (challenger) {
    proposals.push({
      action: bestHeld ? 'REPLACE' : 'ADD',
      symbol: challenger.symbol,
      compareWith: bestHeld?.symbol ?? null,
      headline: bestHeld
        ? `Compare ${challenger.symbol} with ${bestHeld.symbol} instead of assuming the current mix is permanent`
        : `Research adding ${challenger.symbol} to the income plan`,
      why: `${challenger.symbol} has a verified trailing cash-distribution history worth comparing with the current income holdings. The comparison must include total return, price/NAV retention, payout variability, overlap, taxes and liquidity before changing the portfolio.`,
      missingEvidence: ['Total-return comparison', 'Tax/return-of-capital character when applicable', 'Account fit and overlap', 'Current entry quality'],
      requiresModeling: true,
      requiresPolicyApproval: !INCOME_UNIVERSE.includes(challenger.symbol),
    });
  }

  const heldWithData = heldResearch.filter((row) => row.trailingYieldPct != null);
  if (heldWithData.length >= 2) {
    const sorted = [...heldWithData].sort(candidateOrder);
    const strongest = sorted[0];
    const weakest = sorted.at(-1)!;
    if (strongest.symbol !== weakest.symbol && (strongest.trailingYieldPct ?? 0) >= (weakest.trailingYieldPct ?? 0) + 4) {
      proposals.push({
        action: 'REWEIGHT',
        symbol: strongest.symbol,
        compareWith: weakest.symbol,
        headline: `Model whether the income mix should lean more toward ${strongest.symbol}`,
        why: `The observed distribution profiles differ enough to justify a reweighting test, but cash yield alone is not sufficient evidence to move money.`,
        missingEvidence: ['Total return and drawdown comparison', 'Exposure overlap', 'Tax character', 'Entry price'],
        requiresModeling: true,
        requiresPolicyApproval: false,
      });
    }
  }

  if (!proposals.length) {
    proposals.push({
      action: 'HOLD',
      symbol: null,
      compareWith: null,
      headline: 'No researched income candidate currently earns a portfolio-change proposal',
      why: 'The research universe can keep changing without forcing the portfolio to change. Hold the current mix until a candidate has enough verified evidence to justify a full Modeling Lab comparison.',
      missingEvidence: [],
      requiresModeling: true,
      requiresPolicyApproval: false,
    });
  }

  return proposals.slice(0, 4);
}

export async function incomeIntelligenceForContext(ctx: ServerContext) {
  const snapshot = await loadIncomeIntelligence();
  return {
    snapshot,
    proposals: buildStrategyMutationProposals(ctx, snapshot),
  };
}
