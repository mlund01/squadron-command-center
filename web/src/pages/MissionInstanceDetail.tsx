import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  Handle,
  Position,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { ChevronsDown, ChevronsUp, ChevronDown, Repeat, ChevronLeft, ChevronRight, HelpCircle, Square, RotateCcw, ShieldCheck } from 'lucide-react';

import { getInstance, getMissionDetail, getMissionEvents, getTaskDetail, getRunDatasets, getDatasetItems, stopMission, resumeMission, getChatMessages } from '@/api/client';
import { subscribeMissionEvents } from '@/api/sse';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { StatusBadge, formatTime, formatDuration } from '@/lib/mission-utils';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { useHorizontalResize } from '@/hooks/use-horizontal-resize';
import { ZoomControls } from '@/components/zoom-controls';
import type { TaskInfo, MissionEvent, MissionTaskRecord, ToolResultDTO, TaskOutputInfo, SubtaskInfo, DatasetItemInfo } from '@/api/types';
import { RouterEdge } from '@/components/RouterEdge';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { ImageCarousel, extractImages } from '@/components/ImageCarousel';


const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;

/* ── Status-aware task node for run view ── */

function RunTaskNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const task = data as unknown as TaskInfo & { runStatus?: string; runError?: string; hasIncoming?: boolean; hasOutgoing?: boolean };
  const isIterated = !!task.iterator;
  const status = task.runStatus ?? 'pending';

  const borderColor = status === 'completed' ? 'border-green-500'
    : status === 'running' ? 'border-blue-500'
    : status === 'failed' ? 'border-red-500'
    : status === 'stopped' ? 'border-orange-500'
    : 'border-border';

  return (
    <div className="relative">
      {isIterated && (
        <>
          <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-lg border-2 border-border bg-card shadow-sm" />
          <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg border-2 border-border bg-card" />
        </>
      )}
      <div className={cn(
        'relative rounded-lg p-3 cursor-pointer w-[260px] transition-all border-2',
        borderColor,
        selected ? 'bg-muted shadow-sm' : 'bg-card shadow-sm',
        status === 'running' && 'task-pulse',
      )}>
        {task.hasIncoming !== false && <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className={cn(
              'w-2 h-2 rounded-full shrink-0',
              status === 'completed' ? 'bg-green-500' :
              status === 'running' ? 'bg-blue-500 animate-pulse' :
              status === 'failed' ? 'bg-red-500' :
              status === 'stopped' ? 'bg-orange-500' :
              'bg-muted-foreground/30'
            )} />
            <span className="font-semibold text-sm">{task.name}</span>
            {task.agent && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{task.agent}</Badge>
            )}
            {task.commander && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">cmdr</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isIterated && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Repeat className="h-3 w-3" />
                <span>iterated</span>
              </div>
            )}
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0 rounded border border-purple-500/40 text-purple-500">Task</span>
          </div>
        </div>
        {status === 'failed' && task.runError ? (
          <p className="text-xs text-red-500 line-clamp-2">{task.runError}</p>
        ) : task.objective ? (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.objective}</p>
        ) : null}
        {task.hasOutgoing !== false && <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2 !h-2" />}
      </div>
    </div>
  );
}

function TerminalNode() {
  return (
    <div className="cursor-grab">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-orange-500/50 bg-orange-500/5">
        <Square className="w-3.5 h-3.5 text-orange-500 fill-orange-500" />
        <span className="text-sm font-medium text-orange-600">No route taken</span>
      </div>
    </div>
  );
}

function MissionRouteNode({ data }: { data: Record<string, unknown> }) {
  const missionName = data.missionName as string;
  const isActive = data.isActive as boolean | undefined;
  return (
    <div className="relative">
      <div className={cn(
        'relative rounded-lg p-3 cursor-default w-[260px] transition-all border-2',
        isActive ? 'border-teal-500 bg-card shadow-sm' : 'border-border bg-card shadow-sm',
      )}>
        <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-sm">{missionName}</span>
          <span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0 rounded border border-teal-500/40 text-teal-500 shrink-0">Mission</span>
        </div>
      </div>
    </div>
  );
}

const runNodeTypes: NodeTypes = { task: RunTaskNode, terminal: TerminalNode, missionRoute: MissionRouteNode };
const runEdgeTypes: EdgeTypes = { router: RouterEdge };

/* ── Layout helper (reused from MissionDetail) ── */

function layoutGraph(tasks: TaskInfo[], chosenRoutes?: Record<string, string>, statusMap?: Record<string, { status: string }>): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });

  for (const task of tasks) {
    g.setNode(task.name, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Status → color mapping (matches card border colors)
  const statusColor = (status?: string): string | undefined => {
    if (status === 'completed') return '#22c55e';
    if (status === 'running') return '#3b82f6';
    if (status === 'failed') return '#ef4444';
    if (status === 'stopped') return '#f97316';
    return undefined;
  };

  const defaultEdgeColor = '#9ca3af';

  const edgeStyle = (src: string, tgt: string): { style: Record<string, unknown> } => {
    const srcRan = statusMap?.[src]?.status && statusMap[src].status !== 'pending';
    if (!srcRan) return { style: { stroke: defaultEdgeColor, strokeWidth: 2 } };
    const color = statusColor(statusMap?.[tgt]?.status) ?? defaultEdgeColor;
    return { style: { stroke: color, strokeWidth: 2 } };
  };

  const edges: Edge[] = [];
  for (const task of tasks) {
    // Dependency edges (solid)
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        g.setEdge(dep, task.name);
        edges.push({ id: `${dep}->${task.name}`, source: dep, target: task.name, ...edgeStyle(dep, task.name) });
      }
    }
    // Router edges (dotted, with hover tooltip) — skip mission targets (handled below)
    if (task.router) {
      for (const route of task.router.routes) {
        if (route.isMission) continue; // mission route nodes added separately
        g.setEdge(task.name, route.target);
        const srcRan = statusMap?.[task.name]?.status && statusMap[task.name].status !== 'pending';
        const routerColor = srcRan ? (statusColor(statusMap?.[route.target]?.status) ?? defaultEdgeColor) : defaultEdgeColor;
        const routerWidth = routerColor !== defaultEdgeColor ? 2 : 1;
        edges.push({
          id: `${task.name}->route:${route.target}`,
          source: task.name,
          target: route.target,
          type: 'router',
          data: { condition: route.condition },
          style: {
            strokeDasharray: '5,5',
            stroke: routerColor,
            strokeWidth: routerWidth,
          },
        });
      }
    }
    // send_to edges (solid, like depends_on but direction is source→target)
    if (task.sendTo) {
      for (const target of task.sendTo) {
        g.setEdge(task.name, target);
        edges.push({
          id: `${task.name}->send:${target}`,
          source: task.name,
          target: target,
          ...edgeStyle(task.name, target),
        });
      }
    }
  }

  // Add mission route nodes (virtual nodes for cross-mission router targets)
  const missionNodes: { id: string; missionName: string; isActive: boolean }[] = [];
  const taskNames = new Set(tasks.map(t => t.name));
  for (const task of tasks) {
    if (task.router) {
      for (const route of task.router.routes) {
        if (route.isMission && !taskNames.has(route.target)) {
          const missionNodeId = `mission:${route.target}`;
          const isActive = chosenRoutes?.[task.name] === route.target;
          missionNodes.push({ id: missionNodeId, missionName: route.target, isActive: !!isActive });
          g.setNode(missionNodeId, { width: NODE_WIDTH, height: NODE_HEIGHT });
          g.setEdge(task.name, missionNodeId);
          const missionColor = isActive ? '#14b8a6' : defaultEdgeColor;
          edges.push({
            id: `${task.name}->mission:${route.target}`,
            source: task.name,
            target: missionNodeId,
            type: 'router',
            data: { condition: route.condition },
            style: { strokeDasharray: '5,5', stroke: missionColor, strokeWidth: isActive ? 2 : 1 },
          });
        }
      }
    }
  }

  // Add terminal "end" nodes for routers that chose "none"
  const terminalNodes: string[] = [];
  if (chosenRoutes) {
    for (const task of tasks) {
      if (task.router && chosenRoutes[task.name] === 'none') {
        const termId = `${task.name}__end`;
        terminalNodes.push(termId);
        g.setNode(termId, { width: 160, height: 40 });
        g.setEdge(task.name, termId);
        edges.push({
          id: `${task.name}->end`,
          source: task.name,
          target: termId,
          style: { strokeDasharray: '5,5', stroke: '#f97316', strokeWidth: 2 },
        });
      }
    }
  }

  dagre.layout(g);

  const hasIncoming = new Set(edges.map(e => e.target));
  const hasOutgoing = new Set(edges.map(e => e.source));

  const nodes: Node[] = tasks.map((task) => {
    const pos = g.node(task.name);
    return {
      id: task.name,
      type: 'task',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { ...task, hasIncoming: hasIncoming.has(task.name), hasOutgoing: hasOutgoing.has(task.name) } as unknown as Record<string, unknown>,
    };
  });

  // Add mission route node positions
  for (const mn of missionNodes) {
    const pos = g.node(mn.id);
    nodes.push({
      id: mn.id,
      type: 'missionRoute',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      selectable: false,
      draggable: false,
      data: { missionName: mn.missionName, isActive: mn.isActive },
    });
  }

  // Add terminal node positions
  for (const termId of terminalNodes) {
    const pos = g.node(termId);
    nodes.push({
      id: termId,
      type: 'terminal',
      position: { x: pos.x - 80, y: pos.y - 20 },
      selectable: false,
      draggable: false,
      data: {},
    });
  }

  return { nodes, edges };
}

/* ── Parse task config JSON into TaskInfo ── */

function parseTaskConfig(task: MissionTaskRecord): TaskInfo | null {
  if (!task.configJson) return null;
  try {
    return JSON.parse(task.configJson) as TaskInfo;
  } catch {
    return null;
  }
}

/* ── Event helpers ── */

const VERBOSE_EVENTS = new Set([
  'session_turn',
]);

function getEventColor(eventType: string): string {
  if (eventType.includes('failed') || eventType.includes('error') || eventType.includes('retrying')) return 'text-red-400';
  if (eventType.includes('reasoning')) return 'text-blue-400';
  if (eventType.includes('calling_tool') || eventType.includes('tool_complete')) return 'text-teal-400';
  if (eventType.includes('answer') || eventType.includes('ask_commander') || eventType.includes('commander_response')) return 'text-emerald-400';
  if (eventType === 'compaction' || eventType === 'route_chosen') return 'text-violet-400';
  if (eventType.includes('started') || eventType.includes('completed')) return 'text-purple-400';
  return 'text-muted-foreground';
}

function formatEventSummary(eventType: string, d: Record<string, unknown>): string {
  switch (eventType) {
    case 'mission_started': return `Mission "${d.missionName}" started (${d.taskCount} tasks)`;
    case 'mission_completed': return `Mission "${d.missionName}" completed`;
    case 'mission_failed': return `Mission failed: ${d.error}`;
    case 'task_started': return `Task "${d.taskName}" started`;
    case 'task_completed': return `Task "${d.taskName}" completed`;
    case 'task_failed': return `Task "${d.taskName}" failed: ${d.error}`;
    case 'task_iteration_started': return `Iteration started for "${d.taskName}" — ${d.totalItems} items (${d.parallel ? 'parallel' : 'sequential'})`;
    case 'task_iteration_completed': return `Iteration completed for "${d.taskName}" — ${d.completedCount} done`;
    case 'agent_started': return `Agent "${d.agentName}" started for "${d.taskName}"`;
    case 'agent_completed': return `Agent "${d.agentName}" completed`;
    case 'agent_calling_tool': return `Agent "${d.agentName}" calling tool "${d.toolName}"`;
    case 'agent_tool_complete': return `Agent "${d.agentName}" tool "${d.toolName}" complete`;
    case 'agent_reasoning_started': return `Agent "${d.agentName}" reasoning...`;
    case 'agent_reasoning_completed': return `Agent "${d.agentName}" reasoning complete`;
    case 'agent_answer': return `Agent "${d.agentName}" answered`;
    case 'agent_ask_commander': return `Agent "${d.agentName}" asking commander`;
    case 'agent_commander_response': return `Commander responded to "${d.agentName}"`;
    case 'commander_calling_tool': return `Commander calling "${d.toolName}" for "${d.taskName}"`;
    case 'commander_tool_complete': return `Commander tool "${d.toolName}" complete for "${d.taskName}"`;
    case 'commander_reasoning_started': return `Commander reasoning for "${d.taskName}"...`;
    case 'commander_reasoning_completed': return `Commander reasoning complete for "${d.taskName}"`;
    case 'commander_answer': return `Commander answered for "${d.taskName}"`;
    case 'iteration_started': return `Iteration ${d.index} started for "${d.taskName}"`;
    case 'iteration_completed': return `Iteration ${d.index} completed for "${d.taskName}"`;
    case 'iteration_failed': return `Iteration ${d.index} failed for "${d.taskName}": ${d.error}`;
    case 'iteration_retrying': return `Iteration ${d.index} retrying for "${d.taskName}" (attempt ${d.attempt}/${d.maxRetries})`;
    case 'compaction': return `Context compacted (${d.entity}) — ${d.messagesCompacted} msgs removed (${Number(d.inputTokens).toLocaleString()}/${Number(d.tokenLimit).toLocaleString()} tokens)`;
    case 'route_chosen': return `Route: "${d.routerTask}" → "${d.targetTask}"${d.condition ? ` (${d.condition})` : ''}`;
    case 'session_turn': return `Turn: ${d.entity} for "${d.taskName}" — ${d.model} (${Number(d.inputTokens).toLocaleString()} in, ${Number(d.outputTokens).toLocaleString()} out)`;
    default: return eventType.replace(/_/g, ' ');
  }
}

function getEventExpandableContent(eventType: string, d: Record<string, unknown>): string | null {
  if (eventType === 'agent_calling_tool' || eventType === 'commander_calling_tool') {
    return String(d.input || d.payload || '');
  }
  if (eventType === 'agent_tool_complete' || eventType === 'commander_tool_complete') {
    return String(d.result || d.output || '');
  }
  if (eventType === 'agent_reasoning_completed' || eventType === 'commander_reasoning_completed') {
    return String(d.content || '');
  }
  if (eventType === 'agent_answer' || eventType === 'commander_answer') {
    return String(d.content || '');
  }
  if (eventType === 'agent_ask_commander' || eventType === 'agent_commander_response') {
    return String(d.content || '');
  }
  if (eventType === 'task_started' || eventType === 'iteration_started') {
    return String(d.objective || '');
  }
  if (eventType === 'agent_started' && d.instruction) {
    return String(d.instruction);
  }
  return null;
}

/* ── General Tab ── */

function GeneralTab({ mission, tasks }: { mission: { name: string; status: string; inputsJson?: string; startedAt: string; finishedAt?: string }; tasks: MissionTaskRecord[] }) {
  return (
    <div className="overflow-y-auto p-4 h-full">
      <div className="space-y-4 max-w-2xl">
        <div className="flex items-center gap-3">
          <StatusBadge status={mission.status} />
          <span className="text-sm text-muted-foreground">{formatTime(mission.startedAt)}</span>
          {mission.finishedAt && (
            <span className="text-sm text-muted-foreground">({formatDuration(mission.startedAt, mission.finishedAt)})</span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/50 rounded-lg p-3">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Tasks</span>
            <p className="text-lg font-bold mt-1">{tasks.length}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Completed</span>
            <p className="text-lg font-bold mt-1">{tasks.filter(t => t.status === 'completed').length}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Failed</span>
            <p className="text-lg font-bold mt-1 text-red-500">{tasks.filter(t => t.status === 'failed').length}</p>
          </div>
        </div>

        {/* Inputs shown in dedicated Inputs tab */}
      </div>
    </div>
  );
}

/* ── Datasets Tab ── */

function DatasetsTab({ instanceId, missionId, isRunning }: { instanceId: string; missionId: string; isRunning: boolean }) {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: datasetsData } = useQuery({
    queryKey: ['runDatasets', instanceId, missionId],
    queryFn: () => getRunDatasets(instanceId, missionId),
    refetchInterval: isRunning ? 2000 : false,
  });

  const datasets = datasetsData?.datasets ?? [];

  // Auto-select first dataset
  useEffect(() => {
    if (!selectedDatasetId && datasets.length > 0) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  const { data: itemsData } = useQuery({
    queryKey: ['datasetItems', instanceId, selectedDatasetId, page],
    queryFn: () => getDatasetItems(instanceId, selectedDatasetId!, page * PAGE_SIZE, PAGE_SIZE),
    enabled: !!selectedDatasetId,
    refetchInterval: isRunning ? 2000 : false,
  });

  const items = useMemo(() => {
    if (!itemsData?.items) return [];
    return itemsData.items.map(raw => {
      try { return JSON.parse(raw); } catch { return raw; }
    });
  }, [itemsData?.items]);

  const columns = useMemo(() => {
    if (items.length === 0) return [];
    const first = items[0];
    if (typeof first === 'object' && first !== null) return Object.keys(first);
    return ['value'];
  }, [items]);

  const totalPages = Math.ceil((itemsData?.total ?? 0) / PAGE_SIZE);
  const selectedDataset = datasets.find(d => d.id === selectedDatasetId);

  if (!datasets.length) {
    return <p className="text-sm text-muted-foreground p-4">No datasets for this run.</p>;
  }

  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {datasets.map(ds => (
            <button
              key={ds.id}
              onClick={() => { setSelectedDatasetId(ds.id); setPage(0); }}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedDatasetId === ds.id && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{ds.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1 shrink-0">{ds.itemCount}</Badge>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedDataset && items.length > 0 ? (
          <>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">#</th>
                    {columns.map(col => (
                      <th key={col} className="text-left px-3 py-2 font-medium text-muted-foreground">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-1.5 text-muted-foreground">{page * PAGE_SIZE + i + 1}</td>
                      {columns.map(col => {
                        const val = typeof item === 'object' ? item[col] : item;
                        const display = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
                        return (
                          <td key={col} className="px-3 py-1.5 max-w-xs truncate">{display}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
                <span>Page {page + 1} of {totalPages} ({itemsData?.total} items)</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : selectedDataset ? (
          <p className="text-sm text-muted-foreground p-4">No items in this dataset.</p>
        ) : null}
      </div>
    </div>
  );
}

/* ── Tasks Tab (Gantt + Session Detail) ── */

type PanelSelection =
  | { type: 'session'; sessionId: string; agentName?: string }
  | { type: 'tool'; toolResult: ToolResultDTO; spanId?: string }
  | null;

interface GanttSpan {
  id: string;
  label: string;
  start: number;
  end: number;
  category: 'commander' | 'agent' | 'tool' | 'dataset_next';
  sessionId?: string;
  toolResult?: ToolResultDTO;
}

// A top-level row in the execution trace (commander or agent session)
// with expandable child tool call spans
interface TraceRow {
  id: string;
  label: string;
  start: number;
  end: number;
  category: 'commander' | 'agent';
  sessionId?: string;
  segments?: { start: number; end: number }[]; // active time ranges (when split by stop/resume)
  children: GanttSpan[]; // tool call spans within this session
}

const SPAN_COLORS: Record<GanttSpan['category'] | TraceRow['category'], string> = {
  commander: 'bg-purple-500',
  agent: 'bg-purple-500',
  tool: 'bg-teal-500',
  dataset_next: 'bg-violet-500',
};

const SPAN_COLORS_HEX: Record<GanttSpan['category'] | TraceRow['category'], string> = {
  commander: '#a855f7',
  agent: '#a855f7',
  tool: '#14b8a6',
  dataset_next: '#8b5cf6',
};

function IterationBar({
  iterations,
  selectedIteration,
  onSelectIteration,
  onSelectAll,
  datasetItems,
  borderTop,
}: {
  iterations: number[];
  selectedIteration: number | null;
  onSelectIteration: (idx: number) => void;
  onSelectAll?: () => void;
  datasetItems: DatasetItemInfo[];
  borderTop?: boolean;
}) {
  // Build pagination pages: show all if <= 9, otherwise [1] ... [sel-1] [sel] [sel+1] ... [N]
  const pages = useMemo(() => {
    const n = iterations.length;
    if (n <= 9) return iterations;
    const sel = selectedIteration ?? iterations[0];
    const first = iterations[0];
    const last = iterations[n - 1];
    const result: (number | 'ellipsis')[] = [];
    const nearby = new Set<number>();
    nearby.add(first);
    nearby.add(last);
    for (let d = -1; d <= 1; d++) {
      const v = sel + d;
      if (iterations.includes(v)) nearby.add(v);
    }
    const sorted = Array.from(nearby).sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('ellipsis');
      result.push(sorted[i]);
    }
    return result;
  }, [iterations, selectedIteration]);

  return (
    <div className={cn(
      'flex items-center gap-2 px-4 py-1.5 bg-muted/20 shrink-0 overflow-x-auto',
      borderTop ? 'border-t border-border/50' : 'border-b border-border/50'
    )}>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        Iteration
      </span>
      <div className="flex items-center gap-0.5">
        {onSelectAll && (
          <button
            onClick={onSelectAll}
            className={cn(
              'min-w-[28px] px-2 py-0.5 rounded text-xs font-medium transition-colors mr-0.5',
              selectedIteration === null
                ? 'bg-foreground text-background'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            All
          </button>
        )}
        {pages.map((page, i) => {
          if (page === 'ellipsis') {
            return <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">&hellip;</span>;
          }
          const isActive = page === selectedIteration;
          return (
            <button
              key={page}
              onClick={() => onSelectIteration(page)}
              className={cn(
                'min-w-[28px] px-2 py-0.5 rounded text-xs font-medium transition-colors',
                isActive
                  ? 'bg-foreground text-background'
                  : 'bg-muted hover:bg-muted/80 text-foreground'
              )}
            >
              {page + 1}
            </button>
          );
        })}
      </div>

      {selectedIteration != null && datasetItems.length > 0 && (() => {
        const item = datasetItems.find(d => d.index === selectedIteration);
        if (!item) return null;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(item.itemJson); } catch { return null; }
        const entries = Object.entries(parsed);
        const preview = entries.slice(0, 4);

        return (
          <div className="flex items-center gap-3 ml-1 pl-3 border-l border-border/50 text-[11px] text-muted-foreground shrink-0">
            {preview.map(([key, val]) => (
              <span key={key}>
                <span className="font-medium">{key}:</span>{' '}
                <span className="text-foreground">{String(val)}</span>
              </span>
            ))}
            {entries.length > 4 && (
              <span className="text-muted-foreground/50">+{entries.length - 4}</span>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function TasksTab({ instanceId, tasks, allTasks, missionId, isRunning, chosenRoutes, selectedTaskName, onSelectTaskName }: { instanceId: string; tasks: MissionTaskRecord[]; allTasks: TaskInfo[]; missionId: string; isRunning: boolean; chosenRoutes?: Record<string, string>; selectedTaskName?: string | null; onSelectTaskName?: (name: string | null) => void }) {
  // Track selected task by name (synced with canvas node clicks)
  const [localSelectedName, setLocalSelectedName] = useState<string | null>(null);
  const activeName = selectedTaskName ?? localSelectedName;
  const setActiveName = (name: string | null) => {
    setLocalSelectedName(name);
    onSelectTaskName?.(name);
  };

  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);
  const [selectionStack, setSelectionStack] = useState<PanelSelection[]>([]);
  const selection = selectionStack.length > 0 ? selectionStack[selectionStack.length - 1] : null;
  const setSelection = useCallback((sel: PanelSelection) => {
    // Direct selection (from trace/table) replaces the entire stack
    setSelectionStack(sel ? [sel] : []);
  }, []);
  const pushSelection = useCallback((sel: PanelSelection) => {
    if (sel) setSelectionStack(prev => [...prev, sel]);
  }, []);
  const popSelection = useCallback(() => {
    setSelectionStack(prev => prev.length > 1 ? prev.slice(0, -1) : []);
  }, []);
  const [traceView, setTraceView] = useState<'detail' | 'subtasks' | 'output' | 'iterations' | 'flamegraph' | 'table' | 'turns' | 'events'>('detail');
  const [traceLabelWidth, setTraceLabelWidth] = useState(200);
  const traceDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const traceTimelineRef = useRef<HTMLDivElement | null>(null);
  const [traceTimelineWidth, setTraceTimelineWidth] = useState(0);
  useEffect(() => {
    const el = traceTimelineRef.current;
    if (!el) return;
    const measure = () => setTraceTimelineWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
  const [rawOutput, setRawOutput] = useState(false);
  const [expandedTraceRows, setExpandedTraceRows] = useState<Set<string>>(new Set());
  const [turnsEntityFilter, setTurnsEntityFilter] = useState('all');
  const [sessionModal, setSessionModal] = useState<{ type: 'messages' | 'system'; sessionId: string } | null>(null);
  const { width: detailPanelWidth, handleResizeStart: handleDetailResizeStart } = useHorizontalResize({ initialWidth: 384, minWidth: 240, maxWidth: 700 });

  const selectedSessionId = selection?.type === 'session' ? selection.sessionId : null;

  // Build task record lookup by name
  const taskRecordByName = useMemo(() => {
    const map: Record<string, MissionTaskRecord> = {};
    for (const t of tasks) map[t.taskName] = t;
    return map;
  }, [tasks]);

  // Auto-select first task
  useEffect(() => {
    if (!activeName && allTasks.length > 0) {
      setActiveName(allTasks[0].name);
    }
  }, [allTasks, activeName]);

  // The selected task record (may be undefined if task hasn't run)
  const selectedTaskRecord = activeName ? taskRecordByName[activeName] : undefined;
  const selectedTaskId = selectedTaskRecord?.id ?? null;

  const { data: taskDetail } = useQuery({
    queryKey: ['taskDetail', instanceId, selectedTaskId],
    queryFn: () => getTaskDetail(instanceId, selectedTaskId!),
    enabled: !!selectedTaskId,
    refetchInterval: isRunning ? 2000 : false,
  });

  // Session messages for system prompts in detail timeline
  const { data: sessionMessagesData } = useQuery({
    queryKey: ['chatMessages', instanceId, selectedSessionId],
    queryFn: () => getChatMessages(instanceId, selectedSessionId!),
    enabled: !!selectedSessionId,
  });

  // Events for gantt + detail
  const { data: missionEventsData } = useQuery({
    queryKey: ['missionEvents', instanceId, missionId],
    queryFn: () => getMissionEvents(instanceId, missionId),
    refetchInterval: isRunning ? 1000 : false,
  });


  const allSessions = taskDetail?.sessions ?? [];
  const selectedTask = selectedTaskRecord ?? null;
  const selectedTaskConfig = allTasks.find(t => t.name === activeName) ?? null;

  // Detect iterations from sessions (parallel) or inputs (sequential)
  const { iterations, isIterated, isParallelIteration } = useMemo(() => {
    // Parallel iterations: each iteration gets its own session with iterationIndex
    const sessionIndices = new Set<number>();
    for (const s of allSessions) {
      if (s.iterationIndex != null) sessionIndices.add(s.iterationIndex);
    }
    const isParallel = sessionIndices.size > 0;

    if (isParallel) {
      const sorted = Array.from(sessionIndices).sort((a, b) => a - b);
      return { iterations: sorted, isIterated: sorted.length > 0, isParallelIteration: true };
    }

    // Sequential iterations: single session, but subtasks/outputs/datasetItems have iteration indices
    const seqIndices = new Set<number>();
    for (const st of (taskDetail?.subtasks ?? [])) {
      if (st.iterationIndex != null) seqIndices.add(st.iterationIndex);
    }
    for (const o of (taskDetail?.outputs ?? [])) {
      if (o.datasetIndex != null) seqIndices.add(o.datasetIndex);
    }
    // Also use datasetItems as a signal (they always have sequential indices)
    for (const di of (taskDetail?.datasetItems ?? [])) {
      seqIndices.add(di.index);
    }
    const sorted = Array.from(seqIndices).sort((a, b) => a - b);
    return { iterations: sorted, isIterated: sorted.length > 0, isParallelIteration: false };
  }, [allSessions, taskDetail?.subtasks, taskDetail?.outputs, taskDetail?.datasetItems]);

  useEffect(() => {
    if (isIterated) {
      setSelectedIteration(iterations[0] ?? null);
    } else {
      setSelectedIteration(null);
    }
  }, [selectedTaskId, isIterated, iterations]);

  const sessions = useMemo(() => {
    if (!isParallelIteration || selectedIteration == null) return allSessions;
    return allSessions.filter(s => s.iterationIndex === selectedIteration);
  }, [allSessions, isParallelIteration, selectedIteration]);

  // Tool results from API, filtered by iteration
  const allToolResults = taskDetail?.toolResults ?? [];

  // Parse all mission events (not filtered by task — includes mission-level lifecycle events)
  const allMissionEvents = useMemo(() => {
    if (!missionEventsData?.events) return [];
    return missionEventsData.events.map(e => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(e.dataJson || '{}'); } catch { /* skip */ }
      return { ...e, data, time: new Date(e.createdAt).getTime() };
    });
  }, [missionEventsData]);


  // Live clock that ticks every second while running — makes open spans grow
  const [liveNow, setLiveNow] = useState(Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setLiveNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Latest event timestamp, or live clock if mission is still running
  const latestEventTime = useMemo(() => {
    if (allMissionEvents.length === 0) return 0;
    const maxEvent = Math.max(...allMissionEvents.map(e => e.time));
    return isRunning ? Math.max(maxEvent, liveNow) : maxEvent;
  }, [allMissionEvents, isRunning, liveNow]);

  // Stop/resume gap computation — pairs stop[i] with resume[i] to get dead-time intervals
  const { compressTime, resumeBreaks } = useMemo(() => {
    const stops: number[] = [];
    const resumes: number[] = [];
    for (const e of allMissionEvents) {
      if (e.eventType === 'mission_stopped') stops.push(e.time);
      if (e.eventType === 'mission_resumed') resumes.push(e.time);
    }
    stops.sort((a, b) => a - b);
    resumes.sort((a, b) => a - b);

    // Pair each stop with the next resume to form gaps
    const gapList: { start: number; end: number; duration: number }[] = [];
    for (let i = 0; i < Math.min(stops.length, resumes.length); i++) {
      if (resumes[i] > stops[i]) {
        gapList.push({ start: stops[i], end: resumes[i], duration: resumes[i] - stops[i] });
      }
    }

    // compressTime: map a raw timestamp to compressed time by subtracting elapsed gaps
    const compress = (t: number): number => {
      let offset = 0;
      for (const g of gapList) {
        if (t <= g.start) break;
        if (t >= g.end) {
          offset += g.duration;
        } else {
          // Inside a gap — clamp to gap start
          offset += t - g.start;
          break;
        }
      }
      return t - offset;
    };

    // Break points in compressed time (where each resume lands after gap removal)
    const breaks = resumes.slice(0, gapList.length).map(r => compress(r));

    return { gaps: gapList, compressTime: compress, resumeBreaks: breaks };
  }, [allMissionEvents]);

  // Task-specific events (filtered by selected task name)
  const taskEvents = useMemo(() => {
    if (!selectedTask) return [];
    return allMissionEvents.filter(e => {
      const evtTaskName = String(e.data.taskName || '');
      const baseName = selectedTask.taskName;
      return evtTaskName === baseName || evtTaskName.startsWith(baseName + '[');
    });
  }, [allMissionEvents, selectedTask]);

  // Session IDs for current iteration (used to filter subtasks, etc.)
  const iterationSessionIds = useMemo(() => new Set(sessions.map(s => s.id)), [sessions]);

  // Subtasks filtered by iteration
  const subtasks = useMemo(() => {
    const all = taskDetail?.subtasks ?? [];
    if (!isIterated || selectedIteration == null) {
      // Sort by iterationIndex then index for temporal order
      return [...all].sort((a, b) => (a.iterationIndex ?? 0) - (b.iterationIndex ?? 0) || a.index - b.index);
    }
    if (!isParallelIteration) {
      // Sequential: filter by iterationIndex field
      return all.filter(st => st.iterationIndex === selectedIteration);
    }
    // Parallel: filter by session
    return all.filter(st => iterationSessionIds.has(st.sessionId));
  }, [taskDetail?.subtasks, isIterated, isParallelIteration, selectedIteration, iterationSessionIds]);

  // Outputs filtered by iteration
  const outputs = useMemo(() => {
    const all = taskDetail?.outputs ?? [];
    if (!isIterated || selectedIteration == null) return all;
    return all.filter(o => o.datasetIndex === selectedIteration);
  }, [taskDetail?.outputs, isIterated, selectedIteration]);

  // Build a session ID → session lookup for agent name resolution
  const sessionMap = useMemo(() => {
    const map = new Map<string, typeof allSessions[0]>();
    for (const s of allSessions) map.set(s.id, s);
    return map;
  }, [allSessions]);

  // For call_agent tool results, find the agent session that ran during that window
  // Gantt spans built from tool results
  // Line 1: Commander session (continuous bar)
  // Line 2: Commander's tool calls (call_agent shown as agent spans, others as tool spans)
  // Line 3+: Agent tool calls (grouped by agent session)
  // Helper: pair calling_tool → tool_complete events within same sessionId
  const pairToolEvents = useCallback((
    events: typeof taskEvents,
    callingType: string,
    completeType: string,
    fallbackEnd: number,
  ) => {
    // Deduplicate calls by toolCallId — keep the last (most complete) event
    const callsRaw = events.filter(e => e.eventType === callingType);
    const callsByTcId = new Map<string, typeof callsRaw[0]>();
    for (const c of callsRaw) {
      const tcId = String(c.data.toolCallId || c.id);
      callsByTcId.set(tcId, c);
    }
    const calls = [...callsByTcId.values()];
    const completions = [...events.filter(e => e.eventType === completeType)];
    const pairs: { id: string; toolCallId: string; toolName: string; start: number; end: number; sessionId: string }[] = [];
    for (const call of calls) {
      const toolName = String(call.data.toolName || '');
      const toolCallId = String(call.data.toolCallId || '');
      // Prefer matching by toolCallId when available, fall back to session+time+name
      const matchIdx = toolCallId
        ? completions.findIndex(c => String(c.data.toolCallId || '') === toolCallId)
        : completions.findIndex(c =>
            c.sessionId === call.sessionId &&
            c.time >= call.time &&
            String(c.data.toolName || '') === toolName
          );
      const completion = matchIdx >= 0 ? completions.splice(matchIdx, 1)[0] : null;
      pairs.push({
        id: call.id,
        toolCallId,
        toolName,
        start: call.time,
        end: completion ? completion.time : fallbackEnd,
        sessionId: call.sessionId || '',
      });
    }
    return pairs;
  }, []);

  // Helper: find a ToolResultDTO matching an event-derived span (for detail panel click-through)
  const findToolResultForEvent = useCallback((toolCallId: string, sessionId: string, toolName: string, startTime: number) => {
    // Prefer direct match by toolCallId when available
    if (toolCallId) {
      const direct = allToolResults.find(tr => tr.toolCallId === toolCallId);
      if (direct) return direct;
    }
    // Fall back to fuzzy time-based matching for old data without toolCallId
    let best: ToolResultDTO | undefined;
    let bestDelta = Infinity;
    for (const tr of allToolResults) {
      if (tr.sessionId !== sessionId || tr.toolName !== toolName) continue;
      const delta = Math.abs(new Date(tr.startedAt).getTime() - startTime);
      if (delta < 2000 && delta < bestDelta) {
        best = tr;
        bestDelta = delta;
      }
    }
    return best;
  }, [allToolResults]);

  // Build trace rows: one per commander/agent session, each with child tool call spans
  const traceRows = useMemo((): TraceRow[] => {
    const rows: TraceRow[] = [];
    const ct = compressTime;

    // Filter events by iteration for parallel tasks
    const activeEvents = isParallelIteration && selectedIteration != null
      ? taskEvents.filter(e => e.iterationIndex === selectedIteration)
      : taskEvents;

    // Use task-scoped end time so completed tasks don't stretch as mission continues
    const taskEndTime = activeEvents.length > 0
      ? Math.max(...activeEvents.map(e => e.time))
      : latestEventTime;
    const cEnd = compressTime(taskEndTime);

    // --- Commander row ---
    const CMDR_EVENTS = new Set([
      'commander_reasoning_started', 'commander_reasoning_completed', 'commander_answer', 'commander_calling_tool', 'commander_tool_complete',
      'iteration_reasoning', 'iteration_answer',
    ]);
    const cmdrEvents = activeEvents.filter(e => CMDR_EVENTS.has(e.eventType));
    const cmdrSessionId = cmdrEvents.find(e => e.sessionId)?.sessionId;

    // Commander tool calls (excluding call_agent)
    const cmdrToolPairs = pairToolEvents(activeEvents, 'commander_calling_tool', 'commander_tool_complete', taskEndTime);
    const cmdrToolSpans: GanttSpan[] = [];
    for (const pair of cmdrToolPairs) {
      if (pair.toolName === 'call_agent') continue;
      const matchedTR = findToolResultForEvent(pair.toolCallId, pair.sessionId, pair.toolName, pair.start);
      cmdrToolSpans.push({
        id: pair.id, label: pair.toolName,
        start: ct(pair.start), end: ct(pair.end),
        category: pair.toolName === 'dataset_next' ? 'dataset_next' : 'tool',
        toolResult: matchedTR,
      });
    }
    cmdrToolSpans.sort((a, b) => a.start - b.start);

    if (cmdrEvents.length > 0) {
      const spanStart = ct(Math.min(...cmdrEvents.map(e => e.time)));
      const childEnd = cmdrToolSpans.length > 0 ? Math.max(...cmdrToolSpans.map(s => s.end)) : 0;
      const spanEnd = Math.max(ct(Math.max(...cmdrEvents.map(e => e.time))), cEnd, childEnd);
      const breaks = resumeBreaks.filter(t => t > spanStart && t < spanEnd);
      // Convert break points to segments
      let cmdrSegments: { start: number; end: number }[] | undefined;
      if (breaks.length > 0) {
        cmdrSegments = [];
        let segStart = spanStart;
        for (const b of breaks) {
          cmdrSegments.push({ start: segStart, end: b });
          segStart = b;
        }
        cmdrSegments.push({ start: segStart, end: spanEnd });
      }
      rows.push({
        id: cmdrSessionId || 'commander', label: 'Commander',
        start: spanStart, end: spanEnd,
        category: 'commander', sessionId: cmdrSessionId,
        segments: cmdrSegments,
        children: cmdrToolSpans,
      });
    }

    // --- Agent rows ---
    const stopTimes = allMissionEvents
      .filter(e => e.eventType === 'mission_stopped')
      .map(e => e.time)
      .sort((a, b) => a - b);
    const agentStarts = activeEvents.filter(e => e.eventType === 'agent_started');
    const agentCompletes = [...activeEvents.filter(e => e.eventType === 'agent_completed')];

    type AgentSegment = { agentName: string; sessionId: string; startTime: number; endTime: number; completed: boolean; startId: string };
    const segments: AgentSegment[] = [];
    for (const startEvt of agentStarts) {
      const agentName = String(startEvt.data.agentName || 'agent');
      const taskName = String(startEvt.data.taskName || '');
      const nextStop = stopTimes.find(t => t > startEvt.time);
      const completeEvt = agentCompletes.find(e =>
        String(e.data.agentName || '') === agentName &&
        String(e.data.taskName || '') === taskName &&
        e.time >= startEvt.time
      );
      const interrupted = nextStop != null && (!completeEvt || nextStop < completeEvt.time);
      if (!interrupted && completeEvt) {
        agentCompletes.splice(agentCompletes.indexOf(completeEvt), 1);
      }
      segments.push({
        agentName,
        sessionId: startEvt.sessionId || '',
        startTime: startEvt.time,
        endTime: interrupted ? nextStop! : (completeEvt ? completeEvt.time : taskEndTime),
        completed: !interrupted && !!completeEvt,
        startId: startEvt.id,
      });
    }

    // Group segments by sessionId — segments sharing a session go on the same row
    const sessionMap = new Map<string, { agentName: string; sessionId: string; start: number; end: number; spans: { start: number; end: number }[]; id: string }>();
    let lastWasInterrupted = false;
    let prevSessionId = '';
    for (const seg of segments) {
      const sid = seg.sessionId;
      const segStart = ct(seg.startTime);
      const segEnd = ct(seg.endTime);
      const existing = sid ? sessionMap.get(sid) : null;
      if (existing) {
        existing.spans.push({ start: segStart, end: segEnd });
        existing.start = Math.min(existing.start, segStart);
        existing.end = Math.max(existing.end, segEnd);
      } else if (!sid && prevSessionId && lastWasInterrupted) {
        const prev = sessionMap.get(prevSessionId);
        if (prev) {
          prev.spans.push({ start: segStart, end: segEnd });
          prev.start = Math.min(prev.start, segStart);
          prev.end = Math.max(prev.end, segEnd);
        }
      } else {
        const key = sid || `anon-${seg.startId}`;
        sessionMap.set(key, { agentName: seg.agentName, sessionId: sid, start: segStart, end: segEnd, spans: [{ start: segStart, end: segEnd }], id: seg.startId });
      }
      lastWasInterrupted = !seg.completed;
      if (sid) prevSessionId = sid;
    }
    const mergedAgentSpans = [...sessionMap.values()];

    // Agent tool calls — matched to agents by sessionId from events
    const agentToolPairs = pairToolEvents(activeEvents, 'agent_calling_tool', 'agent_tool_complete', taskEndTime);

    for (const span of mergedAgentSpans) {
      const agentTools: GanttSpan[] = agentToolPairs
        .filter(pair => span.sessionId && pair.sessionId === span.sessionId)
        .map(pair => {
          const matchedTR = findToolResultForEvent(pair.toolCallId, pair.sessionId, pair.toolName, pair.start);
          return {
            id: pair.id, label: pair.toolName,
            start: ct(pair.start), end: ct(pair.end),
            category: pair.toolName === 'dataset_next' ? 'dataset_next' as const : 'tool' as const,
            toolResult: matchedTR,
          };
        });

      agentTools.sort((a, b) => a.start - b.start);

      const agentChildEnd = agentTools.length > 0 ? Math.max(...agentTools.map(s => s.end)) : span.end;
      rows.push({
        id: `agent-evt-${span.id}`, label: span.agentName,
        start: span.start, end: Math.max(span.end, agentChildEnd),
        category: 'agent',
        sessionId: span.sessionId || undefined,
        segments: span.spans.length > 1 ? span.spans : undefined,
        children: agentTools,
      });
    }

    return rows;
  }, [taskEvents, allMissionEvents, isParallelIteration, selectedIteration, latestEventTime, compressTime, resumeBreaks, pairToolEvents, findToolResultForEvent]);

  // Gantt time range — derived from traceRows
  const { ganttStart, ganttDuration } = useMemo(() => {
    let earliest = Infinity;
    let latest = 0;
    for (const row of traceRows) {
      if (row.start < earliest) earliest = row.start;
      if (row.end > latest) latest = row.end;
      for (const child of row.children) {
        if (child.start < earliest) earliest = child.start;
        if (child.end > latest) latest = child.end;
      }
    }
    if (earliest === Infinity) return { ganttStart: 0, ganttDuration: 1 };
    const dur = Math.max(latest - earliest, 1);
    // Pad 2% so min-width tool bars at the end don't overflow
    return { ganttStart: earliest, ganttDuration: dur * 1.02 };
  }, [traceRows]);

  // Events filtered by iteration (same logic as ganttLines uses)
  const activeEvents = useMemo(() => {
    if (!(isParallelIteration && selectedIteration != null)) return taskEvents;
    return taskEvents.filter(e => e.iterationIndex === selectedIteration);
  }, [taskEvents, isParallelIteration, selectedIteration, ]);

  // Reasoning ranges for flame graph: map rowId → array of { start, end } time ranges
  // Built from explicit reasoning_started / reasoning_completed event pairs
  const reasoningRanges = useMemo(() => {
    const ranges = new Map<string, { start: number; end: number }[]>();
    for (const row of traceRows) {
      const sessionId = row.sessionId;
      if (!sessionId) continue;
      const session = sessionMap.get(sessionId);
      if (!session) continue;

      const isCmd = session.role === 'commander';
      const startType = isCmd ? 'commander_reasoning_started' : 'agent_reasoning_started';
      const endType = isCmd ? 'commander_reasoning_completed' : 'agent_reasoning_completed';

      // Get all events for this session, sorted by time
      const sessionEvents = activeEvents
        .filter(evt => {
          const ct = compressTime(evt.time);
          if (ct < row.start || ct > row.end) return false;
          if (evt.eventType !== startType && evt.eventType !== endType) return false;
          if (isCmd) return evt.sessionId === sessionId || evt.eventType.startsWith('commander_');
          return evt.sessionId === sessionId || (evt.data.agentName === session.agentName && evt.eventType.startsWith('agent_'));
        })
        .map(evt => ({ type: evt.eventType, time: compressTime(evt.time) }))
        .sort((a, b) => a.time - b.time);


      const rowRanges: { start: number; end: number }[] = [];
      let reasoningStart: number | null = null;

      for (const evt of sessionEvents) {
        if (evt.type === startType) {
          if (reasoningStart === null) reasoningStart = evt.time;
        } else if (evt.type === endType) {
          if (reasoningStart !== null && evt.time > reasoningStart) {
            rowRanges.push({ start: reasoningStart, end: evt.time });
          }
          reasoningStart = null;
        }
      }
      // If still reasoning at end of row, close it
      if (reasoningStart !== null && row.end > reasoningStart) {
        rowRanges.push({ start: reasoningStart, end: row.end });
      }

      if (rowRanges.length > 0) {
        ranges.set(row.id, rowRanges);
      }
    }
    return ranges;
  }, [traceRows, activeEvents, sessionMap, compressTime]);


  // Session detail events (filter by time range + role matching)
  const sessionDetailEvents = useMemo(() => {
    if (!selectedSessionId) return [];

    return taskEvents
      .filter(e => e.sessionId === selectedSessionId)
      .map(e => ({ eventType: e.eventType, data: e.data, timestamp: e.createdAt }));
  }, [selectedSessionId, taskEvents]);

  // Build structured session items: reasoning, tool call+result pairs, answers
  type SessionItem =
    | { type: 'instruction'; content: string }
    | { type: 'system_prompt'; content: string; index: number }
    | { type: 'reasoning'; content: string; duration: string }
    | { type: 'tool'; toolName: string; input: string; result: string; duration: string; toolCallId?: string }
    | { type: 'answer'; content: string }
    | { type: 'ask_commander'; content: string }
    | { type: 'commander_response'; content: string }
    | { type: 'compaction'; entity: string; inputTokens: number; tokenLimit: number; messagesCompacted: number };

  const sessionItems = useMemo((): SessionItem[] => {
    const items: SessionItem[] = [];
    const pendingTools = new Map<string, { toolName: string; input: string; time: number }>();
    let reasoningStartTime: number | null = null;

    // Inject system prompts from session messages
    const systemMsgs = (sessionMessagesData?.messages ?? []).filter(m => m.role === 'system');
    for (let idx = 0; idx < systemMsgs.length; idx++) {
      items.push({ type: 'system_prompt', content: systemMsgs[idx].content, index: idx + 1 });
    }

    // For commander sessions, inject the task objective as the first item
    if (selectedSessionId) {
      const session = allSessions.find(s => s.id === selectedSessionId);
      if (session?.role === 'commander' && taskDetail) {
        const input = taskDetail.inputs?.find(i =>
          session.iterationIndex != null ? i.iterationIndex === session.iterationIndex : i.iterationIndex == null
        );
        if (input?.objective) items.push({ type: 'instruction', content: input.objective });
      }
    }

    for (const evt of sessionDetailEvents) {
      if (evt.eventType === 'agent_started') {
        const instruction = String(evt.data.instruction || '');
        if (instruction) items.push({ type: 'instruction', content: instruction });
      } else if (evt.eventType === 'agent_reasoning_started' || evt.eventType === 'commander_reasoning_started') {
        reasoningStartTime = new Date(evt.timestamp).getTime();
      } else if (evt.eventType === 'agent_reasoning_completed' || evt.eventType === 'commander_reasoning_completed') {
        const content = String(evt.data.content || evt.data.text || '');
        const ms = reasoningStartTime ? new Date(evt.timestamp).getTime() - reasoningStartTime : 0;
        const duration = ms > 0 ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(3)}s`) : '';
        reasoningStartTime = null;
        if (content) items.push({ type: 'reasoning', content, duration });
      } else if (evt.eventType === 'agent_calling_tool' || evt.eventType === 'commander_calling_tool') {
        const toolCallId = String(evt.data.toolCallId || evt.data.toolName || '');
        pendingTools.set(toolCallId, {
          toolName: String(evt.data.toolName || ''),
          input: String(evt.data.input || evt.data.payload || ''),
          time: new Date(evt.timestamp).getTime(),
        });
      } else if (evt.eventType === 'agent_tool_complete' || evt.eventType === 'commander_tool_complete') {
        const toolCallId = String(evt.data.toolCallId || evt.data.toolName || '');
        const start = pendingTools.get(toolCallId);
        const ms = start ? new Date(evt.timestamp).getTime() - start.time : 0;
        const duration = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(3)}s`;
        items.push({
          type: 'tool',
          toolName: start?.toolName || String(evt.data.toolName || ''),
          input: start?.input || '',
          result: String(evt.data.result || evt.data.output || ''),
          duration,
          toolCallId,
        });
        if (start) pendingTools.delete(toolCallId);
      } else if (evt.eventType === 'agent_answer' || evt.eventType === 'commander_answer') {
        const content = String(evt.data.content || evt.data.text || '');
        if (content) items.push({ type: 'answer', content });
      } else if (evt.eventType === 'agent_ask_commander') {
        const content = String(evt.data.content || '');
        if (content) items.push({ type: 'ask_commander', content });
      } else if (evt.eventType === 'agent_commander_response') {
        const content = String(evt.data.content || '');
        if (content) items.push({ type: 'commander_response', content });
      } else if (evt.eventType === 'compaction') {
        items.push({
          type: 'compaction',
          entity: String(evt.data.entity || ''),
          inputTokens: Number(evt.data.inputTokens || 0),
          tokenLimit: Number(evt.data.tokenLimit || 0),
          messagesCompacted: Number(evt.data.messagesCompacted || 0),
        });
      }
    }
    // Flush any unpaired tool calls
    for (const [, pending] of pendingTools) {
      items.push({ type: 'tool', toolName: pending.toolName, input: pending.input, result: '', duration: '' });
    }
    return items;
  }, [sessionDetailEvents, selectedSessionId, allSessions, taskDetail, sessionMessagesData]);



  // Simple percent: maps absolute time to percent of the full timeline
  const toPercent = useCallback((t: number) => {
    return ((t - ganttStart) / ganttDuration) * 100;
  }, [ganttStart, ganttDuration]);

  // Time axis ticks
  const NICE_INTERVALS = [
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600,
  ];
  const ticks = useMemo(() => {
    if (ganttDuration <= 1) return [];
    const durSec = ganttDuration / 1000;
    let interval = NICE_INTERVALS[0];
    for (let i = NICE_INTERVALS.length - 1; i >= 0; i--) {
      if (durSec / NICE_INTERVALS[i] >= 5) {
        interval = NICE_INTERVALS[i];
        break;
      }
    }
    const result: { pct: number; label: string }[] = [];
    for (let t = interval; t <= durSec; t += interval) {
      const pct = (t / durSec) * 100;
      if (pct > 101) continue;
      let label: string;
      if (interval >= 60) {
        const m = Math.floor(t / 60);
        const s = Math.round(t % 60);
        label = s > 0 ? `${m}m${s}s` : `${m}m`;
      } else if (interval >= 1) {
        label = `${Math.round(t * 10) / 10}s`;
      } else {
        label = `${Math.round(t * 1000)}ms`;
      }
      result.push({ pct: Math.max(0, Math.min(100, pct)), label });
    }
    return result;
  }, [ganttDuration]);

  const hasContent = allSessions.length > 0;

  return (
    <>
    <div className="flex h-full">
      {/* Left: task list */}
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {allTasks.map(t => {
            const record = taskRecordByName[t.name];
            const status = record?.status;
            return (
              <button
                key={t.name}
                onClick={() => { setActiveName(t.name); setSelection(null); }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                  activeName === t.name && 'bg-muted font-medium',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    status === 'completed' ? 'bg-green-500' :
                    status === 'running' ? 'bg-blue-500 animate-pulse' :
                    status === 'failed' ? 'bg-red-500' :
                    status === 'stopped' ? 'bg-orange-500' :
                    'bg-muted-foreground/30'
                  )} />
                  <span className="truncate">{t.name}</span>
                </div>
                {record?.startedAt && record?.finishedAt && (
                  <span className="text-[10px] text-muted-foreground ml-3.5">
                    {formatDuration(record.startedAt, record.finishedAt)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: gantt with time axis */}
      <div className="flex-1 relative min-h-0">
        {selectedTask ? (
          <Tabs value={traceView} onValueChange={v => { setTraceView(v as typeof traceView); setSelection(null); }} className="flex flex-col h-full gap-0">
            {/* Header: tabs + iteration selector */}
            <div className="flex items-center gap-3 px-4 pt-2 pb-1 border-b border-border/50 shrink-0">
              <TabsList variant="line" className="h-7">
                <TabsTrigger value="detail" className="text-xs px-2 py-1">Detail</TabsTrigger>
                {subtasks.length > 0 && (
                  <TabsTrigger value="subtasks" className="text-xs px-2 py-1">Subtasks</TabsTrigger>
                )}
                {outputs.length > 0 && (
                  <TabsTrigger value="output" className="text-xs px-2 py-1">Output</TabsTrigger>
                )}
                {isIterated && (
                  <TabsTrigger value="iterations" className="text-xs px-2 py-1">Iterations</TabsTrigger>
                )}
                <TabsTrigger value="flamegraph" className="text-xs px-2 py-1">Trace</TabsTrigger>
                <TabsTrigger value="table" className="text-xs px-2 py-1">Table</TabsTrigger>
                <TabsTrigger value="turns" className="text-xs px-2 py-1">Costs</TabsTrigger>
                <TabsTrigger value="events" className="text-xs px-2 py-1">Events</TabsTrigger>
              </TabsList>
            </div>

            {isIterated && isParallelIteration && (
              <IterationBar
                iterations={iterations}
                selectedIteration={selectedIteration}
                onSelectIteration={(idx) => {
                  setSelectedIteration(idx);
                  setSelection(null);
                }}
                datasetItems={taskDetail?.datasetItems ?? []}
              />
            )}

            {/* Detail view */}
            <TabsContent value="detail" className="flex-1 relative min-h-0 m-0">
              <div className="absolute inset-0 overflow-auto p-4 space-y-4">
                {(() => {
                  const taskConfig = parseTaskConfig(selectedTask);
                  const events = missionEventsData?.events ?? [];

                  // Get resolved objective from task inputs (preferred) or events (fallback)
                  let resolvedObjective: string | undefined;
                  const inputs = taskDetail?.inputs ?? [];
                  if (isIterated && selectedIteration != null) {
                    // Iterated: use input for selected iteration
                    const iterInput = inputs.find(inp => inp.iterationIndex === selectedIteration);
                    resolvedObjective = iterInput?.objective;
                  } else if (inputs.length > 0) {
                    // Non-iterated: use the single input
                    resolvedObjective = inputs[0]?.objective;
                  }

                  // Fallback to events if no inputs stored yet
                  if (!resolvedObjective) {
                    if (isIterated) {
                      const iterEvent = events.find(e => {
                        if (e.eventType !== 'iteration_started') return false;
                        try {
                          const d = JSON.parse(e.dataJson);
                          return d.taskName === selectedTask.taskName && (selectedIteration == null || d.index === selectedIteration);
                        } catch { return false; }
                      });
                      if (iterEvent) {
                        try { resolvedObjective = JSON.parse(iterEvent.dataJson).objective; } catch {}
                      }
                    } else {
                      const taskEvent = events.find(e => {
                        if (e.eventType !== 'task_started') return false;
                        try { return JSON.parse(e.dataJson).taskName === selectedTask.taskName; } catch { return false; }
                      });
                      if (taskEvent) {
                        try { resolvedObjective = JSON.parse(taskEvent.dataJson).objective; } catch {}
                      }
                    }
                  }

                  const objective = resolvedObjective ?? taskConfig?.objective;

                  return (
                    <>
                      {/* Objective */}
                      {objective && (
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Objective{isIterated && selectedIteration != null ? ` (Iteration ${selectedIteration + 1})` : ''}</div>
                          <div className="text-xs whitespace-pre-wrap bg-muted/50 rounded px-3 py-2">{objective}</div>
                        </div>
                      )}

                      {/* Summary */}
                      {selectedTask.summary && (
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Summary</div>
                          <div className="text-xs whitespace-pre-wrap bg-muted/50 rounded px-3 py-2">{selectedTask.summary}</div>
                        </div>
                      )}

                      {/* Dataset Item */}
                      {isIterated && selectedIteration != null && (() => {
                        const item = (taskDetail?.datasetItems ?? []).find(d => d.index === selectedIteration);
                        if (!item) return null;
                        let parsed: Record<string, unknown>;
                        try { parsed = JSON.parse(item.itemJson); } catch { return null; }
                        return (
                          <div>
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                              Dataset Item (Iteration {selectedIteration + 1})
                            </div>
                            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs bg-muted/50 rounded px-3 py-2">
                              {Object.entries(parsed).flatMap(([k, v]) => [
                                <span key={`${k}-l`} className="text-muted-foreground font-medium">{k}</span>,
                                <span key={`${k}-v`} className="break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>,
                              ])}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Config */}
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                        {taskConfig?.commander && (
                          <>
                            <span className="text-muted-foreground">Commander</span>
                            <span>{taskConfig.commander}</span>
                          </>
                        )}
                        {taskConfig?.agent && (
                          <>
                            <span className="text-muted-foreground">Agent</span>
                            <span>{taskConfig.agent}</span>
                          </>
                        )}
                        {taskConfig?.dependsOn && taskConfig.dependsOn.length > 0 && (
                          <>
                            <span className="text-muted-foreground">Depends on</span>
                            <span>{taskConfig.dependsOn.join(', ')}</span>
                          </>
                        )}
                        {taskConfig?.iterator && (
                          <>
                            <span className="text-muted-foreground">Iterator</span>
                            <span>
                              {taskConfig.iterator.dataset}
                              {taskConfig.iterator.parallel ? ' (parallel' : ' (sequential'}
                              {taskConfig.iterator.concurrencyLimit ? `, max ${taskConfig.iterator.concurrencyLimit}` : ''}
                              {taskConfig.iterator.maxRetries ? `, ${taskConfig.iterator.maxRetries} retries` : ''}
                              {')'}
                            </span>
                          </>
                        )}
                        {taskConfig?.router && (
                          <>
                            <span className="text-muted-foreground">Routes</span>
                            <span>
                              {taskConfig.router.routes.map(r => r.target).join(', ')}
                              {chosenRoutes?.[taskConfig.name] && (
                                <span className="text-green-500 ml-1">
                                  (chose: {chosenRoutes[taskConfig.name]})
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Runtime info */}
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                        <span className="text-muted-foreground">Status</span>
                        <span className={
                          selectedTask.status === 'completed' ? 'text-green-500' :
                          selectedTask.status === 'failed' ? 'text-red-500' :
                          selectedTask.status === 'running' ? 'text-blue-500' :
                          selectedTask.status === 'stopped' ? 'text-orange-500' :
                          'text-muted-foreground'
                        }>{selectedTask.status}</span>
                        {selectedTask.startedAt && (
                          <>
                            <span className="text-muted-foreground">Started</span>
                            <span>{new Date(selectedTask.startedAt).toLocaleTimeString()}</span>
                          </>
                        )}
                        {selectedTask.finishedAt && (
                          <>
                            <span className="text-muted-foreground">Finished</span>
                            <span>{new Date(selectedTask.finishedAt).toLocaleTimeString()}</span>
                          </>
                        )}
                        {selectedTask.startedAt && selectedTask.finishedAt && (
                          <>
                            <span className="text-muted-foreground">Duration</span>
                            <span>{((new Date(selectedTask.finishedAt).getTime() - new Date(selectedTask.startedAt).getTime()) / 1000).toFixed(3)}s</span>
                          </>
                        )}
                      </div>

                      {/* Error */}
                      {selectedTask.error && (
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Error</div>
                          <div className="text-xs whitespace-pre-wrap bg-red-500/10 text-red-500 rounded px-3 py-2">{selectedTask.error}</div>
                        </div>
                      )}

                    </>
                  );
                })()}
              </div>
            </TabsContent>

            {/* Subtasks view */}
            <TabsContent value="subtasks" className="flex-1 relative min-h-0 m-0 flex flex-col">
              {isIterated && !isParallelIteration && (
                <IterationBar
                  iterations={iterations}
                  selectedIteration={selectedIteration}
                  onSelectIteration={(idx) => { setSelectedIteration(idx); setSelection(null); }}
                  onSelectAll={() => { setSelectedIteration(null); setSelection(null); }}
                  datasetItems={taskDetail?.datasetItems ?? []}
                  borderTop
                />
              )}
              <div className="flex-1 relative min-h-0">
              <div className="absolute inset-0 overflow-auto p-4">
                {subtasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {isIterated ? 'No subtasks for this iteration.' : 'No subtasks defined.'}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {isIterated && selectedIteration != null && (
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        Iteration {selectedIteration + 1} Subtasks
                        <span className="ml-2 text-muted-foreground/60">
                          ({subtasks.filter(st => st.status === 'completed').length}/{subtasks.length} complete)
                        </span>
                      </div>
                    )}
                    {subtasks.map((st: SubtaskInfo) => (
                      <div key={`${st.iterationIndex ?? 0}-${st.index}`} className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/30">
                        <div className={cn(
                          'h-2 w-2 rounded-full shrink-0',
                          st.status === 'completed' ? 'bg-green-500' :
                          st.status === 'in_progress' ? 'bg-blue-500' :
                          'bg-muted-foreground/30'
                        )} />
                        <span className="text-sm flex-1">{st.title}</span>
                        <Badge variant="secondary" className="text-[10px]">{st.status.replace('_', ' ')}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </TabsContent>

            {/* Output view */}
            <TabsContent value="output" className="flex-1 relative min-h-0 m-0 flex flex-col">
              {isIterated && !isParallelIteration && (
                <IterationBar
                  iterations={iterations}
                  selectedIteration={selectedIteration}
                  onSelectIteration={(idx) => { setSelectedIteration(idx); setSelection(null); }}
                  onSelectAll={() => { setSelectedIteration(null); setSelection(null); }}
                  datasetItems={taskDetail?.datasetItems ?? []}
                  borderTop
                />
              )}
              <div className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0">
                <Switch id="raw-output" checked={rawOutput} onCheckedChange={setRawOutput} className="scale-75" />
                <label htmlFor="raw-output" className="text-[10px] text-muted-foreground cursor-pointer select-none">Raw JSON</label>
              </div>
              <div className="flex-1 relative min-h-0">
              <div className="absolute inset-0 overflow-auto p-4 space-y-3">
                {(() => {
                  if (outputs.length === 0) {
                    return <p className="text-sm text-muted-foreground">No output recorded.</p>;
                  }
                  if (rawOutput) {
                    return outputs.map((o: TaskOutputInfo) => (
                      <div key={o.id} className="space-y-2">
                        {o.datasetName != null && (
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            {o.datasetName}{o.datasetIndex != null ? ` #${o.datasetIndex + 1}` : ''}
                          </div>
                        )}
                        {o.outputJson && (
                          <pre className="text-xs bg-muted/50 rounded px-3 py-2 whitespace-pre-wrap">{
                            (() => { try { return JSON.stringify(JSON.parse(o.outputJson), null, 2); } catch { return o.outputJson; } })()
                          }</pre>
                        )}
                      </div>
                    ));
                  }
                  return outputs.map((o: TaskOutputInfo) => (
                    <div key={o.id} className="space-y-3">
                      {o.datasetName != null && (
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {o.datasetName}{o.datasetIndex != null ? ` #${o.datasetIndex + 1}` : ''}
                        </div>
                      )}
                      {o.outputJson && <OutputDisplay json={o.outputJson} />}
                    </div>
                  ));
                })()}
              </div>
              </div>
            </TabsContent>

            {/* Iterations view */}
            <TabsContent value="iterations" className="flex-1 relative min-h-0 m-0">
              <div className="absolute inset-0 overflow-auto p-4">
                <div className="space-y-1">
                  {iterations.map(idx => {
                    const isActive = idx === selectedIteration;
                    const item = (taskDetail?.datasetItems ?? []).find(d => d.index === idx);
                    let parsedItem: Record<string, unknown> | null = null;
                    if (item) {
                      try { parsedItem = JSON.parse(item.itemJson); } catch { /* skip */ }
                    }

                    // Subtask status for this iteration
                    const allSt = taskDetail?.subtasks ?? [];
                    const iterSt = isParallelIteration
                      ? allSt.filter(st => {
                          const sess = allSessions.find(s => s.iterationIndex === idx);
                          return sess && st.sessionId === sess.id;
                        })
                      : allSt.filter(st => st.iterationIndex === idx);
                    const completedSt = iterSt.filter(st => st.status === 'completed').length;
                    const totalSt = iterSt.length;
                    const allStDone = totalSt > 0 && completedSt === totalSt;

                    // Output status
                    const iterOutputs = (taskDetail?.outputs ?? []).filter(o => o.datasetIndex === idx);
                    const hasOutput = iterOutputs.length > 0;

                    // Objective (parallel only — from inputs)
                    const iterInput = isParallelIteration
                      ? (taskDetail?.inputs ?? []).find(inp => inp.iterationIndex === idx)
                      : null;

                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setSelectedIteration(idx);
                          setSelection(null);
                        }}
                        className={cn(
                          'w-full text-left rounded-md px-3 py-2 transition-colors',
                          isActive
                            ? 'bg-muted ring-1 ring-foreground/20'
                            : 'bg-muted/30 hover:bg-muted/50'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            {parsedItem && (
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                                {Object.entries(parsedItem).map(([k, v]) => (
                                  <span key={k}>
                                    <span className="text-muted-foreground">{k}:</span>{' '}
                                    <span className="font-medium">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                            {iterInput?.objective && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{iterInput.objective}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-[10px]">
                            {totalSt > 0 && (
                              <span className={cn(
                                'flex items-center gap-1',
                                allStDone ? 'text-green-600' : 'text-muted-foreground'
                              )}>
                                <span className={cn('h-1.5 w-1.5 rounded-full', allStDone ? 'bg-green-500' : 'bg-muted-foreground/40')} />
                                {completedSt}/{totalSt}
                              </span>
                            )}
                            {hasOutput && (
                              <span className="text-green-600">output</span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            {/* Execution Trace view */}
            <TabsContent value="flamegraph" className="flex-1 relative min-h-0 m-0 flex flex-col">
              {isIterated && !isParallelIteration && (
                <IterationBar
                  iterations={iterations}
                  selectedIteration={selectedIteration}
                  onSelectIteration={(idx) => { setSelectedIteration(idx); setSelection(null); }}
                  onSelectAll={() => { setSelectedIteration(null); setSelection(null); }}
                  datasetItems={taskDetail?.datasetItems ?? []}
                  borderTop
                />
              )}
              {!hasContent ? (
                <p className="text-sm text-muted-foreground p-4">No sessions recorded for this task.</p>
              ) : (<>
              <div className="flex-1 relative min-h-0">
              <div className="absolute inset-0 overflow-auto">
                <div className="flex flex-col min-w-0">
                  {/* Time axis */}
                  <div style={{ marginLeft: traceLabelWidth }} className="pr-4">
                    <div className="relative h-6 border-b border-border/30">
                      {ticks.map((tick, i) => (
                        <div key={i} className="absolute top-0 h-full flex flex-col justify-end" style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}>
                          <span className="text-[10px] text-muted-foreground/60 tabular-nums whitespace-nowrap pb-0.5">{tick.label}</span>
                        </div>
                      ))}
                      {/* Stop/resume markers */}
                      {resumeBreaks.map((t, i) => {
                        const pct = toPercent(t);
                        if (pct < 0 || pct > 100) return null;
                        return (
                          <div key={`brk-${i}`} className="absolute top-0 h-full flex flex-col justify-end" style={{ left: `${pct}%` }}>
                            <span className="text-[9px] text-orange-400 whitespace-nowrap pb-0.5" style={{ transform: 'translateX(-50%)' }}>resume</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Trace rows */}
                  <div
                    ref={traceTimelineRef}
                    className="relative"
                  >
                    {traceRows.map(row => {
                      const isExpanded = expandedTraceRows.has(row.id);
                      const hasChildren = row.children.length > 0;
                      const rowMs = row.end - row.start;
                      const rowDurLabel = rowMs < 1000 ? `${Math.round(rowMs)}ms` : `${(rowMs / 1000).toFixed(3)}s`;
                      const isRowSelected = (row.sessionId && selection?.type === 'session' && selection.sessionId === row.sessionId)
                        || (row.category === 'agent' && selection?.type === 'session' && selection.agentName && row.label === selection.agentName);

                      return (
                        <div key={row.id}>
                          {/* Main session row */}
                          <div className={cn(
                            'flex items-center h-9 border-b border-border/20 hover:bg-muted/30 transition-colors',
                            isRowSelected && 'bg-muted/50',
                          )}>
                            {/* Left label area */}
                            <div className="shrink-0 flex items-center gap-1.5 px-3 overflow-hidden relative" style={{ width: traceLabelWidth }}>
                              {hasChildren ? (
                                <button
                                  className="w-4 h-4 flex items-center justify-center rounded hover:bg-muted shrink-0"
                                  onClick={() => setExpandedTraceRows(prev => {
                                    const next = new Set(prev);
                                    if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                                    return next;
                                  })}
                                >
                                  {isExpanded
                                    ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                    : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                                </button>
                              ) : <span className="w-4 shrink-0" />}
                              <span className={cn('w-2 h-2 rounded-full shrink-0', SPAN_COLORS[row.category])} />
                              <span className="text-xs font-medium truncate">{row.label}</span>
                              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 ml-auto">{rowDurLabel}</span>
                              {/* Drag handle */}
                              <div
                                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  traceDragRef.current = { startX: e.clientX, startWidth: traceLabelWidth };
                                  const el = e.currentTarget;
                                  el.setPointerCapture(e.pointerId);
                                }}
                                onPointerMove={(e) => {
                                  if (!traceDragRef.current) return;
                                  const delta = e.clientX - traceDragRef.current.startX;
                                  setTraceLabelWidth(Math.max(120, Math.min(400, traceDragRef.current.startWidth + delta)));
                                }}
                                onPointerUp={() => { traceDragRef.current = null; }}
                              />
                            </div>
                            {/* Timeline area */}
                            <div
                              className="flex-1 relative h-full cursor-pointer overflow-hidden"
                              onClick={() => {
                                if (row.category === 'agent') {
                                  const clickSessions = isParallelIteration && selectedIteration != null ? sessions : allSessions;
                                  const agentSession = clickSessions.find(s => s.role !== 'commander' && s.agentName === row.label);
                                  if (agentSession) setSelection({ type: 'session', sessionId: agentSession.id, agentName: row.label });
                                } else if (row.sessionId) {
                                  setSelection({ type: 'session', sessionId: row.sessionId });
                                }
                              }}
                            >
                              {/* Gridlines */}
                              {ticks.map((tick, i) => (
                                <div key={i} className="absolute top-0 h-full w-px bg-border/15" style={{ left: `${tick.pct}%` }} />
                              ))}
                              {/* Stop/resume markers */}
                              {resumeBreaks.map((t, i) => {
                                const pct = toPercent(t);
                                if (pct < 0 || pct > 100) return null;
                                return <div key={`brk-${i}`} className="absolute top-0 h-full w-px bg-orange-400/50 z-20" style={{ left: `${pct}%` }} />;
                              })}
                              {/* Session span bar — single continuous bar (stop/resume shown via orange markers) */}
                              {[{ start: row.start, end: row.end }].map((seg, si) => {
                                const segLeft = toPercent(seg.start);
                                const segWidth = toPercent(seg.end) - segLeft;
                                const sLeft = Math.max(0, segLeft);
                                const sWidth = Math.min(100 - sLeft, Math.max(0.3, segLeft + segWidth - sLeft));
                                return (
                                  <div
                                    key={`seg-${si}`}
                                    className={cn(
                                      'absolute top-1.5 bottom-1.5 overflow-hidden',
                                      isRowSelected && 'outline outline-2 outline-foreground',
                                    )}
                                    style={{
                                      left: `${sLeft}%`, width: `${sWidth}%`, minWidth: '4px',
                                      backgroundColor: SPAN_COLORS_HEX[row.category],
                                      borderRadius: '3px',
                                      outlineOffset: '-2px',
                                    }}
                                  >
                                    <div className="relative flex items-center h-full overflow-hidden" style={{ borderRadius: '3px' }}>
                                      {/* Reasoning ranges inside span */}
                                      {si === 0 && reasoningRanges.get(row.id)?.map((range, ri) => {
                                        const spanStart = row.segments?.[0]?.start ?? row.start;
                                        const spanEnd = row.segments?.[row.segments.length - 1]?.end ?? row.end;
                                        const spanDur = spanEnd - spanStart;
                                        if (spanDur <= 0) return null;
                                        const pctLeft = ((range.start - spanStart) / spanDur) * 100;
                                        const pctWidth = ((range.end - range.start) / spanDur) * 100;
                                        if (pctLeft > 100 || pctLeft + pctWidth < 0) return null;
                                        const cLeft = Math.max(0, pctLeft);
                                        const cWidth = Math.min(100 - cLeft, Math.max(0.5, pctWidth));
                                        return (
                                          <div
                                            key={`r-${ri}`}
                                            className="absolute top-0 bottom-0 bg-blue-300/20 cursor-pointer"
                                            style={{ left: `${cLeft}%`, width: `${cWidth}%` }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (row.sessionId) {
                                                setSelection({ type: 'session', sessionId: row.sessionId });
                                              }
                                            }}
                                          />
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Expanded child tool call rows — grouped by tool name */}
                          {isExpanded && (() => {
                            // Group children by label (tool name)
                            const grouped = new Map<string, typeof row.children>();
                            for (const child of row.children) {
                              const group = grouped.get(child.label);
                              if (group) group.push(child);
                              else grouped.set(child.label, [child]);
                            }
                            return [...grouped.entries()].map(([toolName, spans], groupIdx) => {
                              const totalMs = spans.reduce((sum, s) => sum + (s.end - s.start), 0);
                              const groupDurLabel = totalMs < 1000 ? `${Math.round(totalMs)}ms` : `${(totalMs / 1000).toFixed(3)}s`;
                              const category = spans[0].category;

                              // Pixel-space lane assignment: each span occupies a pixel range
                              // (start..end clamped to a 4px minimum) inside the timeline column.
                              // Sweep spans in start order and assign each to the lowest lane
                              // whose previous occupant has cleared. This catches collisions
                              // caused by the min-width clamp on sub-millisecond bars.
                              const SPAN_MIN_PX = 4;
                              const PIXEL_GAP = 1; // require ≥1px gap before reusing a lane
                              const timelinePx = Math.max(0, traceTimelineWidth - traceLabelWidth);
                              const sortedSpans = [...spans].sort((a, b) => a.start - b.start);
                              const spanLane = new Map<string, number>();
                              const laneEndsPx: number[] = [];
                              for (const s of sortedSpans) {
                                const leftPct = toPercent(s.start);
                                const rightPct = toPercent(s.end);
                                const leftPx = (leftPct / 100) * timelinePx;
                                const rawRightPx = (rightPct / 100) * timelinePx;
                                const rightPx = Math.max(rawRightPx, leftPx + SPAN_MIN_PX);
                                let assigned = -1;
                                for (let li = 0; li < laneEndsPx.length; li++) {
                                  if (laneEndsPx[li] + PIXEL_GAP <= leftPx) {
                                    assigned = li;
                                    break;
                                  }
                                }
                                if (assigned === -1) {
                                  assigned = laneEndsPx.length;
                                  laneEndsPx.push(rightPx);
                                } else {
                                  laneEndsPx[assigned] = rightPx;
                                }
                                spanLane.set(s.id, assigned);
                              }
                              const laneCount = Math.max(1, laneEndsPx.length);
                              const SINGLE_LANE_HEIGHT = 32;
                              const LANE_HEIGHT = 14;
                              const LANE_GAP = 2;
                              const LANE_PADDING = 6;
                              const rowHeight = laneCount === 1
                                ? SINGLE_LANE_HEIGHT
                                : LANE_PADDING * 2 + laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP;

                              return (
                                <div
                                  key={toolName}
                                  className={cn(
                                    'flex items-center border-b border-border/40',
                                    groupIdx % 2 === 1
                                      ? 'bg-muted dark:bg-muted/80'
                                      : 'bg-background',
                                  )}
                                  style={{ height: rowHeight }}
                                >
                                  {/* Left label area — indented */}
                                  <div className="shrink-0 flex items-center gap-1.5 pl-10 pr-3 overflow-hidden relative h-full" style={{ width: traceLabelWidth }}>
                                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', SPAN_COLORS[category])} />
                                    <span className="text-[11px] text-muted-foreground font-mono truncate">{toolName}()</span>
                                    {spans.length > 1 && (
                                      <span className="text-[9px] text-muted-foreground/50 shrink-0">&times;{spans.length}</span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0 ml-auto">{groupDurLabel}</span>
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                                      onPointerDown={(e) => {
                                        e.preventDefault();
                                        traceDragRef.current = { startX: e.clientX, startWidth: traceLabelWidth };
                                        e.currentTarget.setPointerCapture(e.pointerId);
                                      }}
                                      onPointerMove={(e) => {
                                        if (!traceDragRef.current) return;
                                        const delta = e.clientX - traceDragRef.current.startX;
                                        setTraceLabelWidth(Math.max(120, Math.min(400, traceDragRef.current.startWidth + delta)));
                                      }}
                                      onPointerUp={() => { traceDragRef.current = null; }}
                                    />
                                  </div>
                                  {/* Timeline area */}
                                  <div className="flex-1 relative h-full overflow-hidden">
                                    {/* Gridlines */}
                                    {ticks.map((tick, i) => (
                                      <div key={i} className="absolute top-0 h-full w-px bg-border/10" style={{ left: `${tick.pct}%` }} />
                                    ))}
                                    {/* Stop/resume markers */}
                                    {resumeBreaks.map((t, i) => {
                                      const pct = toPercent(t);
                                      if (pct < 0 || pct > 100) return null;
                                      return <div key={`brk-${i}`} className="absolute top-0 h-full w-px bg-orange-400/50 z-20" style={{ left: `${pct}%` }} />;
                                    })}
                                    {/* Tool span bars — one per call, stacked into pixel-space lanes when colliding */}
                                    {spans.map(child => {
                                      const childLeft = toPercent(child.start);
                                      const childWidth = toPercent(child.end) - childLeft;
                                      if (childLeft + childWidth < -1 || childLeft > 101) return null;
                                      const cLeft = Math.max(0, childLeft);
                                      const cWidth = Math.min(100 - cLeft, Math.max(0.3, childLeft + childWidth - cLeft));
                                      const isThisSelected = child.toolResult && selection?.type === 'tool' && (selection.spanId ? selection.spanId === child.id : selection.toolResult.id === child.toolResult.id);
                                      const spanMs = child.end - child.start;
                                      const spanDur = spanMs < 1000 ? `${Math.round(spanMs)}ms` : `${(spanMs / 1000).toFixed(3)}s`;
                                      const lane = spanLane.get(child.id) ?? 0;
                                      const singleLane = laneCount === 1;
                                      const spanHeight = singleLane ? 20 : LANE_HEIGHT;
                                      const spanTop = singleLane
                                        ? (SINGLE_LANE_HEIGHT - 20) / 2
                                        : LANE_PADDING + lane * (LANE_HEIGHT + LANE_GAP);
                                      return (
                                        <div
                                          key={child.id}
                                          className={cn(
                                            'absolute flex items-center overflow-hidden cursor-pointer hover:brightness-125',
                                            isThisSelected && 'outline outline-2 outline-foreground',
                                          )}
                                          title={`${child.label}() — ${spanDur}`}
                                          style={{
                                            left: `${cLeft}%`, width: `${cWidth}%`, minWidth: '4px',
                                            top: spanTop,
                                            height: spanHeight,
                                            backgroundColor: SPAN_COLORS_HEX[child.category],
                                            borderRadius: '3px',
                                            opacity: isThisSelected ? 1 : 0.85,
                                            outlineOffset: '-2px',
                                            zIndex: isThisSelected ? 10 : 1,
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (child.toolResult) setSelection({ type: 'tool', toolResult: child.toolResult, spanId: child.id });
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              </div>
              </>)}
            </TabsContent>

            {/* Table view */}
            <TabsContent value="table" className="flex-1 relative min-h-0 m-0 flex flex-col">
              {isIterated && !isParallelIteration && (
                <IterationBar
                  iterations={iterations}
                  selectedIteration={selectedIteration}
                  onSelectIteration={(idx) => { setSelectedIteration(idx); setSelection(null); }}
                  onSelectAll={() => { setSelectedIteration(null); setSelection(null); }}
                  datasetItems={taskDetail?.datasetItems ?? []}
                  borderTop
                />
              )}
              {!hasContent ? (
                <p className="text-sm text-muted-foreground p-4">No sessions recorded for this task.</p>
              ) : (
              <div className="flex-1 relative min-h-0 overflow-hidden">
              <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
                <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[40%]" />
                    <col className="w-[15%]" />
                    <col className="w-[15%]" />
                  </colgroup>
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-3 py-1.5 font-medium">Type</th>
                      <th className="px-3 py-1.5 font-medium">Name</th>
                      <th className="px-3 py-1.5 font-medium text-right">Start</th>
                      <th className="px-3 py-1.5 font-medium text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traceRows.map(row => {
                      const isCollapsed = collapsedRows.has(row.id);
                      const hasChildren = row.children.length > 0;
                      const offsetMs = row.start - ganttStart;
                      const offsetLabel = offsetMs < 1000 ? `+${Math.round(offsetMs)}ms` : `+${(offsetMs / 1000).toFixed(3)}s`;
                      const durMs = row.end - row.start;
                      const durLabel = durMs <= 0 ? '<1ms' : durMs < 1000 ? `${Math.round(durMs)}ms` : `${(durMs / 1000).toFixed(3)}s`;
                      const isRowSelected = (row.sessionId && selection?.type === 'session' && selection.sessionId === row.sessionId)
                        || (row.category === 'agent' && selection?.type === 'session' && selection.agentName && row.label === selection.agentName);

                      return (
                        <Fragment key={row.id}>
                          <tr
                            className={cn(
                              'border-b border-border/30 cursor-pointer hover:bg-muted/50 transition-colors',
                              isRowSelected && 'bg-muted',
                            )}
                            onClick={() => {
                              if (row.category === 'agent') {
                                const clickSessions = isParallelIteration && selectedIteration != null ? sessions : allSessions;
                                const agentSession = clickSessions.find(s => s.role !== 'commander' && s.agentName === row.label);
                                if (agentSession) setSelection({ type: 'session', sessionId: agentSession.id, agentName: row.label });
                              } else if (row.sessionId) {
                                setSelection({ type: 'session', sessionId: row.sessionId });
                              }
                            }}
                          >
                            <td className="px-3 py-1.5" style={{ paddingLeft: '12px' }}>
                              {hasChildren ? (
                                <button
                                  className="inline-flex items-center justify-center w-4 h-4 mr-1 -ml-1 hover:bg-muted rounded"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setCollapsedRows(prev => {
                                      const next = new Set(prev);
                                      if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                                      return next;
                                    });
                                  }}
                                >
                                  {isCollapsed
                                    ? <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                    : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
                                </button>
                              ) : <span className="inline-block w-4 mr-1" />}
                              <span className={cn('inline-block w-2 h-2 rounded-full mr-1.5', SPAN_COLORS[row.category])} />
                              {row.category === 'commander' ? 'Commander' : 'Agent'}
                            </td>
                            <td className="px-3 py-1.5 font-mono truncate">{row.label}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{offsetLabel}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{durLabel}</td>
                          </tr>
                          {!isCollapsed && row.children.map(child => {
                            const cOffsetMs = child.start - ganttStart;
                            const cOffsetLabel = cOffsetMs < 1000 ? `+${Math.round(cOffsetMs)}ms` : `+${(cOffsetMs / 1000).toFixed(3)}s`;
                            const cDurMs = child.end - child.start;
                            const cDurLabel = cDurMs <= 0 ? '<1ms' : cDurMs < 1000 ? `${Math.round(cDurMs)}ms` : `${(cDurMs / 1000).toFixed(3)}s`;
                            const isChildSelected = child.toolResult && selection?.type === 'tool' && (selection.spanId ? selection.spanId === child.id : selection.toolResult.id === child.toolResult.id);
                            return (
                              <tr
                                key={child.id}
                                className={cn(
                                  'border-b border-border/20 cursor-pointer hover:bg-muted/50 transition-colors',
                                  isChildSelected && 'bg-muted',
                                )}
                                onClick={() => {
                                  if (child.toolResult) setSelection({ type: 'tool', toolResult: child.toolResult, spanId: child.id });
                                }}
                              >
                                <td className="px-3 py-1.5" style={{ paddingLeft: '44px' }}>
                                  <span className="inline-block w-4 mr-1" />
                                  <span className={cn('inline-block w-2 h-2 rounded-full mr-1.5', SPAN_COLORS[child.category])} />
                                  Tool
                                </td>
                                <td className="px-3 py-1.5 font-mono truncate">{child.label}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{cOffsetLabel}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">{cDurLabel}</td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
              )}
            </TabsContent>

            {/* Turns view */}
            <TabsContent value="turns" className="flex-1 relative min-h-0 m-0">
              {(() => {
                const events = (missionEventsData?.events ?? [])
                  .filter(e => e.eventType === 'session_turn' && e.taskId === selectedTaskId)
                  .map(e => {
                    try { return { ...JSON.parse(e.dataJson || '{}'), createdAt: e.createdAt }; } catch { return null; }
                  })
                  .filter(Boolean) as Array<{
                    entity: string; model?: string; inputTokens: number; outputTokens: number;
                    cacheWriteTokens?: number; cacheReadTokens?: number;
                    userMessages: number; assistantMessages: number; systemMessages: number;
                    payloadBytes: number; turnDurationMs: number; createdAt: string;
                    cost?: number; inputCost?: number; outputCost?: number;
                    cacheReadCost?: number; cacheWriteCost?: number;
                  }>;

                const entities = ['all', ...Array.from(new Set(events.map(e => e.entity)))];
                const filtered = turnsEntityFilter === 'all' ? events : events.filter(e => e.entity === turnsEntityFilter);

                const totals = filtered.reduce((acc, e) => ({
                  inputTokens: acc.inputTokens + e.inputTokens,
                  outputTokens: acc.outputTokens + e.outputTokens,
                  cacheWrite: acc.cacheWrite + (e.cacheWriteTokens || 0),
                  cacheRead: acc.cacheRead + (e.cacheReadTokens || 0),
                  payloadBytes: acc.payloadBytes + e.payloadBytes,
                  duration: acc.duration + e.turnDurationMs,
                  cost: acc.cost + (e.cost || 0),
                }), { inputTokens: 0, outputTokens: 0, cacheWrite: 0, cacheRead: 0, payloadBytes: 0, duration: 0, cost: 0 });

                const fmtBytes = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
                const fmtNum = (n: number) => n.toLocaleString();
                const fmtCost = (c: number) => c > 0 ? `$${c < 0.01 ? c.toFixed(4) : c < 1 ? c.toFixed(3) : c.toFixed(2)}` : '—';

                return (
                  <div className="absolute inset-0 overflow-auto p-3 space-y-3">
                    {/* Filter */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Session:</span>
                      <select
                        value={turnsEntityFilter}
                        onChange={e => setTurnsEntityFilter(e.target.value)}
                        className="text-xs border rounded px-2 py-0.5 bg-background"
                      >
                        {entities.map(e => (
                          <option key={e} value={e}>{e === 'all' ? 'All sessions' : e}</option>
                        ))}
                      </select>
                      <span className="text-xs text-muted-foreground ml-auto">{filtered.length} turns</span>
                    </div>

                    {filtered.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No turns data for this task.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-background z-10">
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="px-2 py-1 font-medium">#</th>
                            <th className="px-2 py-1 font-medium">Entity</th>
                            <th className="px-2 py-1 font-medium">Model</th>
                            <th className="px-2 py-1 font-medium text-right">
                              <span className="inline-flex items-center gap-1">Input
                                <Tooltip><TooltipTrigger asChild><HelpCircle className="size-3 text-muted-foreground/50" /></TooltipTrigger>
                                <TooltipContent>Total input tokens (uncached + cache write + cache read)</TooltipContent></Tooltip>
                              </span>
                            </th>
                            <th className="px-2 py-1 font-medium text-right">
                              <span className="inline-flex items-center gap-1">Output
                                <Tooltip><TooltipTrigger asChild><HelpCircle className="size-3 text-muted-foreground/50" /></TooltipTrigger>
                                <TooltipContent>Tokens generated by the LLM</TooltipContent></Tooltip>
                              </span>
                            </th>
                            <th className="px-2 py-1 font-medium text-right">
                              <span className="inline-flex items-center gap-1">Cache Write
                                <Tooltip><TooltipTrigger asChild><HelpCircle className="size-3 text-muted-foreground/50" /></TooltipTrigger>
                                <TooltipContent>Tokens written to cache this turn (billed at 1.25x input rate)</TooltipContent></Tooltip>
                              </span>
                            </th>
                            <th className="px-2 py-1 font-medium text-right">
                              <span className="inline-flex items-center gap-1">Cache Read
                                <Tooltip><TooltipTrigger asChild><HelpCircle className="size-3 text-muted-foreground/50" /></TooltipTrigger>
                                <TooltipContent>Tokens read from cache (billed at 0.1x input rate)</TooltipContent></Tooltip>
                              </span>
                            </th>
                            <th className="px-2 py-1 font-medium text-right">
                              <span className="inline-flex items-center gap-1">Msgs (U/A/S)
                                <Tooltip><TooltipTrigger asChild><HelpCircle className="size-3 text-muted-foreground/50" /></TooltipTrigger>
                                <TooltipContent>Message count by role: User / Assistant / System</TooltipContent></Tooltip>
                              </span>
                            </th>
                            <th className="px-2 py-1 font-medium text-right">Payload</th>
                            <th className="px-2 py-1 font-medium text-right">Duration</th>
                            <th className="px-2 py-1 font-medium text-right">Est. Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((e, i) => {
                            const cacheWrite = e.cacheWriteTokens || 0;
                            const cacheRead = e.cacheReadTokens || 0;
                            const totalInput = e.inputTokens + cacheWrite + cacheRead;
                            return (
                              <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                                <td className="px-2 py-1 tabular-nums text-muted-foreground">{i + 1}</td>
                                <td className="px-2 py-1">
                                  <Badge variant={e.entity === 'commander' ? 'outline' : 'secondary'} className="text-[10px] px-1.5 py-0">
                                    {e.entity}
                                  </Badge>
                                </td>
                                <td className="px-2 py-1 text-muted-foreground">{e.model || '—'}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtNum(totalInput)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtNum(e.outputTokens)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{cacheWrite > 0 ? fmtNum(cacheWrite) : '—'}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{cacheRead > 0 ? fmtNum(cacheRead) : '—'}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{e.userMessages}/{e.assistantMessages}/{e.systemMessages}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtBytes(e.payloadBytes)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{(e.turnDurationMs / 1000).toFixed(3)}s</td>
                                <td className="px-2 py-1 text-right tabular-nums font-medium">{fmtCost(e.cost || 0)}</td>
                              </tr>
                            );
                          })}
                          {/* Totals row */}
                          <tr className="border-t-2 font-medium">
                            <td className="px-2 py-1.5" colSpan={3}>Total ({filtered.length} turns)</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(totals.inputTokens + totals.cacheWrite + totals.cacheRead)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(totals.outputTokens)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {totals.cacheWrite > 0 ? fmtNum(totals.cacheWrite) : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {totals.cacheRead > 0 ? fmtNum(totals.cacheRead) : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">—</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtBytes(totals.payloadBytes)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{(totals.duration / 1000).toFixed(3)}s</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtCost(totals.cost)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })()}
            </TabsContent>

            {/* System prompts */}
            {/* Events view — task-filtered event log */}
            <TabsContent value="events" className="flex-1 relative min-h-0 m-0">
              <div className="flex-1 relative min-h-0 h-full">
                <div className="absolute inset-0 overflow-y-auto px-4 py-2">
                  {taskEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">No events.</p>
                  ) : (
                    taskEvents
                      .filter(e => !VERBOSE_EVENTS.has(e.eventType))
                      .map((e, i) => (
                        <EventLogRow key={i} event={{ eventType: e.eventType, data: e.data, timestamp: e.createdAt }} />
                      ))
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        ) : selectedTaskConfig ? (
          <div className="overflow-auto p-4 h-full space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{selectedTaskConfig.name}</h3>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">not started</Badge>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs max-w-md">
              {selectedTaskConfig.dependsOn && selectedTaskConfig.dependsOn.length > 0 && (
                <>
                  <span className="text-muted-foreground">Dependencies</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedTaskConfig.dependsOn.map(dep => (
                      <Badge key={dep} variant="outline" className="text-[10px] px-1.5 py-0">{dep}</Badge>
                    ))}
                  </div>
                </>
              )}
              {selectedTaskConfig.sendTo && selectedTaskConfig.sendTo.length > 0 && (
                <>
                  <span className="text-muted-foreground">Send to</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedTaskConfig.sendTo.map(t => (
                      <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                    ))}
                  </div>
                </>
              )}
              {selectedTaskConfig.router && (
                <>
                  <span className="text-muted-foreground">Router</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedTaskConfig.router.routes.map(r => (
                      <Badge key={r.target} variant="outline" className="text-[10px] px-1.5 py-0">{r.target}</Badge>
                    ))}
                  </div>
                </>
              )}
              {selectedTaskConfig.iterator && (
                <>
                  <span className="text-muted-foreground">Iterator</span>
                  <span>{selectedTaskConfig.iterator.parallel ? 'Parallel' : 'Sequential'} over {selectedTaskConfig.iterator.dataset}</span>
                </>
              )}
            </div>
            {selectedTaskConfig.objective && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Objective</span>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{selectedTaskConfig.objective}</p>
              </div>
            )}
            {(selectedTaskConfig as any).output && (selectedTaskConfig as any).output.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Output Schema</span>
                <div className="mt-1 space-y-1">
                  {(selectedTaskConfig as any).output.map((f: any) => (
                    <div key={f.name} className="flex items-center gap-2 text-xs">
                      <span className="font-medium">{f.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">{f.type}</Badge>
                      {f.required && <span className="text-destructive">required</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground p-4">Select a task to view details.</p>
        )}
      </div>

      {/* Right: detail panel */}
      {selection && (traceView === 'flamegraph' || traceView === 'table') && (
        <div className="shrink-0 border-l flex flex-col overflow-hidden relative" style={{ width: detailPanelWidth }}>
          {/* Drag handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20"
            onMouseDown={handleDetailResizeStart}
          />
          <div className="p-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                {selection.type === 'session' ? 'Session Detail' : 'Tool Call Detail'}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => selectionStack.length > 1 ? popSelection() : setSelection(null)}>Close</Button>
              </div>
            </div>
            {selection.type === 'session' && (() => {
              const s = allSessions.find(s => s.id === selection.sessionId);
              return s ? (
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <Badge variant={s.role === 'commander' ? 'outline' : 'secondary'} className="text-[10px] px-1.5 py-0">
                    {s.role === 'commander' ? 'commander' : s.agentName || s.role}
                  </Badge>
                  {s.model && <span>{s.model}</span>}
                  {s.finishedAt && <span>{formatDuration(s.startedAt, s.finishedAt)}</span>}
                </div>
              ) : null;
            })()}
            {selection.type === 'tool' && (() => {
              const tr = selection.toolResult;
              const session = sessionMap.get(tr.sessionId);
              const caller = session?.role === 'commander' ? 'commander' : (session?.agentName || 'agent');
              const ms = new Date(tr.finishedAt).getTime() - new Date(tr.startedAt).getTime();
              return (
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <Badge className={cn('text-[10px] px-1.5 py-0 text-white', SPAN_COLORS.tool)}>
                    {tr.toolName}
                  </Badge>
                  <span>by {caller}</span>
                  <span>{ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(3)}s`}</span>
                </div>
              );
            })()}
          </div>

         <div className="overflow-y-auto min-h-0 flex-1">
          {/* Session detail panel */}
          {selection.type === 'session' && (
            <div className="px-3 py-2">
              {sessionItems.length > 0 ? (
                <div className="relative">
                  {sessionItems.map((item, i) => {
                    const isLast = i === sessionItems.length - 1;
                    const dotColor =
                      item.type === 'system_prompt' ? 'bg-amber-400' :
                      item.type === 'instruction' ? 'bg-purple-400' :
                      item.type === 'reasoning' ? 'bg-blue-400' :
                      item.type === 'tool' ? 'bg-teal-400' :
                      item.type === 'ask_commander' ? 'bg-emerald-400' :
                      item.type === 'commander_response' ? 'bg-emerald-400' :
                      item.type === 'answer' ? 'bg-emerald-400' :
                      item.type === 'compaction' ? 'bg-violet-400' :
                      'bg-foreground';
                    const lineColor = 'bg-border';

                    return (
                      <div key={i} className="relative flex gap-3">
                        {/* Timeline: dot + connecting line */}
                        <div className="relative shrink-0 w-3 flex justify-center">
                          <div className={cn('size-2.5 rounded-full mt-1 relative z-10', dotColor)} />
                          {!isLast && <div className={cn('absolute top-3 -bottom-3 left-1/2 -translate-x-1/2 w-px', lineColor)} />}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pb-3">
                          {item.type === 'system_prompt' && (
                            <details className="group">
                              <summary className="text-[11px] text-muted-foreground cursor-pointer font-medium flex items-center gap-1.5 select-none">
                                System Prompt
                                <svg className="size-3 text-muted-foreground/40 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5V3z"/></svg>
                              </summary>
                              <div className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
                                <MarkdownPreview content={item.content.split('\n').slice(0, 30).join('\n')} className="p-0 text-[11px]" />
                                {item.content.split('\n').length > 30 && (
                                  <p className="text-[10px] text-muted-foreground/60 mt-1 italic">{item.content.split('\n').length - 30} additional lines...</p>
                                )}
                              </div>
                            </details>
                          )}
                          {item.type === 'instruction' && (
                            <p className="text-[11px] text-purple-400 italic leading-relaxed line-clamp-3">
                              {item.content}
                            </p>
                          )}
                          {item.type === 'reasoning' && (
                            <details className="group" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) requestAnimationFrame(() => (e.target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }}>
                              <summary className="text-[11px] text-muted-foreground cursor-pointer font-medium flex items-center gap-1.5 select-none">
                                Reasoning
                                <svg className="size-3 text-muted-foreground/40 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5V3z"/></svg>
                                {item.duration && <span className="text-muted-foreground/50 font-normal ml-auto text-[10px] tabular-nums">{item.duration}</span>}
                              </summary>
                              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed mt-1">
                                {item.content}
                              </p>
                            </details>
                          )}
                          {item.type === 'tool' && (
                            <details className="group" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) requestAnimationFrame(() => (e.target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }}>
                              <summary className="text-[11px] text-muted-foreground cursor-pointer font-medium flex items-center gap-1.5 select-none">
                                <span className="font-mono text-[10px]">{item.toolName}</span>
                                <svg className="size-3 text-muted-foreground/40 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5V3z"/></svg>
                                {item.duration && <span className="text-muted-foreground/50 font-normal ml-auto text-[10px] tabular-nums">{item.duration}</span>}
                              </summary>
                              <div className="mt-1.5 space-y-2">
                                {item.input && (
                                  <div>
                                    <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Input</span>
                                    <pre className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto font-mono leading-relaxed">
                                      {item.input}
                                    </pre>
                                  </div>
                                )}
                                {item.result && (() => {
                                  let { images, cleanText } = extractImages(item.result);
                                  // Hydrate images from tool_results if event data only has placeholders
                                  if (images.length === 0 && item.result.includes('[image]') && item.toolCallId) {
                                    const tr = allToolResults.find(t => t.toolCallId === item.toolCallId);
                                    if (tr?.output) {
                                      images = extractImages(tr.output).images;
                                    }
                                  }
                                  return (
                                    <div>
                                      <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Result</span>
                                      {cleanText && (
                                        <pre className="text-[10px] text-muted-foreground bg-muted/40 rounded p-2 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto font-mono leading-relaxed">
                                          {cleanText}
                                        </pre>
                                      )}
                                      <ImageCarousel images={images} />
                                    </div>
                                  );
                                })()}
                                {item.toolCallId && (() => {
                                  const tr = findToolResultForEvent(item.toolCallId, selectedSessionId || '', item.toolName, 0);
                                  if (!tr) return null;
                                  return (
                                    <button
                                      className="text-[10px] text-teal-400 hover:text-teal-300 mt-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        pushSelection({ type: 'tool', toolResult: tr });
                                      }}
                                    >
                                      View full details &rarr;
                                    </button>
                                  );
                                })()}
                              </div>
                            </details>
                          )}
                          {item.type === 'answer' && (
                            <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
                              {item.content}
                            </p>
                          )}
                          {item.type === 'ask_commander' && (
                            <details className="group" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) requestAnimationFrame(() => (e.target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }}>
                              <summary className="text-[11px] text-muted-foreground cursor-pointer font-medium flex items-center gap-1.5 select-none">
                                Ask Commander
                                <svg className="size-3 text-muted-foreground/40 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5V3z"/></svg>
                              </summary>
                              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed mt-1">
                                {item.content}
                              </p>
                            </details>
                          )}
                          {item.type === 'commander_response' && (
                            <details className="group" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) requestAnimationFrame(() => (e.target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }}>
                              <summary className="text-[11px] text-muted-foreground cursor-pointer font-medium flex items-center gap-1.5 select-none">
                                Commander Response
                                <svg className="size-3 text-muted-foreground/40 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5V3z"/></svg>
                              </summary>
                              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed mt-1">
                                {item.content}
                              </p>
                            </details>
                          )}
                          {item.type === 'compaction' && (
                            <p className="text-[10px] text-violet-400/80 italic">
                              Context compacted — {item.messagesCompacted} messages removed ({item.inputTokens.toLocaleString()}/{item.tokenLimit.toLocaleString()} tokens)
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No events recorded.</p>
              )}
            </div>
          )}

          <div className="p-3 space-y-2">
            {/* Tool result detail */}
            {selection.type === 'tool' && (() => {
              const tr = selection.toolResult;
              const session = sessionMap.get(tr.sessionId);
              const caller = session?.role === 'commander' ? 'commander' : (session?.agentName || 'agent');
              const ms = new Date(tr.finishedAt).getTime() - new Date(tr.startedAt).getTime();
              return (
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Tool Name</span>
                    <p className="text-sm font-medium mt-0.5">{tr.toolName}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Called By</span>
                    <p className="text-sm mt-0.5">{caller}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Duration</span>
                    <p className="text-sm mt-0.5">{ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(3)}s`}</p>
                  </div>
                  {tr.inputParams && (
                    <div>
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Input</span>
                      <pre className="text-[10px] bg-muted/50 rounded p-2 mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {tr.inputParams}
                      </pre>
                    </div>
                  )}
                  {tr.output && (() => {
                    const { images, cleanText } = extractImages(tr.output);
                    return (
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Output</span>
                        {cleanText && (
                          <pre className="text-[10px] bg-muted/50 rounded p-2 mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {cleanText}
                          </pre>
                        )}
                        <ImageCarousel images={images} />
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
         </div>
        </div>
      )}
    </div>

    <SessionMessagesModal
      instanceId={instanceId}
      modal={sessionModal}
      onClose={() => setSessionModal(null)}
      toolResults={allToolResults}
    />
    </>
  );
}

/* ── Events Tab ── */

interface NormalizedEvent {
  eventType: string;
  data: Record<string, unknown>;
  timestamp: string;
}

function OutputDisplay({ json }: { json: string }) {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { parsed = json; }

  // Plain string — render as markdown
  if (typeof parsed === 'string') {
    return <MarkdownPreview content={parsed} className="p-0 text-sm" />;
  }

  // Object — render each field in its own card
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>);
    return (
      <div className="space-y-3">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{key.replace(/_/g, ' ')}</div>
            {typeof value === 'string' ? (
              <MarkdownPreview content={value} className="p-0 text-sm" />
            ) : typeof value === 'boolean' ? (
              <span className="text-sm">{value ? 'Yes' : 'No'}</span>
            ) : typeof value === 'number' ? (
              <span className="text-sm tabular-nums">{value}</span>
            ) : Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number') ? (
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {value.map((v, i) => (
                  <span key={i} className="text-xs bg-muted/60 border border-border/40 rounded px-2 py-0.5">{String(v)}</span>
                ))}
              </div>
            ) : (
              <pre className="text-xs bg-muted/50 rounded px-3 py-2 whitespace-pre-wrap mt-1">{JSON.stringify(value, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Fallback — formatted JSON
  return <pre className="text-xs bg-muted/50 rounded px-3 py-2 whitespace-pre-wrap">{JSON.stringify(parsed, null, 2)}</pre>;
}

function EventLogRow({ event }: { event: NormalizedEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = getEventColor(event.eventType);
  const summary = formatEventSummary(event.eventType, event.data);
  const content = getEventExpandableContent(event.eventType, event.data);
  const hasContent = !!content;

  const ts = new Date(event.timestamp);
  const time = ts.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(ts.getMilliseconds()).padStart(3, '0');

  return (
    <div className="py-1">
      <div
        className={cn('flex gap-2 text-[11px] font-mono leading-relaxed', hasContent && 'cursor-pointer')}
        onClick={hasContent ? () => setExpanded(e => !e) : undefined}
      >
        <span className="text-muted-foreground/50 shrink-0">[{time}]</span>
        <span className={color}>
          {summary}
          {hasContent && (
            <svg className={cn('inline size-3 ml-1 text-muted-foreground transition-transform', expanded && 'rotate-90')} viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5V3z"/></svg>
          )}
        </span>
      </div>
      {expanded && content && (
        <pre className="text-[10px] text-muted-foreground/70 font-mono whitespace-pre-wrap leading-relaxed mt-1 ml-[4.5rem] border-l border-border/50 pl-3 max-h-64 overflow-y-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

function MissionCostsTab({ instanceId, missionId, isRunning }: { instanceId: string; missionId: string; isRunning: boolean }) {
  const { data } = useQuery({
    queryKey: ['missionEvents', instanceId, missionId],
    queryFn: () => getMissionEvents(instanceId, missionId),
    refetchInterval: isRunning ? 1000 : false,
  });

  const allTurns = useMemo(() => {
    if (!data?.events) return [];
    return data.events
      .filter(e => e.eventType === 'session_turn')
      .map(e => {
        try { return JSON.parse(e.dataJson || '{}'); } catch { return null; }
      })
      .filter(Boolean) as Array<{
        taskName: string; entity: string; model?: string;
        inputTokens: number; outputTokens: number;
        cacheWriteTokens?: number; cacheReadTokens?: number;
        turnDurationMs: number; cost?: number;
      }>;
  }, [data]);

  const fmtCost = (c: number) => c > 0 ? `$${c < 0.01 ? c.toFixed(4) : c < 1 ? c.toFixed(3) : c.toFixed(2)}` : '—';
  const fmtNum = (n: number) => n.toLocaleString();

  const totalCost = allTurns.reduce((sum, e) => sum + (e.cost || 0), 0);
  const totalInput = allTurns.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutput = allTurns.reduce((sum, e) => sum + e.outputTokens, 0);
  const totalCacheWrite = allTurns.reduce((sum, e) => sum + (e.cacheWriteTokens || 0), 0);
  const totalCacheRead = allTurns.reduce((sum, e) => sum + (e.cacheReadTokens || 0), 0);

  const taskMap = useMemo(() => {
    const map = new Map<string, { turns: number; cost: number; input: number; output: number; cacheWrite: number; cacheRead: number; duration: number }>();
    for (const t of allTurns) {
      // Strip iteration suffix (e.g. "task[0]" → "task") so iterations aggregate
      const rawName = t.taskName || 'unknown';
      const name = rawName.replace(/\[\d+\]$/, '');
      const existing = map.get(name) || { turns: 0, cost: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, duration: 0 };
      existing.turns++;
      existing.cost += t.cost || 0;
      existing.input += t.inputTokens;
      existing.output += t.outputTokens;
      existing.cacheWrite += t.cacheWriteTokens || 0;
      existing.cacheRead += t.cacheReadTokens || 0;
      existing.duration += t.turnDurationMs;
      map.set(name, existing);
    }
    return map;
  }, [allTurns]);

  return (
    <div className="overflow-auto p-4 h-full space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Est. Cost</p>
          <p className="text-lg font-semibold tabular-nums">{fmtCost(totalCost)}</p>
        </div>
        <div className="border rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Turns</p>
          <p className="text-lg font-semibold tabular-nums">{allTurns.length}</p>
        </div>
        <div className="border rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Input Tokens</p>
          <p className="text-lg font-semibold tabular-nums">{fmtNum(totalInput + totalCacheWrite + totalCacheRead)}</p>
        </div>
        <div className="border rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Output Tokens</p>
          <p className="text-lg font-semibold tabular-nums">{fmtNum(totalOutput)}</p>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Cost by Task</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-1 font-medium">Task</th>
              <th className="px-2 py-1 font-medium text-right">Turns</th>
              <th className="px-2 py-1 font-medium text-right">Input</th>
              <th className="px-2 py-1 font-medium text-right">Output</th>
              <th className="px-2 py-1 font-medium text-right">Cache Write</th>
              <th className="px-2 py-1 font-medium text-right">Cache Read</th>
              <th className="px-2 py-1 font-medium text-right">Duration</th>
              <th className="px-2 py-1 font-medium text-right">Est. Cost</th>
            </tr>
          </thead>
          <tbody>
            {[...taskMap.entries()].map(([name, d]) => (
              <tr key={name} className="border-b border-border/30 hover:bg-muted/30">
                <td className="px-2 py-1 font-mono">{name}</td>
                <td className="px-2 py-1 text-right tabular-nums">{d.turns}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtNum(d.input + d.cacheWrite + d.cacheRead)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtNum(d.output)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{d.cacheWrite > 0 ? fmtNum(d.cacheWrite) : '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{d.cacheRead > 0 ? fmtNum(d.cacheRead) : '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums">{(d.duration / 1000).toFixed(3)}s</td>
                <td className="px-2 py-1 text-right tabular-nums font-medium">{fmtCost(d.cost)}</td>
              </tr>
            ))}
            <tr className="border-t-2 font-medium">
              <td className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{allTurns.length}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(totalInput + totalCacheWrite + totalCacheRead)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(totalOutput)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{totalCacheWrite > 0 ? fmtNum(totalCacheWrite) : '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{totalCacheRead > 0 ? fmtNum(totalCacheRead) : '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">—</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCost(totalCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}

function EventsTab({ instanceId, missionId, isRunning }: { instanceId: string; missionId: string; isRunning: boolean }) {
  const queryClient = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<NormalizedEvent[]>([]);
  const eventLogRef = useRef<HTMLDivElement>(null);

  // Fetch historical events (covers events before page load)
  const { data: historyEventsData } = useQuery({
    queryKey: ['missionEvents', instanceId, missionId],
    queryFn: () => getMissionEvents(instanceId, missionId),
  });

  // SSE for real-time streaming when running.
  // Let the SSE stream close itself on mission_completed/failed to avoid race conditions.
  const eventsSSERef = useRef<{ close: () => void } | null>(null);
  useEffect(() => {
    if (!isRunning || eventsSSERef.current) return;
    setLiveEvents([]);

    const source = subscribeMissionEvents(
      instanceId,
      missionId,
      (event: MissionEvent) => {
        if (!VERBOSE_EVENTS.has(event.eventType)) {
          setLiveEvents(prev => [...prev, {
            eventType: event.eventType,
            data: event.data,
            timestamp: new Date().toISOString(),
          }]);
        }
      },
      () => {
        // Mission completed — refetch history for final state, drop live events
        eventsSSERef.current = null;
        queryClient.invalidateQueries({ queryKey: ['missionEvents', instanceId, missionId] });
        queryClient.invalidateQueries({ queryKey: ['missionDetail'] });
        setLiveEvents([]);
      },
      () => { eventsSSERef.current = null; },
    );
    eventsSSERef.current = source;

    return () => {
      source.close();
      eventsSSERef.current = null;
    };
  }, [isRunning, instanceId, missionId, queryClient]);

  const historyEvents: NormalizedEvent[] = useMemo(() => {
    if (!historyEventsData?.events) return [];
    return historyEventsData.events
      .filter(e => !VERBOSE_EVENTS.has(e.eventType))
      .map(e => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(e.dataJson || '{}'); } catch { /* skip */ }
        return { eventType: e.eventType, data, timestamp: e.createdAt };
      });
  }, [historyEventsData]);

  const displayEvents: NormalizedEvent[] = useMemo(() => {
    if (!isRunning || liveEvents.length === 0) return historyEvents;
    // When running: history events + SSE events for real-time updates
    return [...historyEvents, ...liveEvents];
  }, [isRunning, liveEvents, historyEvents]);

  // Auto-scroll when running
  useEffect(() => {
    if (isRunning && eventLogRef.current) {
      eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
    }
  }, [displayEvents, isRunning]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Event Log</span>
        {isRunning && <span className="text-[10px] text-purple-400 animate-pulse">Real-time Stream</span>}
      </div>
      <div ref={eventLogRef} className="flex-1 overflow-y-auto px-4 py-2">
        {displayEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No events.</p>
        ) : (
          displayEvents.map((event, i) => (
            <EventLogRow key={i} event={event} />
          ))
        )}
      </div>
    </div>
  );
}

/* ── Main page component ── */

export function MissionInstanceDetail() {
  const { id, mid } = useParams<{ id: string; mid: string }>();
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('general');
  const [liveTaskStatuses, setLiveTaskStatuses] = useState<Record<string, string>>({});
  const [chosenRoutes, setChosenRoutes] = useState<Record<string, string>>({});

  const {
    panelHeight,
    containerRef,
    reactFlowRef,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    togglePanel,
    getMaxHeight,
    onInit,
  } = useResizablePanel();

  const { data: instance, isLoading: instanceLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['missionDetail', id, mid],
    queryFn: () => getMissionDetail(id!, mid!),
    enabled: !!id && !!mid,
    refetchInterval: (query) => {
      const status = query.state.data?.mission?.status;
      return status === 'running' ? 2000 : false;
    },
  });

  const mission = detail?.mission;
  const taskRecords = detail?.tasks ?? [];
  const isRunning = mission?.status === 'running';

  // Default to events tab when mission is running on initial load
  const initialTabSet = useRef(false);
  useEffect(() => {
    if (!initialTabSet.current && mission) {
      initialTabSet.current = true;
      if (mission.status === 'running') {
        setActiveTab('events');
      }
    }
  }, [mission]);

  // Load route decisions from stored events
  const { data: eventsForRoutes } = useQuery({
    queryKey: ['missionEvents', id, mid],
    queryFn: () => getMissionEvents(id!, mid!),
    enabled: !!id && !!mid,
  });
  useEffect(() => {
    if (!eventsForRoutes?.events) return;
    const routes: Record<string, string> = {};
    for (const e of eventsForRoutes.events) {
      if (e.eventType === 'route_chosen' && e.dataJson) {
        try {
          const d = JSON.parse(e.dataJson) as Record<string, string>;
          if (d.routerTask && d.targetTask) {
            routes[d.routerTask] = d.targetTask;
          }
        } catch { /* ignore malformed */ }
      }
    }
    if (Object.keys(routes).length > 0) {
      setChosenRoutes(prev => ({ ...prev, ...routes }));
    }
  }, [eventsForRoutes]);

  // Parse task list from mission config snapshot (contains ALL tasks from mission start)
  const parsedTasks: TaskInfo[] = useMemo(() => {
    if (mission?.configJson) {
      try {
        const config = JSON.parse(mission.configJson);
        if (Array.isArray(config.tasks) && config.tasks.length > 0) {
          // Backfill empty objectives from individual task record configs
          // (handles iterated tasks whose objective was stored empty in older snapshots)
          const tasks = config.tasks as TaskInfo[];
          for (const t of tasks) {
            if (!t.objective) {
              const tr = taskRecords.find(r => r.taskName === t.name);
              if (tr) {
                const taskConfig = parseTaskConfig(tr);
                if (taskConfig?.objective) {
                  t.objective = taskConfig.objective;
                }
              }
            }
          }
          return tasks;
        }
      } catch { /* fall through */ }
    }
    // Fallback: derive from task records (only started tasks, for older data)
    return taskRecords.map(tr => {
      const parsed = parseTaskConfig(tr);
      return parsed ?? { name: tr.taskName };
    });
  }, [mission?.configJson, taskRecords]);

  // Build status map from task records + live statuses
  const statusMap = useMemo(() => {
    const map: Record<string, { status: string; error?: string }> = {};
    for (const tr of taskRecords) {
      map[tr.taskName] = { status: tr.status, error: tr.error ?? undefined };
    }
    if (isRunning) {
      for (const [name, status] of Object.entries(liveTaskStatuses)) {
        map[name] = { ...map[name], status };
      }
    }
    return map;
  }, [taskRecords, isRunning, liveTaskStatuses]);

  // Merge status into task data for ReactFlow nodes
  const tasksWithStatus = useMemo(() => {
    return parsedTasks.map(t => ({
      ...t,
      runStatus: statusMap[t.name]?.status ?? 'pending',
      runError: statusMap[t.name]?.error,
    }));
  }, [parsedTasks, statusMap]);

  const { nodes, edges } = useMemo(() => {
    if (tasksWithStatus.length === 0) return { nodes: [], edges: [] };
    return layoutGraph(tasksWithStatus, chosenRoutes, statusMap);
  }, [tasksWithStatus, chosenRoutes, statusMap]);

  const nodesWithSelection = useMemo(() => {
    return nodes.map(n => ({
      ...n,
      selected: activeTab === 'tasks' && n.id === selectedTask,
    }));
  }, [nodes, selectedTask, activeTab]);

  // SSE for running missions — update canvas node statuses.
  // Keyed on mission status: subscribe once when running, let SSE close itself on completion.
  const canvasSSERef = useRef<{ close: () => void } | null>(null);
  useEffect(() => {
    if (!id || !mid) return;
    // Only open a new stream when mission is running and we don't already have one
    if (!isRunning || canvasSSERef.current) return;
    setLiveTaskStatuses({});

    const source = subscribeMissionEvents(
      id,
      mid,
      (event: MissionEvent) => {
        const taskName = (event.data as Record<string, string>)?.taskName;
        if (taskName) {
          switch (event.eventType) {
            case 'task_started':
              setLiveTaskStatuses(prev => ({ ...prev, [taskName]: 'running' }));
              break;
            case 'task_completed':
              setLiveTaskStatuses(prev => ({ ...prev, [taskName]: 'completed' }));
              break;
            case 'task_failed':
              setLiveTaskStatuses(prev => ({ ...prev, [taskName]: 'failed' }));
              break;
          }
        }
        if (event.eventType === 'route_chosen') {
          const d = event.data as Record<string, string>;
          if (d.routerTask && d.targetTask) {
            setChosenRoutes(prev => ({ ...prev, [d.routerTask]: d.targetTask }));
          }
        }
      },
      () => {
        canvasSSERef.current = null;
        queryClient.invalidateQueries({ queryKey: ['missionDetail', id, mid] });
      },
      () => { canvasSSERef.current = null; },
    );
    canvasSSERef.current = source;

    return () => {
      source.close();
      canvasSSERef.current = null;
    };
  }, [isRunning, id, mid, queryClient]);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'terminal' || node.type === 'missionRoute') return;
    setSelectedTask(node.id);
    setActiveTab('tasks');
  }, []);

  if (instanceLoading || detailLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance || !mission) return <div className="p-8 text-muted-foreground">Mission run not found</div>;

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 py-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to={`/instances/${id}/history`} className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{mission.name}</h1>
                <StatusBadge status={mission.status} />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                <span>{formatTime(mission.startedAt)}</span>
                {mission.finishedAt && (
                  <span>({formatDuration(mission.startedAt, mission.finishedAt)})</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                onClick={async () => {
                  try {
                    await stopMission(id!, mid!);
                    queryClient.invalidateQueries({ queryKey: ['missionDetail', id, mid] });
                  } catch (e: unknown) {
                    console.error('Failed to stop mission:', e);
                  }
                }}
              >
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Stop
              </Button>
            )}
            {(mission.status === 'failed' || mission.status === 'stopped') && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await resumeMission(id!, mid!, mission.name);
                    queryClient.invalidateQueries({ queryKey: ['missionDetail', id, mid] });
                  } catch (e: unknown) {
                    console.error('Failed to resume mission:', e);
                  }
                }}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Restart
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ReactFlow canvas */}
      <div className="flex-1 min-h-0 p-4">
        <div className="relative h-full rounded-lg border bg-card overflow-hidden">
          <ReactFlow
            nodes={nodesWithSelection}
            edges={edges}
            nodeTypes={runNodeTypes}
            edgeTypes={runEdgeTypes}
            onInit={onInit}
            onNodeClick={onNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            panOnDrag
            zoomOnScroll
            minZoom={0.3}
            maxZoom={1.5}
          >
            <Background gap={20} size={1} />
          </ReactFlow>
          <ZoomControls reactFlowRef={reactFlowRef} />
        </div>
      </div>

      {/* Bottom panel */}
      <div
        className="shrink-0 border-t bg-card shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
        style={{ height: panelHeight }}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0 h-full">
          <div
            className="shrink-0 flex items-center px-4 border-b select-none touch-none cursor-row-resize"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <TabsList variant="line">
              <TabsTrigger value="general">General</TabsTrigger>
              {mission.inputsJson && (
                <TabsTrigger value="inputs">Inputs</TabsTrigger>
              )}
              <TabsTrigger value="datasets">Datasets</TabsTrigger>
              <TabsTrigger value="tasks">
                Tasks
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">{taskRecords.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="costs">Costs</TabsTrigger>
            </TabsList>
            <div className="ml-auto">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={togglePanel}>
                {panelHeight >= getMaxHeight() ? <ChevronsDown className="h-3.5 w-3.5" /> : <ChevronsUp className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="general" className="h-full m-0">
              <GeneralTab mission={mission} tasks={taskRecords} />
            </TabsContent>
            {mission.inputsJson && (
              <TabsContent value="inputs" className="h-full m-0">
                <div className="overflow-y-auto p-4 h-full">
                  <div className="space-y-3 max-w-2xl">
                    {(() => {
                      try {
                        const values = JSON.parse(mission.inputsJson) as Record<string, string>;
                        // Get input definitions from config snapshot for descriptions
                        let defs: Record<string, { description?: string; type?: string; protected?: boolean }> = {};
                        if (mission.configJson) {
                          try {
                            const config = JSON.parse(mission.configJson);
                            if (Array.isArray(config.inputs)) {
                              for (const inp of config.inputs) {
                                defs[inp.name] = { description: inp.description, type: inp.type, protected: inp.protected };
                              }
                            }
                          } catch { /* ignore */ }
                        }
                        return Object.entries(values).map(([k, v]) => (
                          <div key={k} className="border rounded-lg p-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{k}</span>
                              {defs[k]?.type && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{defs[k].type}</Badge>
                              )}
                              {defs[k]?.protected && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0 font-medium">
                                  <ShieldCheck className="size-3" />
                                  protected
                                </span>
                              )}
                            </div>
                            {defs[k]?.description && (
                              <p className="text-xs text-muted-foreground mt-1">{defs[k].description}</p>
                            )}
                            <p className="text-sm mt-1.5 whitespace-pre-wrap break-all">{v}</p>
                          </div>
                        ));
                      } catch { return null; }
                    })()}
                  </div>
                </div>
              </TabsContent>
            )}
            <TabsContent value="datasets" className="h-full m-0">
              <DatasetsTab instanceId={id!} missionId={mid!} isRunning={isRunning} />
            </TabsContent>
            <TabsContent value="tasks" className="h-full m-0">
              <TasksTab instanceId={id!} tasks={taskRecords} allTasks={parsedTasks} missionId={mid!} isRunning={isRunning} chosenRoutes={chosenRoutes} selectedTaskName={selectedTask} onSelectTaskName={setSelectedTask} />
            </TabsContent>
            <TabsContent value="events" className="h-full m-0">
              <EventsTab instanceId={id!} missionId={mid!} isRunning={isRunning} />
            </TabsContent>
            <TabsContent value="costs" className="h-full m-0">
              <MissionCostsTab instanceId={id!} missionId={mid!} isRunning={isRunning} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Session Messages / System Prompts Modal
// ---------------------------------------------------------------------------

const MAX_LINES = 15;

function CollapsiblePre({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const needsTruncation = lines.length > MAX_LINES;
  const displayed = expanded || !needsTruncation ? content : lines.slice(0, MAX_LINES).join('\n');

  return (
    <div>
      <pre className="text-[11px] text-muted-foreground bg-muted/30 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
        {displayed}
      </pre>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground mt-1 cursor-pointer"
        >
          {expanded ? '▲ Collapse' : `▼ Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

function SessionMessagesModal({
  instanceId,
  modal,
  onClose,
  toolResults,
}: {
  instanceId: string;
  modal: { type: 'messages' | 'system'; sessionId: string } | null;
  onClose: () => void;
  toolResults?: ToolResultDTO[];
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['chatMessages', instanceId, modal?.sessionId],
    queryFn: () => getChatMessages(instanceId, modal!.sessionId),
    enabled: !!modal,
  });

  const messages = data?.messages ?? [];
  const filtered = modal?.type === 'system'
    ? messages.filter(m => m.role === 'system')
    : messages.filter(m => m.role !== 'system');

  const roleColor = (role: string) =>
    role === 'system' ? 'text-purple-400' :
    role === 'assistant' ? 'text-emerald-400' :
    role === 'user' ? 'text-sky-400' : 'text-muted-foreground';

  return (
    <Dialog open={!!modal} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {modal?.type === 'system' ? 'System Prompts' : 'Raw Messages'}
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 min-h-0 space-y-3">
          {isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">No messages found.</p>
          )}
          {filtered.map((msg, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn('text-[10px] font-medium uppercase tracking-wider', roleColor(msg.role))}>
                  {msg.role}
                </span>
                {msg.createdAt && (
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {(() => {
                // For user messages with [image] placeholders, hydrate images from tool results
                const { images: directImages } = extractImages(msg.content);
                let hydratedImages = directImages;
                if (directImages.length === 0 && msg.role === 'user' && msg.content.includes('[image]') && toolResults) {
                  // Find the tool result that corresponds to this observation
                  // Match by finding a tool result whose output contains image data URLs
                  const msgTime = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
                  for (const tr of toolResults) {
                    if (tr.sessionId !== modal?.sessionId) continue;
                    const trTime = new Date(tr.finishedAt).getTime();
                    // Tool result should be just before this user message
                    if (msgTime > 0 && trTime > 0 && Math.abs(trTime - msgTime) < 5000) {
                      const { images: trImages } = extractImages(tr.output || '');
                      if (trImages.length > 0) {
                        hydratedImages = trImages;
                        break;
                      }
                    }
                  }
                }
                return (
                  <>
                    <CollapsiblePre content={msg.content} />
                    {hydratedImages.length > 0 && <ImageCarousel images={hydratedImages} />}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
