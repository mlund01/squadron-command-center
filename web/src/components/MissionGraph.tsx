import { useEffect, useMemo, useState } from 'react';
import dagre from 'dagre';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, GitBranch, Maximize2, Minimize2, Network, Repeat2 } from 'lucide-react';
import type { MissionInfo, TaskInfo } from '@/api/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const taskWidth = 224;
const taskHeight = 96;
const missionWidth = 184;
const missionHeight = 64;

export type MissionTaskTelemetry = {
  status: string;
  error?: string;
  durationMs?: number;
  iteration?: MissionIterationTelemetry;
};

export type MissionIterationTelemetry = {
  completed: number;
  failed: number;
  parallel: boolean;
  running: number;
  total: number;
  lanes: Array<{ index: number; status: string; start: number; end: number }>;
};

type TaskNodeData = {
  task: TaskInfo;
  telemetry?: MissionTaskTelemetry;
  selected: boolean;
  [key: string]: unknown;
};

type MissionNodeData = {
  name: string;
  active: boolean;
  [key: string]: unknown;
};

type GraphTaskNode = Node<TaskNodeData, 'task'>;
type GraphMissionNode = Node<MissionNodeData, 'mission'>;

const nodeTypes: NodeTypes = { task: TaskNode, mission: MissionRouteNode };

export function MissionGraph({
  mission,
  onSelectTask,
  routeChoices,
  selectedTask,
  telemetry,
}: {
  mission: MissionInfo;
  onSelectTask?: (task: TaskInfo) => void;
  routeChoices?: Record<string, string>;
  selectedTask?: string;
  telemetry?: Record<string, MissionTaskTelemetry>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const graph = useMemo(
    () => layoutMission(mission.tasks ?? [], selectedTask, telemetry, routeChoices),
    [mission.tasks, routeChoices, selectedTask, telemetry],
  );
  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const task = (node.data as TaskNodeData).task;
    if (task) onSelectTask?.(task);
  };

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    function collapse(event: KeyboardEvent) {
      if (event.key === 'Escape') setExpanded(false);
    }
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', collapse);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', collapse);
    };
  }, [expanded]);

  useEffect(() => {
    if (!flow) return;
    const frame = window.requestAnimationFrame(() => {
      void flow.fitView({ duration: 180, maxZoom: 1, padding: expanded ? 0.08 : 0.18 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, flow]);

  if (graph.nodes.length === 0) {
    return <div className="grid h-full min-h-80 place-items-center text-xs text-muted-foreground">This mission has no tasks.</div>;
  }

  return <div className={cn('relative h-full min-h-0', expanded && 'fixed inset-0 z-50 bg-background')}>
    {expanded && <div className="absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-3 border-b bg-background px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{mission.name}</p>
        <p className="text-[10px] text-muted-foreground">Mission canvas</p>
      </div>
      <span className="hidden text-[10px] text-muted-foreground sm:inline">Esc to close</span>
      <Button aria-label="Exit full screen" className="size-8" onClick={() => setExpanded(false)} title="Exit full screen (Esc)" variant="ghost">
        <Minimize2 className="size-4" />
      </Button>
    </div>}
    {!expanded && <Button aria-label="View canvas full screen" className="absolute right-3 top-3 z-20 size-8 border bg-card/95 shadow-sm" onClick={() => setExpanded(true)} title="View canvas full screen" variant="ghost">
      <Maximize2 className="size-4" />
    </Button>}
    <div className={cn('h-full min-h-0', expanded && 'pt-12')}>
      <ReactFlow
        edges={graph.edges}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        maxZoom={1.5}
        minZoom={0.2}
        nodes={graph.nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodeTypes={nodeTypes}
        onInit={setFlow}
        onNodeClick={handleNodeClick}
        panOnDrag
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Background color="var(--border)" gap={20} size={1} />
        <Controls className="!border-border !bg-card !shadow-none [&>button]:!border-border [&>button]:!bg-card [&>button]:!fill-foreground" position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  </div>;
}

function TaskNode({ data }: NodeProps<GraphTaskNode>) {
  const { task, telemetry, selected } = data;
  const status = telemetry?.status ?? 'configured';
  return <div className="relative w-56">
    {task.iterator && <><div className="absolute inset-0 translate-x-2 translate-y-2 rounded-md border bg-card/50" /><div className="absolute inset-0 translate-x-1 translate-y-1 rounded-md border bg-card/80" /></>}
    <Handle className="!size-2 !border-background !bg-muted-foreground" position={Position.Left} type="target" />
    <div className={cn(
      'relative h-24 rounded-md border-2 bg-card p-3 shadow-sm transition-colors',
      selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      status === 'completed' && 'border-emerald-500/70',
      status === 'running' && 'border-primary',
      status === 'failed' && 'border-destructive',
      status === 'stopped' && 'border-amber-500/70',
      status === 'configured' && 'border-border',
    )}>
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={status} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{task.name}</span>
        {task.router ? <GitBranch className="size-3.5 shrink-0 text-muted-foreground" /> : task.iterator ? <Repeat2 className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      </div>
      <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{markdownExcerpt(telemetry?.error || task.objective || task.description || 'No objective provided.')}</p>
      <div className="mt-2 flex items-center gap-1.5 text-[9px] text-muted-foreground">
        {task.agent ? <><Bot className="size-2.5" /><span className="truncate">{task.agent}</span></> : task.commander ? <><Network className="size-2.5" /><span>Commander</span></> : <span>Mission agents</span>}
        {telemetry?.iteration ? <span className="ml-auto shrink-0 tabular-nums">{telemetry.iteration.total} {telemetry.iteration.parallel ? 'parallel' : 'sequential'} · {telemetry.iteration.completed}/{telemetry.iteration.total}</span> : telemetry?.durationMs != null && <span className="ml-auto tabular-nums">{formatCompactDuration(telemetry.durationMs)}</span>}
      </div>
    </div>
    <Handle className="!size-2 !border-background !bg-muted-foreground" position={Position.Right} type="source" />
  </div>;
}

function MissionRouteNode({ data }: NodeProps<GraphMissionNode>) {
  return <div className={cn('w-46 rounded-md border-2 border-dashed bg-card p-3', data.active ? 'border-primary' : 'border-border')}><Handle className="!size-2 !border-background !bg-muted-foreground" position={Position.Left} type="target" /><p className="truncate text-xs font-semibold">{data.name}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Mission route</p></div>;
}

function StatusDot({ status }: { status: string }) {
  return <span className={cn('size-2 shrink-0 rounded-full bg-muted-foreground/35', status === 'completed' && 'bg-emerald-500', status === 'running' && 'animate-pulse bg-primary', status === 'failed' && 'bg-destructive', status === 'stopped' && 'bg-amber-500')} />;
}

function markdownExcerpt(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' code example ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function layoutMission(tasks: TaskInfo[], selectedTask?: string, telemetry?: Record<string, MissionTaskTelemetry>, routeChoices?: Record<string, string>) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', ranker: 'network-simplex', nodesep: 34, ranksep: 72, marginx: 28, marginy: 28 });
  const taskNames = new Set(tasks.map((task) => task.name));
  const nodes: Array<GraphTaskNode | GraphMissionNode> = [];
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  const missionTargets = new Map<string, boolean>();
  const normalize = (reference: string) => reference.replace(/^(tasks|missions)\./, '');
  const addEdge = (source: string, target: string, options: { dashed?: boolean; label?: string; active?: boolean } = {}) => {
    if (edgeKeys.has(`${source}->${target}`)) return;
    edgeKeys.add(`${source}->${target}`);
    graph.setEdge(source, target);
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      label: options.label ? truncate(options.label, 36) : undefined,
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 3,
      labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.9 },
      labelStyle: { fill: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: 9 },
      markerEnd: { type: MarkerType.ArrowClosed, color: options.active ? 'var(--primary)' : 'var(--muted-foreground)' },
      style: { stroke: options.active ? 'var(--primary)' : 'var(--muted-foreground)', strokeDasharray: options.dashed ? '5 5' : undefined, strokeWidth: options.active ? 2 : 1.25 },
    });
  };

  tasks.forEach((task) => graph.setNode(task.name, { width: taskWidth, height: taskHeight }));
  tasks.forEach((task) => {
    (task.dependsOn ?? []).map(normalize).filter((name) => taskNames.has(name)).forEach((dependency) => addEdge(dependency, task.name));
    (task.sendTo ?? []).map(normalize).filter((name) => taskNames.has(name)).forEach((target) => addEdge(task.name, target));
    (task.router?.routes ?? []).forEach((route) => {
      const target = normalize(route.target);
      const active = routeChoices?.[task.name] === target;
      if (route.isMission) {
        const id = `mission:${target}`;
        missionTargets.set(target, Boolean(missionTargets.get(target)) || active);
        if (!graph.hasNode(id)) graph.setNode(id, { width: missionWidth, height: missionHeight });
        addEdge(task.name, id, { dashed: true, label: route.condition, active });
      } else if (taskNames.has(target)) {
        addEdge(task.name, target, { dashed: true, label: route.condition, active });
      }
    });
  });
  dagre.layout(graph);

  tasks.forEach((task) => {
    const position = graph.node(task.name);
    nodes.push({ id: task.name, type: 'task', position: { x: position.x - taskWidth / 2, y: position.y - taskHeight / 2 }, data: { task, telemetry: telemetry?.[task.name], selected: task.name === selectedTask } });
  });
  missionTargets.forEach((active, name) => {
    const id = `mission:${name}`;
    const position = graph.node(id);
    nodes.push({ id, type: 'mission', selectable: false, position: { x: position.x - missionWidth / 2, y: position.y - missionHeight / 2 }, data: { name, active } });
  });
  return { nodes, edges };
}

function truncate(value: string, limit: number) { return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`; }
function formatCompactDuration(milliseconds: number) { const seconds = Math.max(0, Math.round(milliseconds / 1000)); return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`; }
