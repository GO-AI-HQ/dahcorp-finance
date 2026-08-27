import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '../core/format.js';
import { AXIS_PROPS, CHART } from './theme.js';
import { chartTooltip } from './ChartTooltip.js';

export interface ProjectionSeries {
  name: string;
  color: string;
  points: { month: number; monthlyIncome: number }[];
}

/**
 * Modeled forward monthly income under each scenario. These are projections
 * under stated assumptions — never presented as expected outcomes.
 */
export function ProjectionChart({ series, target }: { series: ProjectionSeries[]; target: number }) {
  const months = Math.max(...series.map((s) => s.points.length), 0);
  const rows = Array.from({ length: months }, (_, i) => {
    const row: Record<string, number> = { month: i };
    for (const s of series) {
      const point = s.points[i];
      if (point) row[s.name] = point.monthlyIncome;
    }
    return row;
  });

  return (
    <div className="chart chart--tall">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="month"
            {...AXIS_PROPS}
            tickFormatter={(v: number) => `${v}m`}
            minTickGap={28}
          />
          <YAxis {...AXIS_PROPS} width={58} tickFormatter={(v: number) => formatMoney(v, 0)} />
          <Tooltip
            content={chartTooltip({ format: (v) => `${formatMoney(v)}/mo`, labelFormat: (l) => `Month ${l}` })}
          />
          <ReferenceLine
            y={target}
            stroke={CHART.gold}
            strokeDasharray="4 4"
            label={{ value: `Target ${formatMoney(target, 0)}/mo`, fill: CHART.gold, fontSize: 11, position: 'insideTopLeft' }}
          />
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
