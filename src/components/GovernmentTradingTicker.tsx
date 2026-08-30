import { Link } from 'react-router-dom';
import { Card } from './Card.js';
import { Badge } from './Badge.js';
import type { GovernmentTradingSignal } from '../intelligence/types.js';

const SECTOR_LABEL: Record<GovernmentTradingSignal['sector'], string> = {
  shipping: 'Shipping',
  semiconductors: 'Semiconductors',
  energy: 'Energy',
  technology: 'Technology',
};

function sideTone(side: GovernmentTradingSignal['tradeType']): 'positive' | 'negative' | 'neutral' {
  return side === 'buy' ? 'positive' : side === 'sell' ? 'negative' : 'neutral';
}

export function GovernmentTradingTicker({ signals }: { signals: GovernmentTradingSignal[] }) {
  const counts = signals.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.sector] = (acc[signal.sector] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card label="Government Trading" title="Public congressional disclosures × policy/news context">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['semiconductors', 'energy', 'shipping', 'technology'] as const).map((sector) => (
          <Badge key={sector} tone={counts[sector] ? 'intel' : 'neutral'}>{SECTOR_LABEL[sector]} · {counts[sector] ?? 0}</Badge>
        ))}
      </div>

      {signals.length ? (
        <div className="stack stack--tight">
          {signals.slice(0, 8).map((signal) => {
            const gap = signal.reportingGapDays == null ? 'filing lag unknown' : `${signal.reportingGapDays}d disclosure lag`;
            const modelTo = `/modeling-lab?question=${encodeURIComponent(`Review ${signal.symbol} in the context of the ${signal.sector} strategy. A public congressional ${signal.tradeType} disclosure was filed with a ${gap}. ${signal.relatedHeadline ? `It is historically near this policy/news event: ${signal.relatedHeadline}.` : ''} Treat the filing as delayed evidence only and recommend no portfolio change unless current market, price, portfolio and deterministic risk evidence independently support it.`)}`;
            return (
              <div key={signal.fingerprint} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong>{signal.symbol}</strong>
                    <Badge tone={sideTone(signal.tradeType)}>{signal.tradeType.toUpperCase()}</Badge>
                    <Badge tone="neutral">{SECTOR_LABEL[signal.sector]}</Badge>
                  </div>
                  <span className="meta">{gap}</span>
                </div>
                <p className="meta" style={{ marginTop: 6 }}>{signal.trader}{signal.party ? ` · ${signal.party}` : ''}{signal.state ? ` · ${signal.state}` : ''}{signal.size ? ` · ${signal.size}` : ''}</p>
                <p>{signal.correlation}</p>
                {signal.relatedHeadline ? <p className="meta"><strong>Related evidence:</strong> {signal.relatedHeadline}{signal.relatedSource ? ` · ${signal.relatedSource}` : ''}</p> : null}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="meta">Historical correlation only — never a standalone trade trigger.</span>
                  <Link className="btn btn--sm btn--ghost" to={modelTo}>Model portfolio relevance</Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="meta">No same-sector congressional disclosures are stored yet. AInvest verification populates this ticker on intelligence refresh; missing disclosures are not interpreted as a signal.</p>
      )}
    </Card>
  );
}
