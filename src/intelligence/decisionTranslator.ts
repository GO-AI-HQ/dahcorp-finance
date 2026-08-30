import {
  ENERGY_INTELLIGENCE_SYMBOLS,
  SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
  SHIPPING_INTELLIGENCE_SYMBOLS,
  TECHNOLOGY_INTELLIGENCE_SYMBOLS,
} from './taxonomy.js';
import type { AssetDecision, IntelligencePulse, IntelligenceSector, MarketPulseTickerItem } from './types.js';

export interface DecisionSignalInput {
  symbol: string;
  held: boolean;
  price: number;
  trend: { status: string };
  dip: { actionable: boolean; declineFromReference: number | null };
}

const LEVERAGED = new Set(['SOXL', 'TSMX']);

export function sectorForDecisionSymbol(symbol: string): Exclude<IntelligenceSector, 'cross_market'> | null {
  const upper = symbol.toUpperCase();
  if ((SEMICONDUCTOR_INTELLIGENCE_SYMBOLS as readonly string[]).includes(upper)) return 'semiconductors';
  if ((ENERGY_INTELLIGENCE_SYMBOLS as readonly string[]).includes(upper)) return 'energy';
  if ((SHIPPING_INTELLIGENCE_SYMBOLS as readonly string[]).includes(upper)) return 'shipping';
  if ((TECHNOLOGY_INTELLIGENCE_SYMBOLS as readonly string[]).includes(upper)) return 'technology';
  return null;
}

function adverseMarket(item: MarketPulseTickerItem | undefined): boolean {
  return item?.state === 'Weakening' || item?.state === 'Defensive';
}

function supportiveMarket(item: MarketPulseTickerItem | undefined): boolean {
  return item?.state === 'Improving' || item?.state === 'Constructive';
}

export function translateAssetDecision(
  signal: DecisionSignalInput,
  pulses: IntelligencePulse[],
  marketPulse: MarketPulseTickerItem[],
): AssetDecision | null {
  const symbol = signal.symbol.toUpperCase();
  const sector = sectorForDecisionSymbol(symbol);
  if (!sector) return null;
  const pulse = pulses.find((row) => row.sector === sector);
  const benchmark = marketPulse.find((row) => row.sector === sector);
  const adverse = pulse?.label === 'Cautious' || pulse?.policy === 'restrictive' || adverseMarket(benchmark);
  const supportive = pulse?.label === 'Constructive' || supportiveMarket(benchmark);
  const trendLost = signal.trend.status === 'TREND_LOST';
  const trendConfirmed = signal.trend.status === 'TREND_CONFIRMED';
  const leveraged = LEVERAGED.has(symbol);

  let action: AssetDecision['action'] = signal.held ? 'HOLD' : 'WAIT';
  let rationale = '';
  let priority = 2;

  if (trendLost && signal.held) {
    action = 'REDUCE';
    priority = 5;
    rationale = `${symbol}'s deterministic trend is broken. Existing exposure deserves a reduction review before new capital is considered.`;
  } else if (trendLost) {
    action = 'WAIT';
    priority = 4;
    rationale = `${symbol}'s deterministic trend is broken. A lower price is not a sufficient reason to initiate exposure.`;
  } else if (leveraged && adverse) {
    action = signal.held ? 'HOLD' : 'WAIT';
    priority = 4;
    rationale = `${symbol} is leveraged exposure while the ${sector} backdrop is weakening. Preserve flexibility and do not add merely because the instrument has fallen.`;
  } else if (signal.dip.actionable && trendConfirmed && !adverse && supportive) {
    action = signal.held ? 'ADD' : 'BUY';
    priority = 5;
    rationale = `${symbol} has reached a planned price zone, its deterministic trend remains intact, and sector evidence is supportive. Modeling Lab should decide whether the portfolio can justify the capital.`;
  } else if (signal.held && adverse) {
    action = 'HOLD';
    priority = 3;
    rationale = `${symbol} remains held, but sector evidence argues against adding now. Preserve cash unless the individual setup becomes materially stronger.`;
  } else if (signal.held) {
    action = 'HOLD';
    rationale = `${symbol} remains consistent with the current strategy, but there is not enough combined price and intelligence evidence to add capital now.`;
  } else {
    action = 'WAIT';
    rationale = `${symbol} does not yet have enough combined price, trend and sector evidence to justify moving cash.`;
  }

  const modelQuestion = action === 'BUY' || action === 'ADD'
    ? `Model a ${action.toLowerCase()} decision for ${symbol}. Compare deploying capital now with holding the relevant Cash Queue, account for sector benchmark conditions, current holdings, overlap and deterministic risk, and recommend a dollar amount only if the move improves the active strategy.`
    : action === 'REDUCE'
      ? `Model whether ${symbol} should be reduced. Compare keeping the current exposure with reducing it, include current sector conditions and portfolio overlap, and stage a sell only if deterministic risk and the active strategy support it.`
      : `Model the current ${symbol} ${action.toLowerCase()} decision. Explain what specific price, trend or intelligence condition would need to change before capital should move.`;

  return { symbol, sector, action, rationale, modelQuestion, priority };
}

export function buildAssetDecisions(
  signals: DecisionSignalInput[],
  pulses: IntelligencePulse[],
  marketPulse: MarketPulseTickerItem[],
): AssetDecision[] {
  return signals
    .map((signal) => translateAssetDecision(signal, pulses, marketPulse))
    .filter((row): row is AssetDecision => Boolean(row))
    .sort((a, b) => b.priority - a.priority || a.symbol.localeCompare(b.symbol));
}
