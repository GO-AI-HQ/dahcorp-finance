import { Card } from './Card.js';
import { Badge } from './Badge.js';
import { formatPct } from '../core/format.js';
import type { MarketPulseTickerItem } from '../intelligence/types.js';

const SECTOR_LABEL: Record<MarketPulseTickerItem['sector'], string> = {
  shipping: 'SHIPPING',
  semiconductors: 'SEMICONDUCTORS',
  energy: 'ENERGY',
  technology: 'TECHNOLOGY',
};

function tone(state: MarketPulseTickerItem['state']): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (state === 'Improving' || state === 'Constructive') return 'positive';
  if (state === 'Weakening') return 'warning';
  if (state === 'Defensive') return 'negative';
  return 'neutral';
}

function arrow(state: MarketPulseTickerItem['state']): string {
  if (state === 'Improving' || state === 'Constructive') return '▲';
  if (state === 'Weakening' || state === 'Defensive') return '▼';
  return '→';
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

export function MarketPulseTicker({ items }: { items: MarketPulseTickerItem[] }) {
  return (
    <Card label="Market Pulse" title="The market weather behind each strategy">
      <div className="grid grid--4">
        {items.map((item) => {
          const move30 = average(item.benchmarks.map((leg) => leg.return30d));
          const move5 = average(item.benchmarks.map((leg) => leg.return5d));
          const displayMove = move30 ?? move5;
          const window = move30 != null ? '30d' : move5 != null ? '5d' : null;
          const benchmark = item.benchmarks.map((leg) => leg.name).join(' + ') || 'Benchmark unavailable';
          return (
            <div key={item.sector} className="panel">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{SECTOR_LABEL[item.sector]}</strong>
                <Badge tone={tone(item.state)} glyph={arrow(item.state)}>{item.state}</Badge>
              </div>
              <p style={{ margin: '10px 0 4px' }}><strong>{benchmark}</strong>{displayMove != null && window ? ` · ${formatPct(displayMove / 100, 1)} ${window}` : ''}</p>
              <p className="meta">{item.summary}</p>
              {item.confirmation ? (
                <p className="meta"><strong>Confirmation:</strong> {item.confirmation.symbol}{item.confirmation.return30d != null ? ` ${formatPct(item.confirmation.return30d / 100, 1)} 30d` : ''} via OpenBB.</p>
              ) : item.dataRole === 'proxy_fallback' ? <p className="meta"><strong>Proxy-only read.</strong> Primary benchmark is not available.</p> : null}
            </div>
          );
        })}
      </div>
      <p className="meta" style={{ marginTop: 12 }}>Primary macro benchmarks describe the weather. They never dictate a trade by themselves; asset price, trend, portfolio fit and deterministic risk still control the decision.</p>
    </Card>
  );
}
