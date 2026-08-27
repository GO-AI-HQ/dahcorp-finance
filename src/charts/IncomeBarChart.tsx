import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '../core/format.js';
import { AXIS_PROPS, CHART, shortMonth } from './theme.js';
import { chartTooltip } from './ChartTooltip.js';

/** Distribution cash actually received, by month. Audited, not modeled. */
export function IncomeBarChart({ data }: { data: { month: string; amount: number }[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="month" {...AXIS_PROPS} tickFormatter={shortMonth} minTickGap={16} />
          <YAxis {...AXIS_PROPS} width={54} tickFormatter={(v: number) => formatMoney(v, 0)} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={chartTooltip({ format: (v) => formatMoney(v), labelFormat: shortMonth })}
          />
          <Bar dataKey="amount" name="Received" fill={CHART.ice} radius={[4, 4, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
