import { Bar, BarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney } from '../core/format.js';
import { CHART, shortDate } from './theme.js';
import { chartTooltip } from './ChartTooltip.js';

/** Per-share distribution history for one symbol. */
export function DistributionSparkline({
  data,
  height = 52,
}: {
  data: { date: string; amount: number }[];
  height?: number;
}) {
  if (!data.length) return <p className="soft" style={{ fontSize: '0.78rem' }}>No distribution history.</p>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            content={chartTooltip({ format: (v) => `${formatMoney(v, 4)}/share`, labelFormat: shortDate })}
          />
          <Bar dataKey="amount" name="Per share" fill={CHART.gold} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
