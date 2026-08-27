import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoneyCompact, formatMoney } from '../core/format.js';
import { AXIS_PROPS, CHART, shortDate } from './theme.js';
import { chartTooltip } from './ChartTooltip.js';

/** Value of today's positions repriced against historical closes. */
export function ValueAreaChart({ data }: { data: { date: string; value: number }[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.gold} stopOpacity={0.34} />
              <stop offset="100%" stopColor={CHART.gold} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={shortDate} minTickGap={44} />
          <YAxis {...AXIS_PROPS} width={58} tickFormatter={(v: number) => formatMoneyCompact(v)} />
          <Tooltip content={chartTooltip({ format: (v) => formatMoney(v), labelFormat: shortDate })} />
          <Area
            type="monotone"
            dataKey="value"
            name="Portfolio value"
            stroke={CHART.gold2}
            strokeWidth={2}
            fill="url(#valueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
