import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getInstance, getMissionHistory, runMission } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Play } from 'lucide-react';
import { MissionCard } from '@/components/mission-card';
import { RunMissionDialog } from '@/components/RunMissionDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatTime, formatDuration, formatTimeAgo, formatSchedule } from '@/lib/mission-utils';
import { FilterChip, InlineStat, SearchBox } from '@/components/ui-shell';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { MissionInfo, MissionRecordInfo } from '@/api/types';
import { cn } from '@/lib/utils';

type ViewKey = 'missions' | 'history';
type FilterKey = 'all' | 'active' | 'scheduled';
type HistoryFilterKey = 'all' | 'running' | 'completed' | 'failed';

const HISTORY_PAGE_SIZE = 50;

function buildMissionMiniGraph(mission: MissionInfo): { nodes: MiniNode[]; edges: MiniEdge[] } {
  const nodes: MiniNode[] = [];
  const edges: MiniEdge[] = [];
  const tasks = mission.tasks ?? [];
  if (tasks.length === 0) return { nodes, edges };

  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      edges.push({ source: `t:${dep}`, target: `t:${t.name}` });
    }
    for (const target of t.sendTo ?? []) {
      edges.push({ source: `t:${t.name}`, target: `t:${target}` });
    }
    if (t.router?.routes) {
      for (const route of t.router.routes) {
        if (route.isMission) {
          const mId = `m:${route.target}`;
          if (!nodes.some(n => n.id === mId)) {
            nodes.push({ id: mId, color: 'teal', size: 'sm' });
          }
          edges.push({ source: `t:${t.name}`, target: mId });
        } else {
          edges.push({ source: `t:${t.name}`, target: `t:${route.target}` });
        }
      }
    }
  }

  for (const t of tasks) {
    nodes.push({ id: `t:${t.name}`, color: 'purple', size: 'sm', stacked: !!t.iterator });
  }

  return { nodes, edges };
}

export function MissionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: ViewKey = searchParams.get('view') === 'history' ? 'history' : 'missions';

  const [runningMission, setRunningMission] = useState<string | null>(null);
  const [dialogMission, setDialogMission] = useState<MissionInfo | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterKey>('all');
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  // Seed the search input from a ?q= query param (e.g. when arriving from a
  // mission detail page's "N runs" link).
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  // Poll every 3s so running / just-finished missions light up (and stop
  // breathing) quickly enough to feel live. Infinite paging drives history scroll.
  const {
    data: historyData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['history-infinite', id],
    queryFn: ({ pageParam }) => getMissionHistory(id!, pageParam as number, HISTORY_PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.missions.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: !!id && !!instance?.connected,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const history = useMemo(() => {
    if (!historyData) return undefined;
    const missions = historyData.pages.flatMap((p) => p.missions);
    const total = historyData.pages[historyData.pages.length - 1]?.total ?? 0;
    return { missions, total };
  }, [historyData]);

  const missions = useMemo(() => instance?.config.missions ?? [], [instance]);

  // Per-mission indices from history: most-recent run + count of currently-running runs
  const { lastRunByName, runningByName } = useMemo(() => {
    const last = new Map<string, MissionRecordInfo>();
    const running = new Map<string, number>();
    for (const r of history?.missions ?? []) {
      const existing = last.get(r.name);
      if (!existing || new Date(r.startedAt).getTime() > new Date(existing.startedAt).getTime()) {
        last.set(r.name, r);
      }
      if (r.status === 'running') {
        running.set(r.name, (running.get(r.name) ?? 0) + 1);
      }
    }
    return { lastRunByName: last, runningByName: running };
  }, [history]);

  // Precompute the per-mission graph + schedule alongside the run stats. This
  // keeps dagre layout off the render hot path — search-box keystrokes would
  // otherwise rebuild every card's graph even for filtered-out rows.
  const enriched = useMemo(() => {
    return missions.map((m) => {
      const run = lastRunByName.get(m.name);
      const runningCount = runningByName.get(m.name) ?? 0;
      const lastRunAgo = run ? formatTimeAgo(run.finishedAt ?? run.startedAt) : null;
      return {
        mission: m,
        runningCount,
        lastRunAgo,
        graph: buildMissionMiniGraph(m),
        schedule: formatSchedule(m.schedules?.[0]),
      };
    });
  }, [missions, lastRunByName, runningByName]);

  const totalTasks = missions.reduce((s, m) => s + (m.tasks?.length ?? 0), 0);
  const scheduledCount = missions.filter((m) => (m.schedules?.length ?? 0) > 0).length;
  const runningCount = enriched.reduce((s, e) => s + e.runningCount, 0);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ mission: m, runningCount }) => {
      if (q && !m.name.toLowerCase().includes(q) && !(m.description ?? '').toLowerCase().includes(q)) {
        return false;
      }
      switch (filter) {
        case 'active':    return runningCount > 0;
        case 'scheduled': return (m.schedules?.length ?? 0) > 0;
        case 'all':       return true;
      }
    });
  }, [enriched, filter, search]);

  // History view — stats + filtered runs
  const runs = useMemo(() => history?.missions ?? [], [history]);
  const totalRuns = history?.total ?? 0;
  const historyCompleted = runs.filter((m) => m.status === 'completed').length;
  const historyFailed = runs.filter((m) => m.status === 'failed').length;
  const historyRunning = runs.filter((m) => m.status === 'running').length;

  const visibleRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
      switch (historyFilter) {
        case 'running':   return m.status === 'running';
        case 'completed': return m.status === 'completed';
        case 'failed':    return m.status === 'failed';
        case 'all':       return true;
      }
    });
  }, [runs, historyFilter, search]);

  useEffect(() => {
    if (view !== 'history') return;
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRun = async (mission: MissionInfo) => {
    if (!id) return;
    if (mission.inputs && mission.inputs.length > 0) {
      setDialogMission(mission);
      return;
    }
    setRunningMission(mission.name);
    try {
      const result = await runMission(id, mission.name, {});
      // Kick an immediate refetch so the breathing card appears without
      // waiting for the next poll interval.
      queryClient.invalidateQueries({ queryKey: ['history-infinite', id] });
      queryClient.invalidateQueries({ queryKey: ['history', id] });
      navigate(`/instances/${id}/runs/${result.missionId}`, {
        state: { from: { kind: 'history' } },
      });
    } catch {
      setRunningMission(null);
    }
  };

  const switchView = (v: ViewKey) => {
    const next = new URLSearchParams(searchParams);
    if (v === 'missions') next.delete('view');
    else next.set('view', v);
    next.delete('q');
    setSearchParams(next, { replace: true });
    setSearch('');
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  const showingMissions = view === 'missions';

  return (
    <div className="px-8 py-7 w-full">
      <div className="flex items-end gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">Missions</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            {showingMissions
              ? `${instance.name} · ${missions.length} configured`
              : `${instance.name} · ${totalRuns} run${totalRuns !== 1 ? 's' : ''}`}
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0 rounded-sm border border-border/60 overflow-hidden font-mono text-[11px]">
          <ViewTab active={showingMissions} onClick={() => switchView('missions')}>Configured</ViewTab>
          <ViewTab active={!showingMissions} onClick={() => switchView('history')}>History</ViewTab>
        </div>
      </div>

      {showingMissions ? (
        missions.length === 0 ? (
          <p className="text-muted-foreground">No missions configured.</p>
        ) : (
          <>
            <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
              <InlineStat k="missions" v={missions.length} />
              <InlineStat k="tasks" v={totalTasks} />
              <InlineStat k="scheduled" v={scheduledCount} />
              <InlineStat k="running" v={runningCount} tone={runningCount > 0 ? 'running' : undefined} />

              <span className="flex-1" />

              <div className="flex items-center gap-1">
                <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
                <FilterChip active={filter === 'active'} onClick={() => setFilter('active')}>Active</FilterChip>
                <FilterChip active={filter === 'scheduled'} onClick={() => setFilter('scheduled')}>Scheduled</FilterChip>
              </div>

              <SearchBox value={search} onChange={setSearch} placeholder="Search missions" />
            </div>

            {visible.length === 0 ? (
              <p className="text-muted-foreground text-sm mt-10 text-center">No missions match.</p>
            ) : (
              <div className="sqd-card-grid">
                {visible.map(({ mission: m, runningCount, lastRunAgo, graph, schedule }) => (
                    <MissionCard
                      key={m.name}
                      name={m.name}
                      description={m.description}
                      tasks={m.tasks?.length ?? 0}
                      agents={m.agents?.length ?? 0}
                      inputs={m.inputs?.length ?? 0}
                      schedule={schedule}
                      runningCount={runningCount}
                      lastRunAgo={lastRunAgo}
                      graph={graph}
                      onClick={() => navigate(`/instances/${id}/missions/${m.name}`)}
                      action={
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground/70 hover:text-foreground"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem
                              disabled={!instance.connected || runningMission === m.name}
                              onClick={() => handleRun(m)}
                            >
                              <Play className="h-3.5 w-3.5 mr-2" />
                              {runningMission === m.name ? 'Starting...' : 'Run Mission'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                ))}
              </div>
            )}
          </>
        )
      ) : (
        !instance.connected ? (
          <p className="text-muted-foreground">Instance is disconnected. History is unavailable.</p>
        ) : runs.length === 0 ? (
          <p className="text-muted-foreground">No mission runs yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
              <InlineStat k="runs" v={totalRuns} />
              <InlineStat k="running" v={historyRunning} tone={historyRunning > 0 ? 'running' : undefined} />
              <InlineStat k="completed" v={historyCompleted} />
              <InlineStat k="failed" v={historyFailed} tone={historyFailed > 0 ? 'failed' : undefined} />

              <span className="flex-1" />

              <div className="flex items-center gap-1">
                <FilterChip active={historyFilter === 'all'} onClick={() => setHistoryFilter('all')}>All</FilterChip>
                <FilterChip active={historyFilter === 'running'} onClick={() => setHistoryFilter('running')}>Running</FilterChip>
                <FilterChip active={historyFilter === 'completed'} onClick={() => setHistoryFilter('completed')}>Completed</FilterChip>
                <FilterChip active={historyFilter === 'failed'} onClick={() => setHistoryFilter('failed')}>Failed</FilterChip>
              </div>

              <SearchBox value={search} onChange={setSearch} placeholder="Search runs" />
            </div>

            {visibleRuns.length === 0 ? (
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
                    {visibleRuns.map((m) => (
                      <TableRow
                        key={m.id}
                        className="cursor-pointer border-border/40 hover:bg-accent/20 transition-colors"
                        onClick={() => navigate(`/instances/${id}/runs/${m.id}`, { state: { from: { kind: 'history' } } })}
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

            <div ref={loadMoreRef} className="h-8" />
            <p className="font-mono text-[10.5px] text-muted-foreground/70 mt-3 tracking-[0.2px]">
              Showing {visibleRuns.length} of {totalRuns} run{totalRuns !== 1 ? 's' : ''}
              {isFetchingNextPage && ' · loading more...'}
            </p>
          </>
        )
      )}

      {dialogMission && (
        <RunMissionDialog
          instanceId={id!}
          mission={dialogMission}
          open={!!dialogMission}
          onOpenChange={(open) => { if (!open) setDialogMission(null); }}
        />
      )}
    </div>
  );
}

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-[5px] transition-colors cursor-pointer',
        active
          ? 'bg-accent text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/25',
      )}
    >
      {children}
    </button>
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

