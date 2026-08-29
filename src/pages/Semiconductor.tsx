import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { StatCard } from '../components/StatCard.js';
import { Badge } from '../components/Badge.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { KeyValue } from '../components/KeyValue.js';
import { DataBanner } from '../components/DataBanner.js';
import { AgenticReadinessCard } from '../components/AgenticReadinessCard.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { DipBadge, TrendBadge } from '../components/SignalBadges.js';
import { formatMoney, formatNumber, formatPct, formatShares, formatSignedMoney, formatSignedPct } from '../core/format.js';

const ACTION_LABEL: Record<string, string> = {
  hold: 'Hold',
  stop_adding: 'Stop adding',
  reduce: 'Reduce',
  exit: 'Exit',
};

export function Semiconductor() {
  const signals = useResource(() => api.signals(), []);

  if (signals.error) return <ErrorState error={signals.error} onRetry={signals.reload} />;
  if (!signals.data) return <LoadingCards count={4} />;

  const d = signals.data;
  const engine = d.semis;
  const exposure = engine.exposure;

  return (
    <>
      <PageHead
        eyebrow="Semiconductor"
        title="Capital recycling studio"
        lede="SEMI, SMH and AMD form the long-horizon core candidate set. TSMX and SOXL are tactical, daily-reset leveraged instruments whose eligible profits can be recycled into durable holdings."
      />

      <DataBanner containsMockData={d.containsMockData} sourceNotes={d.sourceNotes} asOf={d.asOf} />

      <div className="section"><AgenticReadinessCard /></div>

      <div className="banner banner--risk section" role="note">
        <span className="banner__glyph" aria-hidden="true">!</span>
        <div>
          <span className="banner__title">Leverage rules in force</span>
          <span>
            The tactical sleeve is capped at {formatPct(exposure.maxPct, 0)} of portfolio value. Leveraged products
            reset daily, compound path-dependently and decay in choppy markets. Shadow observations never place an order.
          </span>
        </div>
      </div>

      <div className="grid grid--4 section">
        {engine.cores.map((core) => (
          <StatCard
            key={core.symbol}
            label={`${core.symbol} · core`}
            value={core.held ? formatMoney(core.marketValue, 0) : 'Not held'}
            tone="ice"
            delta={core.held ? `${formatSignedMoney(core.unrealizedPL)} (${formatSignedPct(core.unrealizedPLPct)})` : undefined}
            deltaDirection={core.unrealizedPL > 0 ? 'up' : core.unrealizedPL < 0 ? 'down' : 'flat'}
            caption={`${core.name} — ${core.role}. ${core.held ? `${formatShares(core.shares)} shares at ${formatMoney(core.price)}.` : 'Approved core candidate; no position reported.'}`}
            footer={
              <div className="tag-list" style={{ marginTop: 10 }}>
                <TrendBadge trend={core.trend} compact />
                <DipBadge dip={core.dip} />
              </div>
            }
          />
        ))}
        {engine.tactical.map((tac) => (
          <StatCard
            key={tac.symbol}
            label={`${tac.symbol} · ${tac.leverage}× tactical`}
            value={tac.held ? formatMoney(tac.marketValue, 0) : 'Not held'}
            delta={tac.held ? `${formatSignedMoney(tac.unrealizedPL)} (${formatSignedPct(tac.unrealizedPLPct)})` : undefined}
            deltaDirection={tac.unrealizedPL > 0 ? 'up' : tac.unrealizedPL < 0 ? 'down' : 'flat'}
            badge={{ text: 'Leveraged', tone: 'risk', glyph: '!' }}
            caption={`${tac.name}. Eligible profit redirects toward ${tac.destinationSymbol}. Estimated annual volatility drag ${formatPct(tac.estimatedVolatilityDrag, 1)}.`}
            footer={
              <div className="tag-list" style={{ marginTop: 10 }}>
                <TrendBadge trend={tac.trend} compact />
                <Badge
                  tone={tac.riskReduction.triggered ? 'negative' : 'neutral'}
                  glyph={tac.riskReduction.triggered ? '!' : '·'}
                  title={tac.riskReduction.detail}
                >
                  {ACTION_LABEL[tac.riskReduction.recommendedAction] ?? tac.riskReduction.recommendedAction}
                </Badge>
              </div>
            }
          />
        ))}
      </div>

      <div className="grid grid--wide-left section">
        <Card
          label="Profit waterfall"
          title="Tactical principal → recycled gains"
          hint="These rules are arithmetic, not opinion. The principal watermark is an accounting target, not guaranteed capital protection. Shadow Mode can observe a trigger but cannot execute it."
        >
          <div className="stack">
            {engine.tactical.map((tac) => {
              const h = tac.harvest;
              return (
                <div key={h.symbol}>
                  <div className="row row--between">
                    <strong>{h.symbol} → {h.destinationSymbol}</strong>
                    <div className="row" style={{ gap: 8 }}>
                      <Badge tone={h.enabled ? 'ice' : 'neutral'} glyph={h.enabled ? 'i' : '—'}>
                        {h.enabled ? 'Rule enabled' : 'Rule disabled'}
                      </Badge>
                      <Badge
                        tone={h.armedLive ? 'gold' : h.armed ? 'warning' : 'neutral'}
                        glyph={h.armedLive ? '◆' : h.armed ? '▲' : '·'}
                        title={
                          h.armed && !h.armedLive
                            ? `The price condition is met, but the position is ${h.verification}. The rule cannot be eligible until brokerage ownership and basis are verified.`
                            : undefined
                        }
                      >
                        {h.armedLive ? 'Shadow trigger' : h.armed ? `${h.verification} — trigger` : 'Not triggered'}
                      </Badge>
                    </div>
                  </div>
                  <ProgressBar
                    label={`Gain above principal watermark toward the +${formatPct(h.triggerGainPct, 0)} trigger`}
                    value={h.progressToTrigger ?? 0}
                    valueLabel={h.gainPct == null ? '—' : formatSignedPct(h.gainPct, 1)}
                    tone={h.armedLive ? 'gold' : 'ice'}
                    caption={
                      h.triggerPrice != null
                        ? `Trigger ${formatMoney(h.triggerPrice)} · current ${formatMoney(h.price)} · principal watermark ${formatMoney(h.principalWatermark)}`
                        : 'No verified tactical principal watermark is available, so the trigger cannot be evaluated.'
                    }
                  />
                  <div className="grid grid--2" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                    <KeyValue label="Eligible profit">{formatMoney(h.eligibleProfit)}</KeyValue>
                    <KeyValue label="Shadow harvest">
                      {formatMoney(h.harvestProceeds)} ({formatPct(h.harvestPortionPct, 0)} of eligible profit)
                    </KeyValue>
                  </div>
                  <p className="meta">{h.ruleOutcome}</p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card label="Flywheel" title="Tactical gains → permanent core">
          <div className="flywheel">
            {engine.flywheel.map((leg) => (
              <div
                key={`${leg.from}-${leg.to}`}
                className={`flywheel__leg ${leg.armedLive ? 'flywheel__leg--armed' : ''}`}
              >
                <span className="flywheel__node">{leg.from}</span>
                <span className="flywheel__arrow" aria-hidden="true" />
                <span className="flywheel__node">{leg.to}</span>
                <p className="meta" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  {leg.armedLive
                    ? `Shadow trigger — ${formatMoney(leg.proceeds)} of eligible profit would recycle from ${leg.from} into ${leg.to}.`
                    : leg.armed
                      ? `${leg.verification} — the price condition is met, but this leg cannot become execution-eligible until the position is verified.`
                      : `Not triggered. No tactical profit would recycle from ${leg.from} today.`}
                </p>
              </div>
            ))}
            <div className="flywheel__leg">
              <span className="flywheel__node">Cash Queue</span>
              <span className="flywheel__arrow" aria-hidden="true" />
              <span className="flywheel__node">Qualified entries</span>
              <p className="meta" style={{ gridColumn: '1 / -1', margin: 0 }}>
                New funding is optionality. It remains cash until an approved symbol reaches a qualified entry while deterministic risk policy still permits deployment.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Leveraged exposure" title="Sleeve limit" tone="risk">
          <ProgressBar
            label="Leveraged sleeve against its ceiling"
            value={exposure.maxPct > 0 ? exposure.leveragedPct / exposure.maxPct : 0}
            valueLabel={`${formatPct(exposure.leveragedPct, 1)} of ${formatPct(exposure.maxPct, 0)}`}
            tone="risk"
            caption={
              exposure.overLimit
                ? 'Over the configured ceiling. The risk engine will block additions to this sleeve.'
                : `${formatMoney(exposure.headroom, 0)} of headroom remains before the ceiling.`
            }
          />
          <div className="stack stack--tight" style={{ marginTop: 'var(--space-4)' }}>
            <KeyValue label="Leveraged value">{formatMoney(exposure.leveragedValue, 0)}</KeyValue>
            <KeyValue label="Weighted daily leverage">{formatNumber(exposure.weightedLeverage, 2)}×</KeyValue>
          </div>
          {exposure.positions.length ? (
            <div className="table-wrap" style={{ marginTop: 'var(--space-4)' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Symbol</th>
                    <th scope="col">Leverage</th>
                    <th scope="col">Value</th>
                    <th scope="col">Drawdown</th>
                    <th scope="col">Est. drag</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.positions.map((row) => (
                    <tr key={row.symbol}>
                      <th scope="row">{row.symbol}</th>
                      <td className="num">{row.leverage}×</td>
                      <td className="num">{formatMoney(row.marketValue)}</td>
                      <td className="num">{formatPct(row.drawdown, 1)}</td>
                      <td className="num">{formatPct(row.estimatedVolatilityDrag, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="meta" style={{ marginTop: 'var(--space-3)' }}>No leveraged position is currently held.</p>
          )}
        </Card>

        <Card label="Trend detail" title="Why each status was assigned">
          <div className="stack">
            {[...engine.cores, ...engine.tactical].map((item) => (
              <div key={`trend-${item.symbol}`}>
                <div className="row row--between">
                  <strong>{item.symbol}</strong>
                  <TrendBadge trend={item.trend} />
                </div>
                <p className="meta">{item.trend.summary}</p>
                <div className="grid grid--2" style={{ gap: 'var(--space-2)' }}>
                  <KeyValue label="20 / 50 / 200 SMA">
                    {formatMoney(item.trend.sma20)} · {formatMoney(item.trend.sma50)} · {formatMoney(item.trend.sma200)}
                  </KeyValue>
                  <KeyValue label="RSI / volatility">
                    {formatNumber(item.trend.rsi, 1)} · {formatPct(item.trend.volatilityAnnualised, 0)}
                  </KeyValue>
                  <KeyValue label="Drawdown from recent high">{formatPct(item.trend.drawdownFromRecentHigh, 1)}</KeyValue>
                  <KeyValue label="Relative strength (60d)">{formatSignedPct(item.trend.relativeStrength60d, 1)}</KeyValue>
                </div>
                <ul className="bullets">
                  {item.trend.checks.map((check) => (
                    <li key={check.label}>
                      <span aria-hidden="true">{check.passed == null ? '· ' : check.passed ? '✓ ' : '✕ '}</span>
                      {check.label}: {check.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
