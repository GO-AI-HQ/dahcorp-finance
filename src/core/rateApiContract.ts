export interface RateApiDepositBenchmarkPayload {
  product_category?: string;
  as_of?: string;
  best?: {
    lender?: string | null;
    institution?: string | null;
    apy?: number | null;
  } | null;
  market?: {
    min_apy?: number | null;
    median_apy?: number | null;
    max_apy?: number | null;
    institution_count?: number | null;
    rate_count?: number | null;
  } | null;
}

export interface SavingsRateBenchmark {
  source: 'rateapi';
  status: 'verified' | 'stale' | 'unavailable' | 'not_configured';
  asOf: string | null;
  bestPublishedApy: number | null;
  bestPublishedInstitution: string | null;
  medianApy: number | null;
  minApy: number | null;
  maxApy: number | null;
  institutionCount: number | null;
  note: string;
}

export const RATEAPI_SAVINGS_BENCHMARK_REQUEST = {
  product_category: 'savings',
  mode: 'benchmark',
} as const;

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function unavailableSavingsRateBenchmark(status: SavingsRateBenchmark['status'], note: string): SavingsRateBenchmark {
  return {
    source: 'rateapi', status, asOf: null,
    bestPublishedApy: null, bestPublishedInstitution: null,
    medianApy: null, minApy: null, maxApy: null, institutionCount: null,
    note,
  };
}

export function normalizeRateApiDepositBenchmark(payload: RateApiDepositBenchmarkPayload): SavingsRateBenchmark {
  const asOf = typeof payload.as_of === 'string' && /^\d{4}-\d{2}-\d{2}/.test(payload.as_of)
    ? payload.as_of.slice(0, 10)
    : null;
  const bestPublishedApy = numberOrNull(payload.best?.apy);
  const bestPublishedInstitution = typeof payload.best?.lender === 'string'
    ? payload.best.lender
    : typeof payload.best?.institution === 'string'
      ? payload.best.institution
      : null;
  const market = payload.market ?? {};
  return {
    source: 'rateapi',
    status: asOf ? 'verified' : 'unavailable',
    asOf,
    bestPublishedApy,
    bestPublishedInstitution,
    medianApy: numberOrNull(market.median_apy),
    minApy: numberOrNull(market.min_apy),
    maxApy: numberOrNull(market.max_apy),
    institutionCount: numberOrNull(market.institution_count),
    note: asOf
      ? 'Verified savings-rate benchmark from RateAPI. A published top APY is not automatically available to you; eligibility, balance tiers, geography, membership rules and transfer timing still matter.'
      : 'RateAPI returned no dated savings benchmark. Exact retail savings rates remain unknown.',
  };
}
