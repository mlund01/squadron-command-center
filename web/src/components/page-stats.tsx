interface Stat {
  label: string;
  value: number | string;
  sub?: string;
}

interface PageStatsProps {
  stats: Stat[];
}

export function PageStats({ stats }: PageStatsProps) {
  if (stats.length === 0) return null;
  return (
    <div className={`grid gap-3 mb-6`} style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
      {stats.map((s) => (
        <div key={s.label} className="border rounded-lg p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">{s.value}</p>
          {s.sub && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}
