import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance, getMissionHistory, runMission } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Play, Search } from 'lucide-react';
import { MissionCard, type MissionRunStatus } from '@/components/mission-card';
import { RunMissionDialog } from '@/components/RunMissionDialog';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { MissionInfo, MissionRecordInfo, ScheduleInfo } from '@/api/types';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | 'active' | 'scheduled' | 'failed';

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

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function formatSchedule(s: ScheduleInfo | undefined): string | null {
  if (!s) return null;
  if (s.every) return `@every ${s.every}`;
  if (s.at && s.at.length > 0) {
    const prefix = s.weekdays && s.weekdays.length > 0 ? '@weekly' : '@daily';
    return `${prefix} ${s.at[0]}`;
  }
  if (s.expression) return s.expression;
  return 'scheduled';
}

function normalizeStatus(status: string): MissionRunStatus {
  switch (status) {
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'queued': case 'pending': return 'queued';
    case 'stopped': return 'stopped';
    default: return 'none';
  }
}

export function MissionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [runningMission, setRunningMission] = useState<string | null>(null);
  const [dialogMission, setDialogMission] = useState<MissionInfo | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const { data: history } = useQuery({
    queryKey: ['history', id],
    queryFn: () => getMissionHistory(id!),
    enabled: !!id && !!instance?.connected,
    refetchInterval: 10000,
  });

  const missions = useMemo(() => instance?.config.missions ?? [], [instance]);

  // Index most recent run per mission name
  const lastRunByName = useMemo(() => {
    const map = new Map<string, MissionRecordInfo>();
    for (const r of history?.missions ?? []) {
      const existing = map.get(r.name);
      if (!existing || new Date(r.startedAt).getTime() > new Date(existing.startedAt).getTime()) {
        map.set(r.name, r);
      }
    }
    return map;
  }, [history]);

  const enriched = useMemo(() => {
    return missions.map((m) => {
      const run = lastRunByName.get(m.name);
      const status: MissionRunStatus = run ? normalizeStatus(run.status) : 'none';
      const lastRunAgo = run ? formatTimeAgo(run.finishedAt ?? run.startedAt) : null;
      return { mission: m, status, lastRunAgo };
    });
  }, [missions, lastRunByName]);

  const totalTasks = missions.reduce((s, m) => s + (m.tasks?.length ?? 0), 0);
  const scheduledCount = missions.filter((m) => (m.schedules?.length ?? 0) > 0).length;
  const runningCount = enriched.filter((e) => e.status === 'running').length;
  const failedCount = enriched.filter((e) => e.status === 'failed').length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ mission: m, status }) => {
      if (q && !m.name.toLowerCase().includes(q) && !(m.description ?? '').toLowerCase().includes(q)) {
        return false;
      }
      switch (filter) {
        case 'active':    return status === 'running' || status === 'queued';
        case 'scheduled': return (m.schedules?.length ?? 0) > 0;
        case 'failed':    return status === 'failed';
        case 'all':       return true;
      }
    });
  }, [enriched, filter, search]);

  const handleRun = async (mission: MissionInfo) => {
    if (!id) return;
    if (mission.inputs && mission.inputs.length > 0) {
      setDialogMission(mission);
      return;
    }
    setRunningMission(mission.name);
    try {
      const result = await runMission(id, mission.name, {});
      navigate(`/instances/${id}/runs/${result.missionId}`);
    } catch {
      setRunningMission(null);
    }
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  return (
    <div className="px-8 py-7 w-full">
      {/* Header */}
      <div className="flex items-end gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">Missions</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            {instance.name} · {missions.length} configured
          </span>
        </div>
      </div>

      {missions.length === 0 ? (
        <p className="text-muted-foreground">No missions configured.</p>
      ) : (
        <>
          {/* Stats + filters strip */}
          <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
            <Stat k="missions" v={missions.length} />
            <Stat k="tasks" v={totalTasks} />
            <Stat k="scheduled" v={scheduledCount} />
            <Stat k="running" v={runningCount} accent={runningCount > 0 ? 'running' : undefined} />
            {failedCount > 0 && <Stat k="failed" v={failedCount} accent="failed" />}

            <span className="flex-1" />

            <div className="flex items-center gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'active'} onClick={() => setFilter('active')}>Active</FilterChip>
              <FilterChip active={filter === 'scheduled'} onClick={() => setFilter('scheduled')}>Scheduled</FilterChip>
              <FilterChip active={filter === 'failed'} onClick={() => setFilter('failed')}>Failed</FilterChip>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 border border-border/60 rounded-sm w-[200px] text-foreground/90">
              <Search className="h-3 w-3 text-muted-foreground/70" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search missions"
                className="flex-1 bg-transparent outline-none text-[11.5px] placeholder:text-muted-foreground/60 font-sans"
              />
            </div>
          </div>

          {/* Grid */}
          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm mt-10 text-center">No missions match.</p>
          ) : (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {visible.map(({ mission: m, status, lastRunAgo }) => {
                const graph = buildMissionMiniGraph(m);
                const schedule = formatSchedule(m.schedules?.[0]);
                return (
                  <MissionCard
                    key={m.name}
                    name={m.name}
                    description={m.description}
                    tasks={m.tasks?.length ?? 0}
                    agents={m.agents?.length ?? 0}
                    inputs={m.inputs?.length ?? 0}
                    schedule={schedule}
                    lastStatus={status}
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
                );
              })}
            </div>
          )}
        </>
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
