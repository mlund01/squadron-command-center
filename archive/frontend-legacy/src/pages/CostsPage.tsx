import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { getCostSummary, getInstance } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { FilterChip, InlineStat } from '@/components/ui-shell';
import { cn } from '@/lib/utils';

const PERIODS = [
  { label: 'Today', days: 0 },
  { label: '7d',    days: 7 },
  { label: '30d',   days: 30 },
  { label: '90d',   days: 90 },
  { label: 'All',   days: 365 * 10 },
] as const;

type BreakdownKey = 'type' | 'model' | 'mission';

const chartConfig = {
  output:     { label: 'Output',      color: 'var(--chart-1)' },
  cacheWrite: { label: 'Cache Write', color: 'var(--chart-2)' },
  input:      { label: 'Input',       color: 'var(--chart-3)' },
  cacheRead:  { label: 'Cache Read',  color: 'var(--chart-4)' },
} satisfies ChartConfig;

function fmtCost(c: number) {
  if (c <= 0) return '$0.00';
  if (c < 0.01) return `$${c.toFixed(4)}`;
  if (c < 1) return `$${c.toFixed(3)}`;
  return `$${c.toFixed(2)}`;
}

function fmtNum(n: number) {
  return n.toLocaleString();
}

export function CostsPage() {
  const { id: instanceId } = useParams();
  const [periodDays, setPeriodDays] = useState(30);
  const [chartBreakdown, setChartBreakdown] = useState<BreakdownKey>('type');

  const from = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - periodDays);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }, [periodDays]);
  const to = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const { data: instance } = useQuery({
    queryKey: ['instance', instanceId],
    queryFn: () => getInstance(instanceId!),
    enabled: !!instanceId,
  });

  const { data: byDate } = useQuery({
    queryKey: ['costs', instanceId, 'date', from, to],
    queryFn: () => getCostSummary(instanceId!, from, to, 'date'),
    enabled: !!instanceId,
    refetchInterval: 5000,
  });

  const { data: byModel } = useQuery({
    queryKey: ['costs', instanceId, 'model', from, to],
    queryFn: () => getCostSummary(instanceId!, from, to, 'model'),
    enabled: !!instanceId,
    refetchInterval: 5000,
  });

  const breakdownField = chartBreakdown === 'model' ? 'model' : chartBreakdown === 'mission' ? 'mission_name' : undefined;
  const { data: breakdownData } = useQuery({
    queryKey: ['costs', instanceId, 'breakdown', breakdownField, from, to],
    queryFn: () => getCostSummary(instanceId!, from, to, 'date', breakdownField),
    enabled: !!instanceId && !!breakdownField,
    refetchInterval: 5000,
  });

  const totals = byDate?.totals;

  const { chartData, dynamicChartConfig, dynamicBarKeys } = useMemo(() => {
    const allDates: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
      allDates.push(d.toISOString().slice(0, 10));
    }

    if (chartBreakdown === 'type') {
      const dataMap = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>();
      for (const d of byDate?.byGroup ?? []) {
        dataMap.set(d.groupKey, { input: d.inputCost, output: d.outputCost, cacheRead: d.cacheReadCost ?? 0, cacheWrite: d.cacheWriteCost ?? 0 });
      }
      const data = allDates.map((date) => {
        const existing = dataMap.get(date);
        return { date, output: existing?.output ?? 0, cacheWrite: existing?.cacheWrite ?? 0, input: existing?.input ?? 0, cacheRead: existing?.cacheRead ?? 0 };
      });
      return { chartData: data, dynamicChartConfig: chartConfig, dynamicBarKeys: ['output', 'cacheWrite', 'input', 'cacheRead'] };
    }

    const rows = breakdownData?.byDateAndField ?? [];
    const fieldKeys = [...new Set(rows.map((r) => r.fieldKey))];

    const dateMap = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const existing = dateMap.get(row.date) ?? {};
      existing[row.fieldKey] = row.totalCost;
      dateMap.set(row.date, existing);
    }

    const data = allDates.map((date) => {
      const fields = dateMap.get(date) ?? {};
      const entry: Record<string, unknown> = { date };
      for (const key of fieldKeys) entry[key] = fields[key] ?? 0;
      return entry;
    });

    const themeColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
    const config: ChartConfig = {};
    fieldKeys.forEach((key, i) => {
      config[key] = { label: key, color: themeColors[i % themeColors.length] };
    });

    return { chartData: data, dynamicChartConfig: config, dynamicBarKeys: fieldKeys };
  }, [chartBreakdown, byDate, breakdownData, from, to]);

  const modelData = (byModel?.byGroup ?? []).sort((a, b) => b.totalCost - a.totalCost);
  const recentMissions = useMemo(() => byDate?.recentMissions ?? [], [byDate]);

  const missionTypeData = useMemo(() => {
    const nameMap = new Map<string, { cost: number; turns: number }>();
    for (const m of recentMissions) {
      const existing = nameMap.get(m.missionName) ?? { cost: 0, turns: 0 };
      existing.cost += m.totalCost;
      existing.turns += m.turns;
      nameMap.set(m.missionName, existing);
    }
    return [...nameMap.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost);
  }, [recentMissions]);

  const maxModelCost = modelData.length > 0 ? modelData[0].totalCost : 1;
  const maxMissionCost = missionTypeData.length > 0 ? missionTypeData[0].cost : 1;

  const periodLabel = PERIODS.find((p) => p.days === periodDays)?.label ?? '';

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="flex items-end gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">Costs</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            {instance?.name ?? '—'} · {periodLabel.toLowerCase()}
          </span>
        </div>
      </div>

      {/* Stats + period chips strip */}
      <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
        <InlineStat k="total" v={fmtCost(totals?.totalCost ?? 0)} emphasize />
        <InlineStat k="turns" v={fmtNum(totals?.totalTurns ?? 0)} />
        <InlineStat k="input" v={fmtCost(totals?.inputCost ?? 0)} />
        <InlineStat k="cache r" v={fmtCost(totals?.cacheReadCost ?? 0)} />
        <InlineStat k="cache w" v={fmtCost(totals?.cacheWriteCost ?? 0)} />
        <InlineStat k="output" v={fmtCost(totals?.outputCost ?? 0)} />

        <span className="flex-1" />

        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <FilterChip
              key={p.days}
              active={periodDays === p.days}
              onClick={() => setPeriodDays(p.days)}
            >
              {p.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Cost breakdown chart */}
      <Panel
        title="Cost Breakdown"
        action={
          <div className="flex items-center gap-1">
            {([['type', 'By Type'], ['model', 'By Model'], ['mission', 'By Mission']] as const).map(([key, label]) => (
              <FilterChip
                key={key}
                active={chartBreakdown === key}
                onClick={() => setChartBreakdown(key)}
              >
                {label}
              </FilterChip>
            ))}
          </div>
        }
      >
        {chartData.length > 0 ? (
          <ChartContainer config={dynamicChartConfig} className="h-[260px] w-full">
            <BarChart data={chartData} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => (
                      <div className="flex items-center justify-between gap-4 w-full">
                        <span className="text-muted-foreground">
                          {(dynamicChartConfig as Record<string, { label?: React.ReactNode }>)[name as string]?.label ?? name}
                        </span>
                        <span className="font-medium tabular-nums">{fmtCost(Number(value))}</span>
                      </div>
                    )}
                    labelFormatter={(label) =>
                      new Date(label + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    }
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {dynamicBarKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={`var(--color-${key})`}
                  stackId="cost"
                  radius={i === dynamicBarKeys.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">No cost data for this period.</p>
        )}
      </Panel>

      {/* Horizontal bars — model and mission-type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mt-3.5">
        <Panel title="Cost by Model">
          {modelData.length > 0 ? (
            <div className="space-y-2.5">
              {modelData.map((m) => (
                <BarRow
                  key={m.groupKey}
                  name={m.groupKey}
                  turns={m.turns}
                  cost={m.totalCost}
                  ratio={m.totalCost / maxModelCost}
                  color="var(--chart-1)"
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No cost data for this period.</p>
          )}
        </Panel>

        <Panel title="Cost by Mission Type">
          {missionTypeData.length > 0 ? (
            <div className="space-y-2.5">
              {missionTypeData.map((m) => (
                <BarRow
                  key={m.name}
                  name={m.name}
                  turns={m.turns}
                  cost={m.cost}
                  ratio={m.cost / maxMissionCost}
                  color="var(--chart-2)"
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No cost data for this period.</p>
          )}
        </Panel>
      </div>

      {/* Recent runs */}
      <Panel title="Recent Mission Runs" className="mt-3.5">
        {recentMissions.length > 0 ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-muted-foreground/80 border-b border-border/60">
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider font-medium">Mission</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider font-medium">Status</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider font-medium text-right">Turns</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider font-medium text-right">Est. Cost</th>
                <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider font-medium text-right">Started</th>
              </tr>
            </thead>
            <tbody>
              {recentMissions.map((m) => (
                <tr key={m.missionId} className="border-b border-border/40 last:border-0 hover:bg-accent/20 transition-colors">
                  <td className="px-2 py-1.5">
                    <Link
                      to={`/instances/${instanceId}/runs/${m.missionId}`}
                      className="font-mono text-foreground hover:text-primary hover:underline"
                    >
                      {m.missionName}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge
                      variant={m.status === 'completed' ? 'default' : m.status === 'failed' ? 'destructive' : 'outline'}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {m.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-mono">{m.turns}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-mono font-medium">{fmtCost(m.totalCost)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground font-mono text-[11.5px]">
                    {new Date(m.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground">No mission runs with cost data.</p>
        )}
      </Panel>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-sm border border-border/60 bg-card p-4', className)}>
      <div className="flex items-center gap-2 mb-3.5">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 font-medium">
          {title}
        </h2>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

function BarRow({
  name,
  turns,
  cost,
  ratio,
  color,
}: {
  name: string;
  turns: number;
  cost: number;
  ratio: number;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-mono truncate">{name}</span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground tabular-nums font-mono text-[11px]">{turns} turns</span>
          <span className="tabular-nums font-mono font-medium w-16 text-right">{fmtCost(cost)}</span>
        </div>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ backgroundColor: color, width: `${Math.max(1, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}
