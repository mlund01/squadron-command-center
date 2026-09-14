import { useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, Search, Square } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getMissionHistory, getWorkspaceConfig, listWorkspaces } from '@/api/client';
import type { MissionRun } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type RunFilter = 'all' | 'running' | 'completed' | 'failed' | 'stopped';

export function RunsPage() {
  const { workspaceId } = useParams();
  const [filter, setFilter] = useState<RunFilter>('all');
  const [search, setSearch] = useState('');
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  const snapshot = useQuery({
    queryKey: ['workspace-config', workspaceId],
    queryFn: () => getWorkspaceConfig(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['mission-history', snapshot.data?.instanceId],
    queryFn: () => getMissionHistory(snapshot.data!.instanceId),
    enabled: Boolean(snapshot.data?.instanceId && snapshot.data.connected),
    refetchInterval: (query) => query.state.data?.missions.some((run) => run.status === 'running') ? 2_000 : 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const runs = useMemo(() => history.data?.missions ?? [], [history.data]);
  const visibleRuns = useMemo(() => {
    const query = search.trim().toLowerCase();
    return runs.filter((run) => {
      const matchesSearch = !query || `${run.name} ${run.id} ${run.status}`.toLowerCase().includes(query);
      return matchesSearch && (filter === 'all' || run.status === filter);
    });
  }, [filter, runs, search]);

  const running = runs.filter((run) => run.status === 'running').length;
  const completed = runs.filter((run) => run.status === 'completed').length;
  const failed = runs.filter((run) => run.status === 'failed').length;
  const stopped = runs.filter((run) => run.status === 'stopped').length;

  return (
    <div>
      <PageHeader
        description="Inspect active and historical mission executions in this workspace."
        eyebrow={workspace?.name ?? 'Workspace'}
        title="Runs"
      />

      {snapshot.data && !snapshot.data.connected ? (
        <RunState
          description="Run history currently lives with this workspace's Squadron runner. Start the runner to inspect it."
          title="Runner disconnected"
        />
      ) : snapshot.isLoading ? (
        <RunState title="Connecting to workspace runner…" />
      ) : snapshot.isError ? (
        <RunState
          description="Connect a Squadron runner to this workspace before viewing run history."
          title="No runner configuration available"
        />
      ) : history.isLoading ? (
        <RunState title="Loading run history…" />
      ) : history.isError ? (
        <RunState
          description="The runner did not return its mission history. It may still be reconnecting."
          title="Unable to load runs"
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <RunStat label="runs" value={history.data?.total ?? runs.length} />
            <RunStat label="running" tone="running" value={running} />
            <RunStat label="completed" value={completed} />
            <RunStat label="failed" tone="failed" value={failed} />
            {stopped > 0 && <RunStat label="stopped" value={stopped} />}
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-3 border-b pb-4">
            <div className="flex items-center gap-1">
              {(['all', 'running', 'completed', 'failed', 'stopped'] as const).map((value) => (
                <Button
                  className="capitalize"
                  key={value}
                  onClick={() => setFilter(value)}
                  size="xs"
                  variant={filter === value ? 'secondary' : 'ghost'}
                >
                  {value}
                </Button>
              ))}
            </div>
            <div className="flex-1" />
            <label className="relative min-w-56 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-8 pl-9 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search runs" value={search} />
            </label>
          </div>

          <div className="overflow-x-auto rounded-md border bg-card">
            <div className="min-w-[660px]">
              <div className="grid grid-cols-[minmax(0,1fr)_8rem_11rem_6rem] gap-4 border-b bg-muted/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Mission</span><span>Status</span><span>Started</span><span className="text-right">Duration</span>
              </div>
              {visibleRuns.map((run) => (
                <Link className="grid grid-cols-[minmax(0,1fr)_8rem_11rem_6rem] gap-4 border-b px-4 py-3 text-xs transition-colors last:border-b-0 hover:bg-accent/30" key={run.id} to={`/w/${workspaceId}/missions/${encodeURIComponent(run.name)}/runs/${encodeURIComponent(run.id)}`}>
                  <div className="min-w-0"><p className="truncate font-medium text-foreground">{run.name}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{run.id}</p></div>
                  <RunStatusLabel status={run.status} />
                  <span className="self-center text-muted-foreground">{formatStartedAt(run.startedAt)}</span>
                  <span className="self-center text-right tabular-nums text-muted-foreground">{formatDuration(run)}</span>
                </Link>
              ))}
              {visibleRuns.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {runs.length === 0 ? 'No missions have been run in this workspace.' : 'No runs match this search.'}
                </p>
              )}
            </div>
          </div>
          {runs.length > 0 && (
            <p className="mt-3 text-[10px] text-muted-foreground">Showing {runs.length} of {history.data?.total ?? runs.length} runs</p>
          )}
        </>
      )}
    </div>
  );
}

function RunStatusLabel({ status }: { status: string }) {
  const Icon = status === 'running'
    ? LoaderCircle
    : status === 'failed'
      ? CircleAlert
      : status === 'completed'
        ? CheckCircle2
        : status === 'stopped'
          ? Square
          : Clock3;
  return (
    <span className={cn(
      'flex items-center gap-1.5 self-center capitalize text-muted-foreground',
      status === 'running' && 'text-primary',
      status === 'failed' && 'text-destructive',
    )}>
      <Icon className={cn('size-3', status === 'running' && 'animate-spin')} />{status}
    </span>
  );
}

function RunStat({ label, tone, value }: { label: string; tone?: 'running' | 'failed'; value: number }) {
  return (
    <span>
      <strong className={cn('mr-1.5 font-medium text-foreground', tone === 'running' && value > 0 && 'text-primary', tone === 'failed' && value > 0 && 'text-destructive')}>{value}</strong>
      {label}
    </span>
  );
}

function RunState({ description, title }: { description?: string; title: string }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-md border bg-card px-6 text-center">
      <div>
        <Clock3 className="mx-auto mb-3 size-6 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function formatStartedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(run: MissionRun) {
  const start = new Date(run.startedAt).getTime();
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : run.status === 'running' ? Date.now() : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const seconds = Math.floor((end - start) / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}
