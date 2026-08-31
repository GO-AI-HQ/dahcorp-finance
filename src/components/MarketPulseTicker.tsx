import { Link } from 'react-router-dom';
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

const EXPECTED_BENCHMARKS: Record<MarketPulseTickerItem['sector'], { primary: string; confirmation: string }> = {
  shipping: { primary: 'BDRY / shipping benchmark', confirmation: 'BDRY' },
  semiconductors: { primary: 'SOX', confirmation: 'SOXX' },
  energy: { primary: 'WTI + Brent', confirmation: 'XLE' },
  technology: { primary: 'NDX', confirmation: 'XLK' },
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

function level(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function change(value: number | null): string {
  return value == null ? '—' : formatPct(value / 100, 1);
}

function updatedAt(items: MarketPulseTickerItem['benchmarks']): string {
  const latest = items.map((item) => Date.parse(item.asOf)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return latest ? new Date(latest).toLocaleString() : 'Unknown';
}

function decisionRead(move5: number | null, move30: number | null): { label: string; detail: string } {
  if (move5 == null || move30 == null) {
    return { label: 'Waiting for enough history', detail: 'The app needs both the recent move and the broader move before it can tell whether this is momentum, a pullback or a weakening trend.' };
  }
  if (move30 > 2 && move5 < -0.5) {
    return { label: 'Pullback inside a rising trend', detail: 'The broader move is still up while the last week cooled. That is the kind of setup worth modeling for a possible entry, but it is not an automatic buy.' };
  }
  if (move30 > 0 && move5 > 0) {
    return { label: 'Rising — do not chase it', detail: 'Both the short and broader trend are rising. That is constructive, but a better entry may come from a pullback rather than buying simply because price is going up.' };
  }
  if (move30 < -2 && move5 > 0.5) {
    return { label: 'Rebound inside a weaker trend', detail: 'The last week improved, but the broader move is still down. Treat this as an early rebound that needs more confirmation before committing new money.' };
  }
  if (move30 < 0 && move5 < 0) {
    return { label: 'Falling — wait for stabilization', detail: 'Both the recent and broader move are down. A lower price alone is not enough; the app should look for evidence that the decline is stabilizing before calling it a useful dip.' };
  }
  return { label: 'Mixed / neutral', detail: 'The short and broader moves do not agree strongly enough to call this a clean trend or a clean pullback. Keep watching rather than forcing a decision.' };
}

export function MarketPulseTicker({ items }: { items: MarketPulseTickerItem[] }) {
  return (
    <Card label="Market Pulse" title="The market weather behind each strategy">
      <div className="grid grid--4">
        {items.map((item) => {
          const move30 = average(item.benchmarks.map((leg) => leg.return30d));
          const move5 = average(item.benchmarks.map((leg) => leg.return5d));
          const expected = EXPECTED_BENCHMARKS[item.sector];
          const benchmark = item.benchmarks.map((leg) => leg.name).join(' + ');
          const last = average(item.benchmarks.map((leg) => leg.last));
          const unavailable = item.dataRole === 'unavailable' || !item.benchmarks.length;
          const read = decisionRead(move5, move30);
          const question = `Look at my approved ${item.sector} holdings and candidates against the current ${benchmark || expected.primary} market setup. The sector benchmark is ${move5 == null ? 'UNKNOWN' : `${move5.toFixed(1)}% over 5 days`} and ${move30 == null ? 'UNKNOWN' : `${move30.toFixed(1)}% over 30 days`}. Decide whether this is a useful pullback in a rising trend, an extended move I should not chase, an early rebound, or a weakening trend. If the evidence supports action, give me a buy/sell zone rather than a single-point prediction, the confidence level, what would invalidate the setup, and which account/cash mandate could fund it. If the evidence does not support action, say WAIT.`;
          return (
            <div key={item.sector} className="panel">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{SECTOR_LABEL[item.sector]}</strong>
                <Badge tone={tone(item.state)} glyph={arrow(item.state)}>{item.state}</Badge>
              </div>
              <p style={{ margin: '10px 0 4px' }}><strong>{unavailable ? `Waiting for ${expected.primary}` : benchmark}</strong></p>
              {unavailable ? (
                <>
                  <p className="meta">Waiting for a real OpenBB market benchmark. Missing data stays unknown rather than being turned into a neutral opinion.</p>
                  <p className="meta">Expected benchmark: <strong>{expected.primary}</strong>. Useful liquid comparison: <strong>{expected.confirmation}</strong>.</p>
                </>
              ) : (
                <>
                  <div className="stack stack--tight" style={{ marginTop: 8 }}>
                    <div className="key-value"><span className="soft">Last close</span><strong>{level(last)}</strong></div>
                    <div className="key-value"><span className="soft">5-day move</span><strong>{change(move5)}</strong></div>
                    <div className="key-value"><span className="soft">30-day move</span><strong>{change(move30)}</strong></div>
                    <div className="key-value"><span className="soft">What it means</span><strong>{read.label}</strong></div>
                  </div>
                  <p className="meta" style={{ marginTop: 8 }}>{read.detail}</p>
                  <p className="meta"><strong>Updated:</strong> {updatedAt(item.benchmarks)}</p>
                  <p style={{ marginTop: 10 }}><Link className="btn btn--sm btn--ghost" to={`/modeling-lab?question=${encodeURIComponent(question)}`}>Model a buy/sell zone</Link></p>
                </>
              )}
              {item.confirmation ? (
                <p className="meta"><strong>OpenBB comparison:</strong> {item.confirmation.symbol}{item.confirmation.return30d != null ? ` ${formatPct(item.confirmation.return30d / 100, 1)} over 30 days` : ''}.</p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="meta" style={{ marginTop: 12 }}>A positive move is not automatically a buy signal. The useful setup is often a pullback inside a healthy broader trend. Market Pulse supplies the direction and timing context; Modeling Lab combines it with the actual ticker, your holdings, valuation and risk evidence before suggesting a buy/sell zone.</p>
    </Card>
  );
}
