import type { IntelligenceDirection, IntelligenceSector, MarketPulseState } from './types.js';

export function marketPulseState(return5d: number | null, return30d: number | null): MarketPulseState {
  if (return5d == null && return30d == null) return 'Unavailable';
  const five = return5d ?? 0;
  const thirty = return30d ?? 0;
  if (five <= -4 || thirty <= -8) return 'Defensive';
  if (five <= -1.5 || thirty <= -4) return 'Weakening';
  if (five >= 2.5 || thirty >= 6) return 'Improving';
  if (five >= 0.75 || thirty >= 2) return 'Constructive';
  return 'Neutral';
}

export function marketPulseDirection(state: MarketPulseState): IntelligenceDirection {
  if (state === 'Improving' || state === 'Constructive') return 'constructive';
  if (state === 'Weakening' || state === 'Defensive') return 'restrictive';
  if (state === 'Neutral') return 'neutral';
  return 'unknown';
}

export function marketPulseNarrative(
  sector: Exclude<IntelligenceSector, 'cross_market'>,
  state: MarketPulseState,
): string {
  if (state === 'Unavailable') return 'Primary benchmark data is unavailable; do not infer a neutral market regime.';
  if (sector === 'shipping') {
    if (state === 'Improving') return 'Freight conditions are strengthening; confirm with shipping equities before adding Maritime exposure.';
    if (state === 'Constructive') return 'Freight conditions are supportive, but entry price still controls the trade.';
    if (state === 'Weakening' || state === 'Defensive') return 'Freight conditions are deteriorating; preserve Maritime cash and demand stronger company-level evidence.';
    return 'Freight conditions are balanced; keep the Maritime plan unchanged until the benchmark moves decisively.';
  }
  if (sector === 'semiconductors') {
    if (state === 'Improving') return 'Chip leadership is strengthening; qualified core entries deserve attention while leverage still requires stricter rules.';
    if (state === 'Constructive') return 'The semiconductor backdrop is supportive; use price and trend to choose the asset, not the index alone.';
    if (state === 'Weakening' || state === 'Defensive') return 'Chip leadership is deteriorating; preserve Growth cash and avoid forcing leveraged entries.';
    return 'Semiconductor leadership is balanced; wait for asset-level price/trend confirmation.';
  }
  if (sector === 'energy') {
    if (state === 'Improving') return 'Crude benchmarks are strengthening together; Energy entries can be evaluated if the individual asset also qualifies.';
    if (state === 'Constructive') return 'The Energy backdrop is supportive; nuclear and producer assets still need their own setup.';
    if (state === 'Weakening' || state === 'Defensive') return 'The Energy backdrop is weakening; preserve capital until price or supply evidence improves.';
    return 'Energy benchmarks are balanced; keep the existing allocation plan unchanged.';
  }
  if (state === 'Improving') return 'Broad growth leadership is strengthening; quality-growth entries can be evaluated on price and portfolio fit.';
  if (state === 'Constructive') return 'The technology backdrop is supportive; prioritize quality and valuation over momentum chasing.';
  if (state === 'Weakening' || state === 'Defensive') return 'Broad growth leadership is weakening; slow DCA and demand better entry prices.';
  return 'Technology leadership is balanced; keep DCA selective.';
}
