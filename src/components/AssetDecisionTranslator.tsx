import { Link } from 'react-router-dom';
import { Card } from './Card.js';
import { Badge } from './Badge.js';
import { buildAssetDecisions, type DecisionSignalInput } from '../intelligence/decisionTranslator.js';
import type { IntelligencePulse, MarketPulseTickerItem } from '../intelligence/types.js';

const PRIORITY_SYMBOLS = ['SEMI', 'SOXL', 'TSMX', 'CCJ', 'WMT', 'SMH', 'TSM', 'GOOGL', 'AMZN'];

function actionTone(action: string): 'positive' | 'warning' | 'negative' | 'neutral' | 'intel' {
  if (action === 'BUY' || action === 'ADD') return 'positive';
  if (action === 'REDUCE' || action === 'SELL') return 'negative';
  if (action === 'WAIT') return 'warning';
  if (action === 'HOLD') return 'neutral';
  return 'intel';
}

function actionRank(symbol: string): number {
  const index = PRIORITY_SYMBOLS.indexOf(symbol);
  return index === -1 ? PRIORITY_SYMBOLS.length + 1 : index;
}

export function AssetDecisionTranslator({
  signals,
  pulses,
  marketPulse,
}: {
  signals: DecisionSignalInput[];
  pulses: IntelligencePulse[];
  marketPulse: MarketPulseTickerItem[];
}) {
  const decisions = buildAssetDecisions(signals, pulses, marketPulse)
    .sort((a, b) => b.priority - a.priority || actionRank(a.symbol) - actionRank(b.symbol) || a.symbol.localeCompare(b.symbol))
    .slice(0, 9);

  return (
    <Card label="Decision Translator" title="What should I do with the assets I care about?">
      {decisions.length ? (
        <div className="grid grid--3">
          {decisions.map((decision) => (
            <div key={decision.symbol} className="panel">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{decision.symbol}</strong>
                <Badge tone={actionTone(decision.action)}>{decision.action}</Badge>
              </div>
              <p style={{ marginTop: 10 }}>{decision.rationale}</p>
              <Link
                className="btn btn--sm btn--ghost"
                to={`/modeling-lab?symbol=${encodeURIComponent(decision.symbol)}&question=${encodeURIComponent(decision.modelQuestion)}`}
              >
                Model {decision.symbol} action
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="meta">No asset has enough price/trend data to produce an asset-level decision yet. Missing data is treated as WAIT, never as permission to buy.</p>
      )}
      <p className="meta" style={{ marginTop: 12 }}>Market Pulse changes context; it does not override the asset trend, account cash, portfolio overlap or deterministic risk engine. Modeling Lab sizes any proposed capital move before execution.</p>
    </Card>
  );
}
