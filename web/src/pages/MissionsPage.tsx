import { useId, useMemo, useState } from 'react';
import dagre from 'dagre';
import { CalendarClock, CheckCircle2, MoreHorizontal, Play, Plus, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getWorkspaceConfig, listWorkspaceMissionSchedules, listWorkspaces } from '@/api/client';
import type { MissionInfo, MissionSchedule, TaskInfo } from '@/api/types';
import { describeSchedule } from '@/lib/schedule-display';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

type MissionFilter = 'all' | 'scheduled';

type CanvasNode = {
  id: string;
  label: string;
  detail: string;
  kind: 'agent' | 'task' | 'output' | 'router' | 'mission';
  stacked?: boolean;
};

type CanvasEdge = [string, string];

type MissionView = {
  mission: MissionInfo;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  schedule?: MissionSchedule;
};

export function MissionsPage() {
  const { workspaceId } = useParams();
  const [filter, setFilter] = useState<MissionFilter>('all');
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  function setSearch(value: string) {
    setParams((current) => {
      if (value) current.set('search', value);
      else current.delete('search');
      return current;
    }, { replace: true });
  }
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
	const schedules = useQuery({ queryKey: ['workspace-mission-schedules', workspaceId], queryFn: () => listWorkspaceMissionSchedules(workspaceId!), enabled: Boolean(workspaceId) });

  const missions = useMemo<MissionView[]>(() => (
    (snapshot.data?.config.missions ?? []).map((mission) => ({
      mission,
      ...buildMissionCanvas(mission.tasks ?? []),
      schedule: schedules.data?.find((schedule) => schedule.missionName === mission.name),
    }))
  ), [schedules.data, snapshot.data]);

  const visibleMissions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return missions.filter(({ mission, schedule }) => {
      const matchesSearch = !query || `${mission.name} ${mission.description ?? ''}`.toLowerCase().includes(query);
      const matchesFilter = filter === 'all' || Boolean(schedule);
      return matchesSearch && matchesFilter;
    });
  }, [filter, missions, search]);

  const totalTasks = missions.reduce((total, item) => total + (item.mission.tasks?.length ?? 0), 0);
  const scheduled = missions.filter((item) => item.schedule).length;

  return (
    <div>
      <PageHeader
        actions={<Button><Plus />New mission</Button>}
        description="Author, review, and run the repeatable work owned by this workspace."
        eyebrow={workspace?.name ?? 'Workspace'}
        title="Missions"
      />

      {snapshot.data?.configError && (
        <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          The runner reported a configuration error: {snapshot.data.configError}
        </div>
      )}

      {snapshot.isLoading ? (
        <MissionState title="Loading workspace configuration…" />
      ) : snapshot.isError ? (
        <MissionState
          description="Start the workspace runner from the workflows directory. Missions will appear here as soon as Squadron reports its configuration."
          title="Waiting for workspace configuration"
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3 border-b pb-4">
            <div className="flex items-center gap-1">
              {(['all', 'scheduled'] as const).map((value) => (
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
              <Input className="h-8 pl-9 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search missions" value={search} />
            </label>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <InlineStat label="missions" value={missions.length} />
            <InlineStat label="tasks" value={totalTasks} />
            <InlineStat label="scheduled" value={scheduled} />
          </div>

          {visibleMissions.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {visibleMissions.map((item) => <MissionCard item={item} key={item.mission.name} workspaceId={workspaceId ?? ''} />)}
            </div>
          ) : (
            <MissionState title={missions.length === 0 ? 'No missions configured.' : 'No missions match this search.'} />
          )}
        </>
      )}
    </div>
  );
}

function MissionCard({ item, workspaceId }: { item: MissionView; workspaceId: string }) {
  const { mission, nodes, edges, schedule } = item;
  const href = `/w/${workspaceId}/missions/${encodeURIComponent(mission.name)}`;
  const tasks = mission.tasks?.length ?? 0;
  const agents = mission.agents?.length ?? 0;
  const inputs = mission.inputs?.length ?? 0;

  return (
    <article className="group overflow-hidden rounded-md border bg-card transition-colors hover:border-foreground/30">
      <Link aria-label={`Open ${mission.name}`} className="block" to={href}><MissionCanvasPreview edges={edges} nodes={nodes} /></Link>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground"><Link className="hover:underline" to={href}>{mission.name}</Link></h2>
            <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{mission.description || 'No directive provided.'}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={`Actions for ${mission.name}`} size="icon-xs" variant="ghost"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link to={href}>Open mission</Link></DropdownMenuItem>
              <DropdownMenuItem><Play />Run mission</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground">
          <span>{tasks} task{tasks === 1 ? '' : 's'}</span>
          <span>·</span>
          <span>{agents} agent{agents === 1 ? '' : 's'}</span>
          {inputs > 0 && <><span>·</span><span>{inputs} input{inputs === 1 ? '' : 's'}</span></>}
          <span className="flex-1" />
          <span className="flex items-center gap-1.5"><CheckCircle2 className="size-3" />Configured</span>
        </div>
        {schedule && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><CalendarClock className="size-3" />{schedule.name || describeSchedule(schedule.cronExpression)}</p>}
      </div>
    </article>
  );
}

function MissionCanvasPreview({ edges, nodes }: { edges: CanvasEdge[]; nodes: CanvasNode[] }) {
  const markerID = useId().replace(/:/g, '');
  const layout = useMemo(() => layoutMissionCanvas(nodes, edges), [edges, nodes]);

  return (
    <div
      className="relative h-44 overflow-hidden border-b bg-muted/40"
      style={{
        backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--border) 45%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 45%, transparent) 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
    >
      {nodes.length === 0 && <span className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">No tasks</span>}
      <svg
        aria-label={`Mission graph with ${nodes.length} nodes and ${edges.length} connections`}
        className="absolute inset-0 size-full p-2"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <marker id={markerID} markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--muted-foreground)" opacity="0.55" />
          </marker>
        </defs>
        {layout.edges.map((edge) => (
          <path
            d={edge.path}
            fill="none"
            key={`${edge.source}-${edge.target}`}
            markerEnd={`url(#${markerID})`}
            opacity={layout.dense ? 0.45 : 0.65}
            stroke="var(--muted-foreground)"
            strokeWidth={layout.dense ? 0.75 : 1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {layout.nodes.map((node) => (
          <g key={node.id}>
            <title>{node.label} — {node.detail}</title>
            {node.stacked && (
              <>
                <rect
                  fill="var(--card)"
                  height={node.height}
                  opacity="0.35"
                  rx={layout.radius}
                  stroke="var(--primary)"
                  vectorEffect="non-scaling-stroke"
                  width={node.width}
                  x={node.x - node.width / 2 + 4}
                  y={node.y - node.height / 2 + 4}
                />
                <rect
                  fill="var(--card)"
                  height={node.height}
                  opacity="0.6"
                  rx={layout.radius}
                  stroke="var(--primary)"
                  vectorEffect="non-scaling-stroke"
                  width={node.width}
                  x={node.x - node.width / 2 + 2}
                  y={node.y - node.height / 2 + 2}
                />
              </>
            )}
            <rect
              fill={node.kind === 'output' || node.kind === 'mission' ? 'var(--secondary)' : 'var(--card)'}
              height={node.height}
              rx={node.kind === 'router' ? node.height / 2 : layout.radius}
              stroke={node.kind === 'agent' || node.stacked ? 'var(--primary)' : node.kind === 'mission' ? 'var(--muted-foreground)' : 'var(--border)'}
              strokeDasharray={node.kind === 'mission' ? '3 2' : undefined}
              strokeWidth={node.kind === 'agent' || node.stacked ? 1.25 : 1}
              vectorEffect="non-scaling-stroke"
              width={node.width}
              x={node.x - node.width / 2}
              y={node.y - node.height / 2}
            />
            {layout.showLabels && (
              <text
                dominantBaseline="middle"
                fill="var(--foreground)"
                fontFamily="var(--font-mono)"
                fontSize={layout.labelSize}
                textAnchor="middle"
                x={node.x}
                y={node.y - (layout.showDetails ? 4 : 0)}
              >
                {truncateNodeLabel(node.label, layout.labelLimit)}
              </text>
            )}
            {layout.showDetails && (
              <text
                dominantBaseline="middle"
                fill="var(--muted-foreground)"
                fontFamily="var(--font-mono)"
                fontSize={6}
                textAnchor="middle"
                x={node.x}
                y={node.y + 7}
              >
                {truncateNodeLabel(node.detail, 17)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {layout.dense && <span className="absolute bottom-2 right-2 rounded-sm border bg-background/80 px-1.5 py-0.5 text-[8px] text-muted-foreground backdrop-blur">{nodes.length} nodes</span>}
    </div>
  );
}

function buildMissionCanvas(tasks: TaskInfo[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  if (tasks.length === 0) return { nodes: [], edges: [] };

  const taskNames = new Set(tasks.map((task) => task.name));
  const normalize = (reference: string) => reference.replace(/^(tasks|missions)\./, '');
  const outgoing = new Set<string>();
  const edges: CanvasEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (source: string, target: string) => {
    if (!taskNames.has(source) || !taskNames.has(target)) return;
    const key = `${source}->${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    outgoing.add(source);
    edges.push([source, target]);
  };
  tasks.forEach((task) => {
    (task.dependsOn ?? []).map(normalize).forEach((dependency) => addEdge(dependency, task.name));
    (task.sendTo ?? []).map(normalize).forEach((target) => addEdge(task.name, target));
    (task.router?.routes ?? []).filter((route) => !route.isMission).map((route) => normalize(route.target)).forEach((target) => addEdge(task.name, target));
  });

  const nodes: CanvasNode[] = tasks.map((task) => ({
    id: task.name,
    label: task.name,
    detail: task.router ? 'Router' : task.iterator ? `Iterates ${normalize(task.iterator.dataset)}` : task.agent || 'Task',
    kind: task.router ? 'router' : task.agent ? 'agent' : outgoing.has(task.name) ? 'task' : 'output',
    stacked: Boolean(task.iterator),
  }));

  tasks.forEach((task) => {
    (task.router?.routes ?? []).filter((route) => route.isMission).forEach((route) => {
      const name = normalize(route.target);
      const id = `mission:${name}`;
      if (!nodes.some((node) => node.id === id)) {
        nodes.push({ id, label: name, detail: 'Mission', kind: 'mission' });
      }
      const key = `${task.name}->${id}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([task.name, id]);
      }
    });
  });

  return { nodes, edges };
}

type CanvasLayout = {
  width: number;
  height: number;
  nodes: Array<CanvasNode & { x: number; y: number; width: number; height: number }>;
  edges: Array<{ source: string; target: string; path: string }>;
  dense: boolean;
  showLabels: boolean;
  showDetails: boolean;
  labelSize: number;
  labelLimit: number;
  radius: number;
};

function layoutMissionCanvas(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasLayout {
  const dense = nodes.length > 18;
  const medium = nodes.length > 7;
  const nodeWidth = dense ? 24 : medium ? 62 : 92;
  const nodeHeight = dense ? 12 : medium ? 24 : 38;
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    ranker: 'network-simplex',
    acyclicer: 'greedy',
    nodesep: dense ? 7 : medium ? 12 : 18,
    ranksep: dense ? 18 : medium ? 28 : 38,
    marginx: 14,
    marginy: 14,
  });
  nodes.forEach((node) => graph.setNode(node.id, { width: nodeWidth, height: nodeHeight }));
  edges.forEach(([source, target]) => graph.setEdge(source, target));
  dagre.layout(graph);

  const graphSize = graph.graph();
  const graphWidth = graphSize.width ?? 120;
  const graphHeight = graphSize.height ?? 80;
  const width = Math.max(graphWidth, 220);
  const height = Math.max(graphHeight, 120);
  const offsetX = (width - graphWidth) / 2;
  const offsetY = (height - graphHeight) / 2;
  return {
    width,
    height,
    nodes: nodes.map((node) => ({
      ...node,
      ...graph.node(node.id),
      x: graph.node(node.id).x + offsetX,
      y: graph.node(node.id).y + offsetY,
      width: nodeWidth,
      height: nodeHeight,
    })),
    edges: graph.edges().map((edge) => ({
      source: edge.v,
      target: edge.w,
      path: smoothEdgePath(graph.edge(edge).points.map((point: { x: number; y: number }) => ({
        x: point.x + offsetX,
        y: point.y + offsetY,
      }))),
    })),
    dense,
    showLabels: !dense,
    showDetails: !medium,
    labelSize: medium ? 7 : 9,
    labelLimit: medium ? 12 : 18,
    radius: dense ? 3 : 5,
  };
}

function smoothEdgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function truncateNodeLabel(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(limit - 1, 1))}…`;
}

function MissionState({ description, title }: { description?: string; title: string }) {
  return (
    <div className="rounded-md border bg-card px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>}
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: number }) {
  return <span><strong className="mr-1.5 font-medium text-foreground">{value}</strong>{label}</span>;
}
