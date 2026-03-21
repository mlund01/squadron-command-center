import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
  Handle,
  Position,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { ChevronsDown, ChevronsUp, ChevronDown, Repeat, ChevronLeft, ChevronRight, HelpCircle, Square, RotateCcw } from 'lucide-react';

import { getInstance, getMissionDetail, getMissionEvents, getTaskDetail, getRunDatasets, getDatasetItems, getChatMessages, stopMission, resumeMission } from '@/api/client';
import { subscribeMissionEvents } from '@/api/sse';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StatusBadge, formatTime, formatDuration } from '@/lib/mission-utils';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { ZoomControls } from '@/components/zoom-controls';
import type { TaskInfo, MissionEvent, MissionTaskRecord, ToolResultDTO, TaskOutputInfo, SubtaskInfo, DatasetItemInfo } from '@/api/types';


const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;

/* ── Status-aware task node for run view ── */

function RunTaskNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const task = data as unknown as TaskInfo & { runStatus?: string; runError?: string };
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
        <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />
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
          {isIterated && (
            <div className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
              <Repeat className="h-3 w-3" />
              <span>iterated</span>
            </div>
          )}
        </div>
        {status === 'failed' && task.runError && (
          <p className="text-xs text-red-500 line-clamp-2">{task.runError}</p>
        )}
        {status === 'pending' && task.objective && (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.objective}</p>
        )}
        <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2 !h-2" />
      </div>
    </div>
  );
}

const runNodeTypes: NodeTypes = { task: RunTaskNode };

/* ── Layout helper (reused from MissionDetail) ── */

function layoutGraph(tasks: TaskInfo[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });

  for (const task of tasks) {
    g.setNode(task.name, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const edges: Edge[] = [];
  for (const task of tasks) {
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        g.setEdge(dep, task.name);
        edges.push({ id: `${dep}->${task.name}`, source: dep, target: task.name, animated: false });
      }
    }
  }

  dagre.layout(g);

  const nodes: Node[] = tasks.map((task) => {
    const pos = g.node(task.name);
    return {
      id: task.name,
      type: 'task',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: task as unknown as Record<string, unknown>,
    };
  });

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
  'agent_thinking', 'agent_answer', 'commander_reasoning', 'commander_answer',
  'session_turn', 'mission_stopped', 'mission_resumed',
]);

function getEventBg(eventType: string): string {
  if (eventType === 'compaction') return 'bg-purple-500/10';
  if (eventType.includes('failed')) return 'bg-red-500/10';
  if (eventType.includes('completed')) return 'bg-green-500/10';
  if (eventType.includes('started')) return 'bg-blue-500/10';
  if (eventType.includes('tool')) return 'bg-yellow-500/10';
  return 'bg-muted/50';
}

function formatEventText(eventType: string, d: Record<string, unknown>): string {
  switch (eventType) {
    case 'mission_started': return `Mission "${d.missionName}" started (${d.taskCount} tasks)`;
    case 'mission_completed': return `Mission "${d.missionName}" completed`;
    case 'mission_failed': return `Mission failed: ${d.error}`;
    case 'task_started': return `Task "${d.taskName}" started`;
    case 'task_completed': return `Task "${d.taskName}" completed`;
    case 'task_failed': return `Task "${d.taskName}" failed: ${d.error}`;
    case 'agent_started': return `Agent "${d.agentName}" started for "${d.taskName}"`;
    case 'agent_completed': return `Agent "${d.agentName}" completed`;
    case 'agent_calling_tool': return `Agent calling tool "${d.toolName}"`;
    case 'agent_tool_complete': return `Tool "${d.toolName}" complete`;
    case 'commander_calling_tool': return `Commander calling "${d.toolName}"`;
    case 'commander_tool_complete': return `Commander tool "${d.toolName}" complete`;
    case 'iteration_started': return `Iteration ${d.index} started for "${d.taskName}"`;
    case 'iteration_completed': return `Iteration ${d.index} completed for "${d.taskName}"`;
    case 'iteration_failed': return `Iteration ${d.index} failed for "${d.taskName}"`;
    case 'compaction': return `Context compacted (${d.entity}): ${d.inputTokens} tokens > ${d.tokenLimit} limit, ${d.messagesCompacted} msgs compacted`;
    default: return JSON.stringify(d);
  }
}

/* ── General Tab ── */

function GeneralTab({ mission, tasks }: { mission: { name: string; status: string; inputsJson?: string; startedAt: string; finishedAt?: string }; tasks: MissionTaskRecord[] }) {
  const inputs = useMemo(() => {
    if (!mission.inputsJson) return null;
    try { return JSON.parse(mission.inputsJson) as Record<string, string>; } catch { return null; }
  }, [mission.inputsJson]);

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

        {inputs && Object.keys(inputs).length > 0 && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Inputs</span>
            <div className="mt-1 space-y-1">
              {Object.entries(inputs).map(([k, v]) => (
                <div key={k} className="flex items-start gap-2 text-sm">
                  <span className="font-medium shrink-0">{k}:</span>
                  <span className="text-muted-foreground break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
  | { type: 'tool'; toolResult: ToolResultDTO }
  | null;

interface GanttSpan {
  id: string;
  label: string;
  start: number;
  end: number;
  category: 'commander' | 'agent' | 'tool' | 'dataset_next';
  sessionId?: string;
  toolResult?: ToolResultDTO;
  breaks?: number[]; // timestamps where a break (stop→resume gap) occurred
}

const SPAN_COLORS: Record<GanttSpan['category'], string> = {
  commander: 'bg-purple-500',
  agent: 'bg-blue-500',
  tool: 'bg-teal-500',
  dataset_next: 'bg-amber-500',
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

function TasksTab({ instanceId, tasks, missionId, isRunning }: { instanceId: string; tasks: MissionTaskRecord[]; missionId: string; isRunning: boolean }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);
  const [selection, setSelection] = useState<PanelSelection>(null);
  const [traceView, setTraceView] = useState<'detail' | 'subtasks' | 'output' | 'iterations' | 'flamegraph' | 'table' | 'turns'>('detail');
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
  const [turnsEntityFilter, setTurnsEntityFilter] = useState('all');

  const selectedSessionId = selection?.type === 'session' ? selection.sessionId : null;

  // Auto-select first task
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  const { data: taskDetail } = useQuery({
    queryKey: ['taskDetail', instanceId, selectedTaskId],
    queryFn: () => getTaskDetail(instanceId, selectedTaskId!),
    enabled: !!selectedTaskId,
    refetchInterval: isRunning ? 2000 : false,
  });

  // Events for gantt + detail
  const { data: missionEventsData } = useQuery({
    queryKey: ['missionEvents', instanceId, missionId],
    queryFn: () => getMissionEvents(instanceId, missionId),
    refetchInterval: isRunning ? 2000 : false,
  });

  // Messages for selected session
  const { data: sessionMessages } = useQuery({
    queryKey: ['chatMessages', instanceId, selectedSessionId],
    queryFn: () => getChatMessages(instanceId, selectedSessionId!),
    enabled: !!selectedSessionId,
  });

  const allSessions = taskDetail?.sessions ?? [];
  const selectedTask = tasks.find(t => t.id === selectedTaskId);

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

  // Latest event timestamp — the "now" for the flamegraph. Purely event-driven.
  const latestEventTime = useMemo(() => {
    if (allMissionEvents.length === 0) return 0;
    return Math.max(...allMissionEvents.map(e => e.time));
  }, [allMissionEvents]);

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

  // Compute iteration time range for flame graph highlight (sequential only — parallel already scopes the entire graph)
  const iterationTimeRange = useMemo(() => {
    if (!isIterated || isParallelIteration || selectedIteration == null) return null;
    const iterEvents = taskEvents.filter(e => e.iterationIndex === selectedIteration);
    if (iterEvents.length === 0) return null;
    const earliest = Math.min(...iterEvents.map(e => e.time));
    const latest = Math.max(...iterEvents.map(e => e.time));
    return { start: earliest, end: latest };
  }, [isIterated, isParallelIteration, selectedIteration, taskEvents]);

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
  const findAgentSession = useCallback((tr: ToolResultDTO) => {
    // Match by agent name from call_agent input params
    if (tr.toolName === 'call_agent') {
      try {
        const parsed = JSON.parse(tr.inputParams || '{}');
        if (parsed.name) {
          const byName = allSessions.find(s => s.role !== 'commander' && s.agentName === parsed.name);
          if (byName) return byName;
        }
      } catch { /* fall through */ }
    }
    // Fallback: time-based match
    const trStart = new Date(tr.startedAt).getTime();
    const trEnd = new Date(tr.finishedAt).getTime();
    return allSessions.find(s => s.role !== 'commander' && new Date(s.startedAt).getTime() >= trStart - 1000 && new Date(s.startedAt).getTime() <= trEnd);
  }, [allSessions]);

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
    const calls = events.filter(e => e.eventType === callingType);
    const completions = [...events.filter(e => e.eventType === completeType)];
    const pairs: { id: string; toolName: string; start: number; end: number; sessionId: string }[] = [];
    for (const call of calls) {
      const toolName = String(call.data.toolName || '');
      const matchIdx = completions.findIndex(c =>
        c.sessionId === call.sessionId &&
        c.time >= call.time &&
        String(c.data.toolName || '') === toolName
      );
      const completion = matchIdx >= 0 ? completions.splice(matchIdx, 1)[0] : null;
      pairs.push({
        id: call.id,
        toolName,
        start: call.time,
        end: completion ? completion.time : fallbackEnd,
        sessionId: call.sessionId || '',
      });
    }
    return pairs;
  }, []);

  // Helper: find a ToolResultDTO matching an event-derived span (for detail panel click-through)
  const findToolResultForEvent = useCallback((sessionId: string, toolName: string, startTime: number) => {
    return allToolResults.find(tr =>
      tr.sessionId === sessionId &&
      tr.toolName === toolName &&
      Math.abs(new Date(tr.startedAt).getTime() - startTime) < 2000
    );
  }, [allToolResults]);

  const ganttLines = useMemo((): GanttSpan[][] => {
    const lines: GanttSpan[][] = [];
    const ct = compressTime;
    const cEnd = compressTime(latestEventTime);

    // Filter events by iteration for parallel tasks
    // Use iterationIndex if available, otherwise parse from taskName (e.g. "write_story[2]" → 2)
    const activeEvents = isParallelIteration && selectedIteration != null
      ? taskEvents.filter(e => e.iterationIndex === selectedIteration)
      : taskEvents;

    // --- Line 1: Commander span ---
    // Use first commander event as start, last as end
    const CMDR_EVENTS = new Set([
      'commander_reasoning', 'commander_answer', 'commander_calling_tool', 'commander_tool_complete',
      'iteration_reasoning', 'iteration_answer',
    ]);
    const cmdrEvents = activeEvents.filter(e => CMDR_EVENTS.has(e.eventType));
    const cmdrSessionId = cmdrEvents.find(e => e.sessionId)?.sessionId;
    if (cmdrEvents.length > 0) {
      const spanStart = ct(Math.min(...cmdrEvents.map(e => e.time)));
      const spanEnd = ct(Math.max(...cmdrEvents.map(e => e.time)));
      const breaks = resumeBreaks.filter(t => t > spanStart && t < spanEnd);
      lines.push([{
        id: cmdrSessionId || 'commander', label: 'commander',
        start: spanStart, end: Math.max(spanEnd, cEnd),
        category: 'commander', sessionId: cmdrSessionId,
        breaks: breaks.length > 0 ? breaks : undefined,
      }]);
    }

    // --- Line 2: Commander tool calls + agent spans ---
    const line2: GanttSpan[] = [];

    // Commander tool calls (excluding call_agent — those become agent spans)
    const cmdrToolPairs = pairToolEvents(activeEvents, 'commander_calling_tool', 'commander_tool_complete', latestEventTime);
    for (const pair of cmdrToolPairs) {
      if (pair.toolName === 'call_agent') continue;
      const matchedTR = findToolResultForEvent(pair.sessionId, pair.toolName, pair.start);
      line2.push({
        id: pair.id, label: pair.toolName,
        start: ct(pair.start), end: ct(pair.end),
        category: pair.toolName === 'dataset_next' ? 'dataset_next' : 'tool',
        toolResult: matchedTR,
      });
    }

    // Agent spans from agent_started / agent_completed events
    const stopTimes = allMissionEvents
      .filter(e => e.eventType === 'mission_stopped')
      .map(e => e.time)
      .sort((a, b) => a - b);
    const agentStarts = activeEvents.filter(e => e.eventType === 'agent_started');
    const agentCompletes = [...activeEvents.filter(e => e.eventType === 'agent_completed')];

    type AgentSegment = { agentName: string; startTime: number; endTime: number; completed: boolean; startId: string };
    const segments: AgentSegment[] = [];
    for (const startEvt of agentStarts) {
      const agentName = String(startEvt.data.agentName || 'agent');
      const nextStop = stopTimes.find(t => t > startEvt.time);
      const completeEvt = agentCompletes.find(e =>
        String(e.data.agentName || '') === agentName && e.time >= startEvt.time
      );
      const interrupted = nextStop != null && (!completeEvt || nextStop < completeEvt.time);
      if (!interrupted && completeEvt) {
        agentCompletes.splice(agentCompletes.indexOf(completeEvt), 1);
      }
      segments.push({
        agentName,
        startTime: startEvt.time,
        endTime: interrupted ? nextStop! : (completeEvt ? completeEvt.time : latestEventTime),
        completed: !interrupted && !!completeEvt,
        startId: startEvt.id,
      });
    }

    // Merge consecutive interrupted segments across stop/resume gaps
    const mergedAgentSpans: { agentName: string; start: number; end: number; breaks: number[]; id: string }[] = [];
    let current: typeof mergedAgentSpans[0] | null = null;
    let lastWasInterrupted = false;
    for (const seg of segments) {
      if (current && current.agentName === seg.agentName && lastWasInterrupted) {
        const breakTime = ct(seg.startTime);
        if (breakTime > current.start) current.breaks.push(breakTime);
        current.end = ct(seg.endTime);
      } else {
        if (current) mergedAgentSpans.push(current);
        current = { agentName: seg.agentName, start: ct(seg.startTime), end: ct(seg.endTime), breaks: [], id: seg.startId };
      }
      lastWasInterrupted = !seg.completed;
    }
    if (current) mergedAgentSpans.push(current);

    for (const span of mergedAgentSpans) {
      line2.push({
        id: `agent-evt-${span.id}`, label: span.agentName,
        start: span.start, end: span.end,
        category: 'agent' as const,
        breaks: span.breaks.length > 0 ? span.breaks : undefined,
      });
    }

    if (line2.length > 0) {
      line2.sort((a, b) => a.start - b.start);
      lines.push(line2);
    }

    // --- Lines 3+: Agent tool calls, one line per agent session ---
    const agentToolPairs = pairToolEvents(activeEvents, 'agent_calling_tool', 'agent_tool_complete', latestEventTime);
    // Group by sessionId
    const bySession = new Map<string, typeof agentToolPairs>();
    for (const pair of agentToolPairs) {
      const key = pair.sessionId;
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key)!.push(pair);
    }
    for (const [, pairs] of bySession) {
      const line: GanttSpan[] = pairs.map(pair => {
        const matchedTR = findToolResultForEvent(pair.sessionId, pair.toolName, pair.start);
        return {
          id: pair.id, label: pair.toolName,
          start: ct(pair.start), end: ct(pair.end),
          category: 'tool' as const,
          toolResult: matchedTR,
        };
      });
      line.sort((a, b) => a.start - b.start);
      lines.push(line);
    }

    return lines;
  }, [taskEvents, allMissionEvents, isParallelIteration, selectedIteration, latestEventTime, compressTime, resumeBreaks, pairToolEvents, findToolResultForEvent]);

  // Gantt time range — derived entirely from ganttLines (event-driven)
  const { ganttStart, ganttDuration } = useMemo(() => {
    let earliest = Infinity;
    let latest = 0;
    for (const line of ganttLines) {
      for (const span of line) {
        if (span.start < earliest) earliest = span.start;
        if (span.end > latest) latest = span.end;
      }
    }
    if (earliest === Infinity) return { ganttStart: 0, ganttDuration: 1 };
    return { ganttStart: earliest, ganttDuration: Math.max(latest - earliest, 1) };
  }, [ganttLines]);

  // Events filtered by iteration (same logic as ganttLines uses)
  const activeEvents = useMemo(() => {
    if (!(isParallelIteration && selectedIteration != null)) return taskEvents;
    return taskEvents.filter(e => e.iterationIndex === selectedIteration);
  }, [taskEvents, isParallelIteration, selectedIteration, ]);

  // Reasoning ticks for flame graph: map spanId → array of { pct, time } within each session/agent span
  const messageTicks = useMemo(() => {
    const ticks = new Map<string, { pct: number; time: number }[]>();
    const REASONING_EVENTS = new Set([
      'commander_reasoning', 'agent_thinking',
    ]);

    for (const line of ganttLines) {
      for (const span of line) {
        if (span.category !== 'commander' && span.category !== 'agent') continue;
        const spanDur = span.end - span.start;
        if (spanDur <= 0) continue;

        // Find matching session for this span
        let sessionId: string | undefined;
        if (span.sessionId) {
          sessionId = span.sessionId;
        } else if (span.toolResult?.toolName === 'call_agent') {
          const agentSession = findAgentSession(span.toolResult);
          if (agentSession) sessionId = agentSession.id;
        }
        if (!sessionId) continue;
        const session = sessionMap.get(sessionId);
        if (!session) continue;

        const isCmd = session.role === 'commander';
        const spanTicks: { pct: number; time: number }[] = [];

        for (const evt of activeEvents) {
          if (!REASONING_EVENTS.has(evt.eventType)) continue;
          const ct = compressTime(evt.time);
          if (ct < span.start || ct > span.end) continue;
          // Commander spans only show commander_reasoning; agent spans only show agent_thinking
          if (isCmd && evt.eventType !== 'commander_reasoning') continue;
          if (!isCmd && (evt.eventType !== 'agent_thinking' || evt.data.agentName !== session.agentName)) continue;

          const pct = ((ct - span.start) / spanDur) * 100;
          spanTicks.push({ pct, time: ct });
        }

        if (spanTicks.length > 0) {
          // Deduplicate ticks that are too close together (< 0.5% apart)
          spanTicks.sort((a, b) => a.pct - b.pct);
          const deduped = [spanTicks[0]];
          for (let i = 1; i < spanTicks.length; i++) {
            if (spanTicks[i].pct - deduped[deduped.length - 1].pct > 0.5) {
              deduped.push(spanTicks[i]);
            }
          }
          ticks.set(span.id, deduped);
        }
      }
    }
    return ticks;
  }, [ganttLines, activeEvents, sessionMap, findAgentSession, compressTime]);

  // State for scrolling to a specific activity event in the detail panel
  const [scrollToActivityTime, setScrollToActivityTime] = useState<number | null>(null);
  const [highlightedActivityIdx, setHighlightedActivityIdx] = useState<number | null>(null);
  const [detailPanelTab, setDetailPanelTab] = useState<string>('activity');
  const activityRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Session detail events (filter by time range + role matching)
  const sessionDetailEvents = useMemo(() => {
    if (!selectedSessionId) return [];
    const session = allSessions.find(s => s.id === selectedSessionId);
    if (!session) return [];
    const sStart = new Date(session.startedAt).getTime();
    const sEnd = session.finishedAt ? new Date(session.finishedAt).getTime() + 1000 : latestEventTime;
    const isCmd = session.role === 'commander';

    return taskEvents
      .filter(e => {
        const matchesRole = isCmd
          ? e.eventType.startsWith('commander_')
          : e.eventType.startsWith('agent_');
        if (!matchesRole) return false;
        if (!isCmd && e.data.agentName !== session.agentName) return false;
        return e.time >= sStart && e.time <= sEnd;
      })
      .map(e => ({ eventType: e.eventType, data: e.data, timestamp: e.createdAt }));
  }, [selectedSessionId, allSessions, taskEvents]);

  // Pre-compute tool call durations for session detail panel
  const toolDurations = useMemo(() => {
    const durations = new Map<number, string>();
    const pending = new Map<string, { index: number; time: number }>();
    for (let i = 0; i < sessionDetailEvents.length; i++) {
      const evt = sessionDetailEvents[i];
      if (evt.eventType === 'commander_calling_tool' || evt.eventType === 'agent_calling_tool') {
        pending.set(String(evt.data.toolName || ''), { index: i, time: new Date(evt.timestamp).getTime() });
      } else if (evt.eventType === 'commander_tool_complete' || evt.eventType === 'agent_tool_complete') {
        const key = String(evt.data.toolName || '');
        const start = pending.get(key);
        if (start) {
          const ms = new Date(evt.timestamp).getTime() - start.time;
          const label = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
          durations.set(start.index, label);
          durations.set(i, label);
          pending.delete(key);
        }
      }
    }
    return durations;
  }, [sessionDetailEvents]);

  // Scroll to activity event when a flame graph tick is clicked
  useEffect(() => {
    if (scrollToActivityTime == null || sessionDetailEvents.length === 0) return;
    setDetailPanelTab('activity');
    // Find closest event by timestamp
    let closestIdx = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < sessionDetailEvents.length; i++) {
      const evtTime = new Date(sessionDetailEvents[i].timestamp).getTime();
      const diff = Math.abs(evtTime - scrollToActivityTime);
      if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
    }
    setHighlightedActivityIdx(closestIdx);
    setTimeout(() => {
      const el = activityRefs.current.get(closestIdx);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    // Clear highlight after 2s
    setTimeout(() => setHighlightedActivityIdx(prev => prev === closestIdx ? null : prev), 2000);
    setScrollToActivityTime(null);
  }, [scrollToActivityTime, sessionDetailEvents]);

  // Zoom/pan state: zoom=1 means full view, panOffset=0..1 is left edge fraction
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<{ startX: number; startOffset: number; dragging: boolean; pointerId: number } | null>(null);

  // Reset zoom when switching tasks/iterations
  useEffect(() => {
    setZoom(1);
    setPanOffset(0);
  }, [selectedTaskId, selectedIteration]);

  const viewWidth = 1 / zoom; // fraction of total visible
  const viewStart = panOffset; // fraction

  // Zoom-aware percent: maps absolute time to percent within the visible window
  const toPercent = useCallback((t: number) => {
    const frac = (t - ganttStart) / ganttDuration; // 0..1
    return ((frac - viewStart) / viewWidth) * 100;
  }, [ganttStart, ganttDuration, viewStart, viewWidth]);

  // Zoom ref to avoid stale closures in the native event listener
  const zoomRef = useRef({ zoom, viewStart, viewWidth });
  zoomRef.current = { zoom, viewStart, viewWidth };

  // Wheel handler ref — persists across mounts so cleanup works correctly
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);

  // Callback ref for gantt container — attaches wheel handler on mount, detaches on unmount
  const ganttRefCallback = useCallback((el: HTMLDivElement | null) => {
    // Clean up previous
    if (ganttContainerRef.current && wheelHandlerRef.current) {
      ganttContainerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
    }
    ganttContainerRef.current = el;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      // Only zoom on pinch gesture (ctrlKey is set for trackpad pinch-to-zoom)
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { zoom: z, viewStart: vs, viewWidth: vw } = zoomRef.current;
      const cursorFrac = (e.clientX - rect.left) / rect.width;
      const cursorPos = vs + cursorFrac * vw;
      const zoomDelta = e.deltaY > 0 ? 0.97 : 1.03;
      const newZoom = Math.max(1, Math.min(50, z * zoomDelta));
      const newViewWidth = 1 / newZoom;
      let newOffset = cursorPos - cursorFrac * newViewWidth;
      newOffset = Math.max(0, Math.min(1 - newViewWidth, newOffset));
      setZoom(newZoom);
      setPanOffset(newOffset);
    };
    wheelHandlerRef.current = handler;
    el.addEventListener('wheel', handler, { passive: false });
  }, []);

  // Pan via mouse drag (with movement threshold to preserve click interactions)
  const PAN_THRESHOLD = 4; // pixels before a pointerdown becomes a drag
  const handlePanStart = useCallback((e: React.PointerEvent) => {
    if (zoom <= 1) return;
    if (e.button !== 0) return;
    panDragRef.current = { startX: e.clientX, startOffset: panOffset, dragging: false, pointerId: e.pointerId };
  }, [zoom, panOffset]);

  const handlePanMove = useCallback((e: React.PointerEvent) => {
    if (!panDragRef.current || !ganttContainerRef.current) return;
    const dx = e.clientX - panDragRef.current.startX;
    if (!panDragRef.current.dragging) {
      if (Math.abs(dx) < PAN_THRESHOLD) return;
      // Exceeded threshold — start dragging
      panDragRef.current.dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(panDragRef.current.pointerId);
    }
    const rect = ganttContainerRef.current.getBoundingClientRect();
    const fracDx = dx / rect.width * viewWidth;
    let newOffset = panDragRef.current.startOffset - fracDx;
    newOffset = Math.max(0, Math.min(1 - viewWidth, newOffset));
    setPanOffset(newOffset);
  }, [viewWidth]);

  const handlePanEnd = useCallback((e: React.PointerEvent) => {
    const wasDragging = panDragRef.current?.dragging;
    panDragRef.current = null;
    if (wasDragging) {
      // Prevent the click event that follows pointerup after a drag
      const el = e.currentTarget as HTMLElement;
      const suppress = (ce: Event) => { ce.stopPropagation(); el.removeEventListener('click', suppress, true); };
      el.addEventListener('click', suppress, true);
    }
  }, []);

  // Time axis ticks — computed for the visible window
  // Nice intervals in seconds, from ms up to minutes
  const NICE_INTERVALS = [
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600,
  ];
  const visibleDurationMs = ganttDuration * viewWidth;
  const ticks = useMemo(() => {
    if (ganttDuration <= 1) return [];
    const visDurSec = visibleDurationMs / 1000;
    const visStartSec = (panOffset * ganttDuration) / 1000;
    // Pick the largest nice interval that gives us >= 5 ticks
    let interval = NICE_INTERVALS[0];
    for (let i = NICE_INTERVALS.length - 1; i >= 0; i--) {
      if (visDurSec / NICE_INTERVALS[i] >= 5) {
        interval = NICE_INTERVALS[i];
        break;
      }
    }
    const result: { pct: number; label: string }[] = [];
    const firstTick = Math.ceil(visStartSec / interval) * interval;
    for (let t = firstTick; t <= visStartSec + visDurSec; t += interval) {
      const pct = ((t - visStartSec) / visDurSec) * 100;
      if (pct < -1 || pct > 101) continue;
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
  }, [ganttDuration, visibleDurationMs, panOffset]);

  const hasContent = allSessions.length > 0;

  return (
    <div className="flex h-full">
      {/* Left: task list */}
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {tasks.map(task => (
            <button
              key={task.id}
              onClick={() => { setSelectedTaskId(task.id); setSelection(null); }}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedTaskId === task.id && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  task.status === 'completed' ? 'bg-green-500' :
                  task.status === 'running' ? 'bg-blue-500 animate-pulse' :
                  task.status === 'failed' ? 'bg-red-500' :
                  task.status === 'stopped' ? 'bg-orange-500' :
                  'bg-muted-foreground/30'
                )} />
                <span className="truncate">{task.taskName}</span>
              </div>
              {task.startedAt && task.finishedAt && (
                <span className="text-[10px] text-muted-foreground ml-3.5">
                  {formatDuration(task.startedAt, task.finishedAt)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Center: gantt with time axis */}
      <div className="flex-1 relative min-h-0">
        {selectedTask ? (
          <Tabs value={traceView} onValueChange={v => setTraceView(v as typeof traceView)} className="flex flex-col h-full gap-0">
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
                <TabsTrigger value="flamegraph" className="text-xs px-2 py-1">Flame Graph</TabsTrigger>
                <TabsTrigger value="table" className="text-xs px-2 py-1">Table</TabsTrigger>
                <TabsTrigger value="turns" className="text-xs px-2 py-1">Turns</TabsTrigger>
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
                            <span>{((new Date(selectedTask.finishedAt).getTime() - new Date(selectedTask.startedAt).getTime()) / 1000).toFixed(1)}s</span>
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
              <div className="flex-1 relative min-h-0">
              <div className="absolute inset-0 overflow-auto p-4 space-y-3">
                {(() => {
                  if (outputs.length === 0) {
                    return <p className="text-sm text-muted-foreground">No output recorded.</p>;
                  }
                  return outputs.map((o: TaskOutputInfo) => (
                    <div key={o.id} className="space-y-2">
                      {o.datasetName != null && (
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {o.datasetName}{o.datasetIndex != null ? ` #${o.datasetIndex + 1}` : ''}
                        </div>
                      )}
                      {o.outputJson && (
                        <pre className="text-xs bg-muted/50 rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap">{
                          (() => { try { return JSON.stringify(JSON.parse(o.outputJson), null, 2); } catch { return o.outputJson; } })()
                        }</pre>
                      )}
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

            {/* Flame Graph view */}
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
                  <div className="px-8">
                    <div className="relative h-5 border-b border-border/50">
                      {ticks.map((tick, i) => (
                        <div key={i} className="absolute top-0 h-full flex flex-col justify-end" style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}>
                          <span className="text-[9px] text-muted-foreground/70 tabular-nums whitespace-nowrap">{tick.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Gantt rows — hierarchical like Datadog trace view */}
                  <div
                    ref={ganttRefCallback}
                    className={cn('px-8 pb-3 relative', zoom > 1 && 'cursor-grab active:cursor-grabbing')}
                    onPointerDown={handlePanStart}
                    onPointerMove={handlePanMove}
                    onPointerUp={handlePanEnd}
                  >
                    {ganttLines.map((spans, lineIdx) => (
                      <div key={lineIdx} className="relative h-16 overflow-hidden">
                        {/* Iteration highlight overlay (inside each row so overflow-hidden clips it) */}
                        {iterationTimeRange && (() => {
                          const rawLeft = toPercent(iterationTimeRange.start);
                          const rawRight = toPercent(iterationTimeRange.end);
                          const left = Math.max(0, rawLeft);
                          const right = Math.min(100, rawRight);
                          const width = right - left;
                          if (width <= 0) return null;
                          return (
                            <div
                              className="absolute top-0 bottom-0 border-x-2 border-amber-400 bg-amber-400/10 pointer-events-none z-[5]"
                              style={{ left: `${left}%`, width: `${width}%` }}
                            />
                          );
                        })()}
                        {/* Gridlines */}
                        {ticks.map((tick, i) => (
                          <div key={i} className="absolute top-0 h-full w-px bg-border/20" style={{ left: `${tick.pct}%` }} />
                        ))}
                        {/* Spans */}
                        {spans.map(span => {
                          const left = toPercent(span.start);
                          const width = toPercent(span.end) - left;
                          // Skip spans entirely outside viewport
                          if (left + width < -1 || left > 101) return null;
                          const ms = span.end - span.start;
                          const durLabel = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
                          const isSelected = (span.sessionId && selection?.type === 'session' && selection.sessionId === span.sessionId)
                            || (span.toolResult && selection?.type === 'tool' && selection.toolResult.id === span.toolResult.id)
                            || (span.category === 'agent' && selection?.type === 'session' && selection.agentName && span.label === selection.agentName);
                          const clampedLeft = Math.max(0, left);
                          const clampedWidth = Math.min(100 - clampedLeft, Math.max(0.3, left + width - clampedLeft));
                          return (
                            <div
                              key={span.id}
                              data-span
                              className={cn(
                                'absolute top-0 bottom-0 cursor-pointer transition-colors flex items-center overflow-hidden border-[0.5px]',
                                SPAN_COLORS[span.category],
                                isSelected ? 'border-2 border-black brightness-110' : 'border-white/80 hover:brightness-110',
                              )}
                              style={clampedLeft + clampedWidth >= 99.5
                                ? { right: `${100 - clampedLeft - clampedWidth}%`, width: `${clampedWidth}%`, minWidth: '3px' }
                                : { left: `${clampedLeft}%`, width: `${clampedWidth}%`, minWidth: '3px' }
                              }
                              title={`${span.label} (${durLabel})`}
                              onClick={() => {
                                if (span.category === 'agent') {
                                  // Agent spans built from events — find the agent session by name
                                  const clickSessions = isParallelIteration && selectedIteration != null ? sessions : allSessions;
                                  const agentSession = clickSessions.find(s => s.role !== 'commander' && s.agentName === span.label);
                                  if (agentSession) setSelection({ type: 'session', sessionId: agentSession.id, agentName: span.label });
                                }
                                else if (span.sessionId) setSelection({ type: 'session', sessionId: span.sessionId });
                                else if (span.toolResult) setSelection({ type: 'tool', toolResult: span.toolResult });
                              }}
                            >
                              <span className="text-[10px] text-white font-medium pl-1.5 truncate pointer-events-none whitespace-nowrap">
                                {span.label}
                              </span>
                              {clampedWidth > 12 && (
                                <span className="text-[9px] text-white/70 ml-1 pr-1.5 shrink-0 pointer-events-none">
                                  {durLabel}
                                </span>
                              )}
                              {/* Break markers (lightning bolt) for stop→resume gaps */}
                              {span.breaks?.map((breakTime, bi) => {
                                const breakPct = ((toPercent(breakTime) - clampedLeft) / clampedWidth) * 100;
                                if (breakPct < 0 || breakPct > 100) return null;
                                return (
                                  <div
                                    key={`break-${bi}`}
                                    className="absolute top-0 h-full pointer-events-none z-20 flex items-center justify-center"
                                    style={{ left: `${breakPct}%`, transform: 'translateX(-50%)' }}
                                    title="Resumed after stop"
                                  >
                                    {/* Vertical gap line */}
                                    <div className="absolute top-0 h-full w-[2px] bg-black/40" />
                                    {/* Lightning bolt */}
                                    <svg viewBox="0 0 12 20" className="w-3 h-5 relative z-10 drop-shadow-md" fill="none">
                                      <path d="M7 0L2 9h3.5L4 20l7-12H7.5L10 0z" fill="#facc15" stroke="#000" strokeWidth="0.5" />
                                    </svg>
                                  </div>
                                );
                              })}
                              {/* Reasoning tick marks */}
                              {messageTicks.get(span.id)?.map((tick, ti) => {
                                // Adjust tick position for clamped span bounds
                                const absPos = left + tick.pct / 100 * width;
                                const clampedPct = ((absPos - clampedLeft) / clampedWidth) * 100;
                                if (clampedPct < -1 || clampedPct > 101) return null;
                                return (
                                <div
                                  key={ti}
                                  className="absolute top-0 h-full w-[3px] -ml-[1px] bg-white/25 hover:bg-white/60 cursor-pointer z-10"
                                  style={{ left: `${clampedPct}%` }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const sessionId = span.sessionId ?? (() => {
                                      if (span.toolResult?.toolName === 'call_agent') {
                                        return findAgentSession(span.toolResult)?.id;
                                      }
                                      return undefined;
                                    })();
                                    if (sessionId) {
                                      setSelection({ type: 'session', sessionId });
                                      setScrollToActivityTime(tick.time);
                                    }
                                  }}
                                />
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Minimap — pinned to bottom-left of visible gantt area */}
              {zoom > 1 && (
                <div className="absolute bottom-2 left-6 bg-background/90 border rounded p-1.5 shadow-sm z-10">
                  <div className="relative" style={{ width: 160, height: ganttLines.length * 8 + 2 }}>
                    {ganttLines.map((spans, lineIdx) => (
                      <div key={lineIdx} className="relative" style={{ height: 8 }}>
                        {spans.map(span => {
                          const l = ((span.start - ganttStart) / ganttDuration) * 100;
                          const w = ((span.end - span.start) / ganttDuration) * 100;
                          return (
                            <div
                              key={span.id}
                              className={cn('absolute top-0.5 bottom-0.5', SPAN_COLORS[span.category])}
                              style={{ left: `${Math.max(0, l)}%`, width: `${Math.max(0.5, w)}%` }}
                            />
                          );
                        })}
                      </div>
                    ))}
                    <div
                      className="absolute inset-y-0 border border-foreground/70 bg-foreground/10 rounded-[1px]"
                      style={{ left: `${viewStart * 100}%`, width: `${viewWidth * 100}%` }}
                    />
                  </div>
                </div>
              )}
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
              <div className="flex-1 relative min-h-0">
              <div className="absolute inset-0 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-3 py-1.5 font-medium">Type</th>
                      <th className="px-3 py-1.5 font-medium">Name</th>
                      <th className="px-3 py-1.5 font-medium text-right">Start</th>
                      <th className="px-3 py-1.5 font-medium text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Build hierarchical table rows from ganttLines (event-driven)
                      // Line 0 = commander (depth 0), Line 1 = commander tools + agents (depth 1), Lines 2+ = agent tools (depth 2)
                      type TableRow = { id: string; parentId: string | null; depth: number; hasChildren: boolean; type: string; typeColor: string; name: string; startMs: number; durMs: number; sessionId?: string; toolResultId?: string; onClick: () => void };
                      const rows: TableRow[] = [];

                      if (ganttLines.length === 0) return null;

                      // Line 0: Commander
                      const cmdrLine = ganttLines[0];
                      const cmdrSpan = cmdrLine?.[0];
                      const cmdrRowId = cmdrSpan ? `gantt-${cmdrSpan.id}` : 'commander';
                      if (cmdrSpan) {
                        const hasChildren = (ganttLines[1]?.length ?? 0) > 0;
                        rows.push({
                          id: cmdrRowId, parentId: null, depth: 0, hasChildren,
                          type: 'Commander', typeColor: 'bg-purple-500', name: cmdrSpan.label,
                          startMs: cmdrSpan.start, durMs: cmdrSpan.end - cmdrSpan.start,
                          sessionId: cmdrSpan.sessionId,
                          onClick: () => { if (cmdrSpan.sessionId) setSelection({ type: 'session', sessionId: cmdrSpan.sessionId }); },
                        });
                      }

                      // Line 1: Commander tools + agent spans
                      const line1 = ganttLines[1] ?? [];
                      // Map agent span id → whether it has children (tool lines 2+)
                      const agentHasChildren = new Map<string, boolean>();

                      // Lines 2+: agent tool lines — figure out which agent they belong to
                      // Each agent tool line's spans share a sessionId; match to agent span by checking if agent's time range overlaps
                      type AgentToolLine = { parentAgentId: string | null; spans: GanttSpan[] };
                      const agentToolLines: AgentToolLine[] = [];
                      for (let li = 2; li < ganttLines.length; li++) {
                        const lineSpans = ganttLines[li];
                        if (lineSpans.length === 0) continue;
                        // Find which agent span in line1 contains these tool calls (by time overlap)
                        const firstTool = lineSpans[0];
                        const parentAgent = line1.find(s =>
                          s.category === 'agent' && firstTool.start >= s.start && firstTool.start <= s.end
                        );
                        const parentId = parentAgent ? `gantt-${parentAgent.id}` : null;
                        if (parentId) agentHasChildren.set(parentId, true);
                        agentToolLines.push({ parentAgentId: parentId, spans: lineSpans });
                      }

                      for (const span of [...line1].sort((a, b) => a.start - b.start)) {
                        const spanRowId = `gantt-${span.id}`;
                        const isAgent = span.category === 'agent';
                        const isDatasetNext = span.category === 'dataset_next';
                        rows.push({
                          id: spanRowId, parentId: cmdrRowId, depth: 1,
                          hasChildren: isAgent ? (agentHasChildren.get(spanRowId) ?? false) : false,
                          type: isAgent ? 'Agent' : isDatasetNext ? 'Iterator' : 'Tool',
                          typeColor: isAgent ? 'bg-blue-500' : isDatasetNext ? 'bg-amber-500' : 'bg-teal-500',
                          name: span.label, startMs: span.start, durMs: span.end - span.start,
                          sessionId: span.sessionId, toolResultId: span.toolResult?.id,
                          onClick: () => {
                            if (span.toolResult) { setSelection({ type: 'tool', toolResult: span.toolResult }); return; }
                            if (span.sessionId) { setSelection({ type: 'session', sessionId: span.sessionId }); }
                          },
                        });
                      }

                      // Lines 2+: Agent tool calls
                      for (const atl of agentToolLines) {
                        for (const span of atl.spans) {
                          rows.push({
                            id: `gantt-${span.id}`, parentId: atl.parentAgentId, depth: 2, hasChildren: false,
                            type: 'Tool', typeColor: 'bg-teal-500',
                            name: span.label, startMs: span.start, durMs: span.end - span.start,
                            toolResultId: span.toolResult?.id,
                            onClick: () => {
                              if (span.toolResult) setSelection({ type: 'tool', toolResult: span.toolResult });
                            },
                          });
                        }
                      }

                      // Build set of all ancestors that are collapsed (to hide descendants)
                      const hiddenParents = new Set<string>();
                      for (const row of rows) {
                        if (row.parentId && (collapsedRows.has(row.parentId) || hiddenParents.has(row.parentId))) {
                          hiddenParents.add(row.id);
                        }
                      }

                      return rows
                        .filter(row => !row.parentId || (!collapsedRows.has(row.parentId) && !hiddenParents.has(row.parentId)))
                        .map(row => {
                          const offsetMs = row.startMs - ganttStart;
                          const offsetLabel = offsetMs < 1000 ? `+${offsetMs}ms` : `+${(offsetMs / 1000).toFixed(1)}s`;
                          const durLabel = row.durMs <= 0 ? '<1ms' : row.durMs < 1000 ? `${row.durMs}ms` : `${(row.durMs / 1000).toFixed(1)}s`;
                          const isSelected =
                            (selection?.type === 'session' && row.sessionId === selection.sessionId)
                            || (selection?.type === 'tool' && row.toolResultId === selection.toolResult.id);
                          const isCollapsed = collapsedRows.has(row.id);

                          return (
                            <tr
                              key={row.id}
                              className={cn(
                                'border-b border-border/30 cursor-pointer hover:bg-muted/50 transition-colors',
                                isSelected && 'bg-muted',
                              )}
                              onClick={row.onClick}
                            >
                              <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + row.depth * 20}px` }}>
                                {row.hasChildren ? (
                                  <button
                                    className="inline-flex items-center justify-center w-4 h-4 mr-1 -ml-1 hover:bg-muted rounded"
                                    onClick={e => {
                                      e.stopPropagation();
                                      setCollapsedRows(prev => {
                                        const next = new Set(prev);
                                        if (next.has(row.id)) next.delete(row.id);
                                        else next.add(row.id);
                                        return next;
                                      });
                                    }}
                                  >
                                    {isCollapsed
                                      ? <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                      : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
                                  </button>
                                ) : (
                                  <span className="inline-block w-4 mr-1" />
                                )}
                                <span className={cn('inline-block w-2 h-2 rounded-full mr-1.5', row.typeColor)} />
                                {row.type}
                              </td>
                              <td className="px-3 py-1.5 font-mono">{row.name}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{offsetLabel}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{durLabel}</td>
                            </tr>
                          );
                        });
                    })()}
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
                    cacheCreationInputTokens?: number; cacheReadInputTokens?: number; cachedTokens?: number;
                    userMessages: number; assistantMessages: number; systemMessages: number;
                    payloadBytes: number; turnDurationMs: number; createdAt: string;
                  }>;

                const entities = ['all', ...Array.from(new Set(events.map(e => e.entity)))];
                const filtered = turnsEntityFilter === 'all' ? events : events.filter(e => e.entity === turnsEntityFilter);

                const totals = filtered.reduce((acc, e) => ({
                  inputTokens: acc.inputTokens + e.inputTokens,
                  outputTokens: acc.outputTokens + e.outputTokens,
                  cacheCreation: acc.cacheCreation + (e.cacheCreationInputTokens || 0),
                  cacheRead: acc.cacheRead + (e.cacheReadInputTokens || 0),
                  cached: acc.cached + (e.cachedTokens || 0),
                  payloadBytes: acc.payloadBytes + e.payloadBytes,
                  duration: acc.duration + e.turnDurationMs,
                }), { inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0, cached: 0, payloadBytes: 0, duration: 0 });

                const fmtBytes = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
                const fmtNum = (n: number) => n.toLocaleString();

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
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((e, i) => {
                            const totalInput = e.inputTokens + (e.cacheCreationInputTokens || 0) + (e.cacheReadInputTokens || 0);
                            const cacheWrite = e.cacheCreationInputTokens || 0;
                            const cacheRead = e.cacheReadInputTokens || 0;
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
                                <td className="px-2 py-1 text-right tabular-nums">{(e.turnDurationMs / 1000).toFixed(1)}s</td>
                              </tr>
                            );
                          })}
                          {/* Totals row */}
                          <tr className="border-t-2 font-medium">
                            <td className="px-2 py-1.5" colSpan={3}>Total ({filtered.length} turns)</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(totals.inputTokens + totals.cacheCreation + totals.cacheRead)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(totals.outputTokens)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {totals.cacheCreation > 0 ? fmtNum(totals.cacheCreation) : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {totals.cacheRead > 0 ? fmtNum(totals.cacheRead) : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">—</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtBytes(totals.payloadBytes)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{(totals.duration / 1000).toFixed(1)}s</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground p-4">Select a task to view sessions.</p>
        )}
      </div>

      {/* Right: detail panel */}
      {selection && (
        <div className="w-96 shrink-0 border-l overflow-y-auto">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                {selection.type === 'session' ? 'Session Detail' : 'Tool Call Detail'}
              </span>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setSelection(null)}>Close</Button>
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
                  <span>{ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}</span>
                </div>
              );
            })()}
          </div>

          {/* Session detail with tabs */}
          {selection.type === 'session' && (
            <Tabs value={detailPanelTab} onValueChange={setDetailPanelTab} className="w-full">
              <div className="px-3 pt-1">
                <TabsList variant="line" className="w-full">
                  <TabsTrigger value="activity" className="text-[10px]">Activity</TabsTrigger>
                  <TabsTrigger value="messages" className="text-[10px]">Messages</TabsTrigger>
                  <TabsTrigger value="system" className="text-[10px]">System</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="activity" className="p-3 space-y-2 mt-0">
                {sessionDetailEvents.length > 0 ? (
                  sessionDetailEvents.map((evt, i) => {
                    const refCb = (el: HTMLElement | null) => { if (el) activityRefs.current.set(i, el as HTMLDivElement); };
                    const isHighlighted = highlightedActivityIdx === i;
                    if (evt.eventType === 'agent_thinking' || evt.eventType === 'commander_reasoning') {
                      return (
                        <details key={i} ref={refCb as React.Ref<HTMLDetailsElement>} className={cn("group rounded transition-shadow", isHighlighted && "ring-2 ring-primary/50")}>
                          <summary className="text-[10px] text-violet-500 cursor-pointer font-medium">Thinking...</summary>
                          <p className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {String(evt.data.content || evt.data.text || '')}
                          </p>
                        </details>
                      );
                    }
                    if (evt.eventType === 'agent_calling_tool' || evt.eventType === 'commander_calling_tool') {
                      return (
                        <details key={i} ref={refCb as React.Ref<HTMLDetailsElement>} className={cn("border rounded p-2 transition-shadow", isHighlighted && "ring-2 ring-primary/50")}>
                          <summary className="text-[10px] font-medium cursor-pointer flex items-center gap-1">
                            <span className="text-yellow-600">Tool:</span> {String(evt.data.toolName)}
                            {toolDurations.has(i) && <span className="text-muted-foreground font-normal ml-auto">{toolDurations.get(i)}</span>}
                          </summary>
                          <div className="mt-1 space-y-1">
                            {!!(evt.data.input || evt.data.payload) && (
                              <div>
                                <span className="text-[10px] text-muted-foreground">Input:</span>
                                <pre className="text-[10px] bg-muted/50 rounded p-1 mt-0.5 overflow-x-auto max-h-24 overflow-y-auto">
                                  {String(evt.data.input || evt.data.payload)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </details>
                      );
                    }
                    if (evt.eventType === 'agent_tool_complete' || evt.eventType === 'commander_tool_complete') {
                      return (
                        <details key={i} ref={refCb as React.Ref<HTMLDetailsElement>} className={cn("border rounded p-2 transition-shadow", isHighlighted && "ring-2 ring-primary/50")}>
                          <summary className="text-[10px] font-medium cursor-pointer flex items-center gap-1">
                            <span className="text-green-600">Result:</span> {String(evt.data.toolName)}
                            {toolDurations.has(i) && <span className="text-muted-foreground font-normal ml-auto">{toolDurations.get(i)}</span>}
                          </summary>
                          {!!(evt.data.result || evt.data.output) && (
                            <pre className="text-[10px] bg-muted/50 rounded p-1 mt-1 overflow-x-auto max-h-24 overflow-y-auto">
                              {String(evt.data.result || evt.data.output)}
                            </pre>
                          )}
                        </details>
                      );
                    }
                    if (evt.eventType === 'agent_answer' || evt.eventType === 'commander_answer') {
                      return (
                        <div key={i} ref={refCb} className={cn("border-l-2 border-green-500 pl-2 rounded transition-shadow", isHighlighted && "ring-2 ring-primary/50")}>
                          <span className="text-[10px] font-medium text-green-600">Final Answer</span>
                          <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">
                            {String(evt.data.content || evt.data.text || '')}
                          </p>
                        </div>
                      );
                    }
                    if (evt.eventType === 'agent_started' || evt.eventType === 'agent_completed') {
                      return (
                        <div key={i} ref={refCb} className={cn("text-[10px] text-muted-foreground flex items-center gap-1 rounded transition-shadow", isHighlighted && "ring-2 ring-primary/50")}>
                          <span className={evt.eventType === 'agent_started' ? 'text-blue-500' : 'text-green-500'}>
                            {evt.eventType === 'agent_started' ? 'Agent started' : 'Agent completed'}
                          </span>
                          <span>({String(evt.data.agentName)})</span>
                        </div>
                      );
                    }
                    return null;
                  })
                ) : (
                  <p className="text-[10px] text-muted-foreground">No activity recorded.</p>
                )}
              </TabsContent>
              <TabsContent value="messages" className="p-3 space-y-2 mt-0">
                {sessionMessages?.messages?.length ? (
                  sessionMessages.messages.filter(msg => msg.role !== 'system').map(msg => (
                    <div key={msg.id} className="border-l-2 pl-2 mb-2" style={{ borderColor: msg.role === 'user' ? '#6366f1' : '#22c55e' }}>
                      <span className="text-[10px] font-medium">{msg.role}</span>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5">{msg.content}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-muted-foreground">No messages recorded.</p>
                )}
              </TabsContent>
              <TabsContent value="system" className="p-3 space-y-2 mt-0">
                {(() => {
                  const systemMsgs = sessionMessages?.messages?.filter(msg => msg.role === 'system') ?? [];
                  return systemMsgs.length > 0 ? (
                    systemMsgs.map((msg, i) => (
                      <details key={msg.id} open={i === 0} className="border rounded p-2">
                        <summary className="text-[10px] font-medium cursor-pointer text-muted-foreground">
                          System prompt {systemMsgs.length > 1 ? `${i + 1}/${systemMsgs.length}` : ''}
                        </summary>
                        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap mt-1 max-h-96 overflow-y-auto">
                          {msg.content}
                        </pre>
                      </details>
                    ))
                  ) : (
                    <p className="text-[10px] text-muted-foreground">No system prompts recorded.</p>
                  );
                })()}
              </TabsContent>
            </Tabs>
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
                    <p className="text-sm mt-0.5">{ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}</p>
                  </div>
                  {tr.inputParams && (
                    <div>
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Input</span>
                      <pre className="text-[10px] bg-muted/50 rounded p-2 mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {tr.inputParams}
                      </pre>
                    </div>
                  )}
                  {tr.output && (
                    <div>
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Output</span>
                      <pre className="text-[10px] bg-muted/50 rounded p-2 mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {tr.output}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Events Tab ── */

interface NormalizedEvent {
  eventType: string;
  data: Record<string, unknown>;
  timestamp: string;
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

  // SSE for real-time streaming when running
  useEffect(() => {
    if (!isRunning) {
      setLiveEvents([]);
      return;
    }

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
        queryClient.invalidateQueries({ queryKey: ['missionEvents', instanceId, missionId] });
        queryClient.invalidateQueries({ queryKey: ['missionDetail'] });
        setLiveEvents([]);
      },
      () => {},
    );

    return () => source.close();
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
    <div ref={eventLogRef} className="h-full overflow-y-auto p-3 space-y-0.5">
      {displayEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events.</p>
      ) : (
        displayEvents.map((event, i) => (
          <div key={i} className={cn('px-2 py-1 rounded text-[11px] font-mono', getEventBg(event.eventType))}>
            <span className="text-muted-foreground">[{event.eventType}]</span>{' '}
            {formatEventText(event.eventType, event.data)}
          </div>
        ))
      )}
      {isRunning && (
        <div className="text-[10px] text-blue-500 animate-pulse px-2">live...</div>
      )}
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

  // Parse task configs from stored snapshots (point-in-time, not live config)
  const parsedTasks: TaskInfo[] = useMemo(() => {
    return taskRecords.map(tr => {
      const parsed = parseTaskConfig(tr);
      return parsed ?? { name: tr.taskName };
    });
  }, [taskRecords]);

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
    return layoutGraph(tasksWithStatus);
  }, [tasksWithStatus]);

  const nodesWithSelection = useMemo(() => {
    return nodes.map(n => ({
      ...n,
      selected: activeTab === 'tasks' && n.id === selectedTask,
    }));
  }, [nodes, selectedTask, activeTab]);

  // SSE for running missions — update canvas node statuses
  useEffect(() => {
    if (!isRunning || !id || !mid) return;
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
      },
      () => {
        queryClient.invalidateQueries({ queryKey: ['missionDetail', id, mid] });
      },
      () => {},
    );

    return () => source.close();
  }, [isRunning, id, mid, queryClient]);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const taskRecord = taskRecords.find(t => t.taskName === node.id);
    if (taskRecord) {
      setSelectedTask(node.id);
      setActiveTab('tasks');
    }
  }, [taskRecords]);

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
              <TabsTrigger value="datasets">Datasets</TabsTrigger>
              <TabsTrigger value="tasks">
                Tasks
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">{taskRecords.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
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
            <TabsContent value="datasets" className="h-full m-0">
              <DatasetsTab instanceId={id!} missionId={mid!} isRunning={isRunning} />
            </TabsContent>
            <TabsContent value="tasks" className="h-full m-0">
              <TasksTab instanceId={id!} tasks={taskRecords} missionId={mid!} isRunning={isRunning} />
            </TabsContent>
            <TabsContent value="events" className="h-full m-0">
              <EventsTab instanceId={id!} missionId={mid!} isRunning={isRunning} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
