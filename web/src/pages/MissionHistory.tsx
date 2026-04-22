import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { getInstance, getMissionHistory } from '@/api/client';
import { formatTime, formatDuration } from '@/lib/mission-utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | 'running' | 'completed' | 'failed';

export function MissionHistory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const { data: instance } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data: history, isLoading, error } = useQuery({
    queryKey: ['history', id],
    queryFn: () => getMissionHistory(id!),
    enabled: !!id && !!instance?.connected,
    refetchInterval: 10000,
  });

  const runs = useMemo(() => history?.missions ?? [], [history]);
  const total = history?.total ?? 0;
  const completed = runs.filter((m) => m.status === 'completed').length;
  const failed = runs.filter((m) => m.status === 'failed').length;
  const running = runs.filter((m) => m.status === 'running').length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'running':   return m.status === 'running';
        case 'completed': return m.status === 'completed';
        case 'failed':    return m.status === 'failed';
        case 'all':       return true;
      }
    });
  }, [runs, filter, search]);

  return (
    <div className="px-8 py-7 w-full">
      <div className="flex items-end gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">History</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            {instance?.name ?? '—'} · {total} run{total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {!instance?.connected ? (
        <p className="text-muted-foreground">Instance is disconnected. History is unavailable.</p>
      ) : isLoading ? (
        <p className="text-muted-foreground">Loading history…</p>
      ) : error ? (
        <p className="text-destructive">Error: {(error as Error).message}</p>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground">No mission runs yet.</p>
      ) : (
        <>
          <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
            <Stat k="runs" v={total} />
            <Stat k="running" v={running} accent={running > 0 ? 'running' : undefined} />
            <Stat k="completed" v={completed} />
            <Stat k="failed" v={failed} accent={failed > 0 ? 'failed' : undefined} />

            <span className="flex-1" />

            <div className="flex items-center gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'running'} onClick={() => setFilter('running')}>Running</FilterChip>
              <FilterChip active={filter === 'completed'} onClick={() => setFilter('completed')}>Completed</FilterChip>
              <FilterChip active={filter === 'failed'} onClick={() => setFilter('failed')}>Failed</FilterChip>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 border border-border/60 rounded-sm w-[200px] text-foreground/90">
              <Search className="h-3 w-3 text-muted-foreground/70" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search runs"
                className="flex-1 bg-transparent outline-none text-[11.5px] placeholder:text-muted-foreground/60 font-sans"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm mt-10 text-center">No runs match.</p>
          ) : (
            <div className="rounded-sm border border-border/60 overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/60">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Mission</TableHead>
                    <TableHead className="w-32 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Started</TableHead>
                    <TableHead className="w-32 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((m) => (
                    <TableRow
                      key={m.id}
                      className="cursor-pointer border-border/40 hover:bg-accent/20 transition-colors"
                      onClick={() => navigate(`/instances/${id}/runs/${m.id}`)}
                    >
                      <TableCell className="font-mono text-[13px] font-medium truncate">{m.name}</TableCell>
                      <TableCell>
                        <StatusPill status={m.status} />
                      </TableCell>
                      <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                        {formatTime(m.startedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-[11.5px] text-muted-foreground tabular-nums text-right">
                        {m.finishedAt ? formatDuration(m.startedAt, m.finishedAt) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="font-mono text-[10.5px] text-muted-foreground/70 mt-3 tracking-[0.2px]">
            Showing {visible.length} of {total} run{total !== 1 ? 's' : ''}
          </p>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { dot: string; text: string; border: string; bg: string; live?: boolean }> = {
    running:   { dot: 'bg-blue-500',    text: 'text-blue-400',   border: 'border-blue-500/40',   bg: 'bg-blue-500/10',   live: true },
    completed: { dot: 'bg-green-500',   text: 'text-green-400',  border: 'border-green-500/40',  bg: 'bg-green-500/10' },
    failed:    { dot: 'bg-red-500',     text: 'text-red-400',    border: 'border-red-500/40',    bg: 'bg-red-500/10' },
    queued:    { dot: 'bg-amber-500',   text: 'text-amber-400',  border: 'border-amber-500/40',  bg: 'bg-amber-500/10' },
    stopped:   { dot: 'bg-muted-foreground/60', text: 'text-muted-foreground', border: 'border-border', bg: 'bg-muted/40' },
  };
  const s = map[status] ?? { dot: 'bg-muted-foreground/60', text: 'text-muted-foreground', border: 'border-border', bg: 'bg-muted/40' };
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-[1px] font-mono text-[10px] font-semibold uppercase tracking-wider',
      s.border, s.bg, s.text,
    )}>
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className={cn('absolute inset-0 rounded-full', s.dot)} />
        {s.live && <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', s.dot)} />}
      </span>
      {status}
    </span>
  );
}

function Stat({ k, v, accent }: { k: string; v: number; accent?: 'running' | 'failed' }) {
  const tone =
    accent === 'running' ? 'text-blue-400' :
    accent === 'failed' ? 'text-red-400' :
    'text-foreground';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('tabular-nums text-[13px] font-medium', tone)}>{v}</span>
      <span className="tracking-[0.3px]">{k}</span>
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-sans text-[11.5px] px-2.5 py-[3px] rounded-sm border transition-colors cursor-pointer',
        active
          ? 'text-foreground bg-accent/40 border-border'
          : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/20',
      )}
    >
      {children}
    </button>
  );
}
