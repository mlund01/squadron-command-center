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
import { ChevronsDown, ChevronsUp, ChevronDown, Repeat, ChevronLeft, ChevronRight } from 'lucide-react';

import { getInstance, getMissionDetail, getMissionEvents, getTaskDetail, getRunDatasets, getDatasetItems, getChatMessages } from '@/api/client';
import { subscribeMissionEvents } from '@/api/sse';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { StatusBadge, formatTime, formatDuration } from '@/lib/mission-utils';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { ZoomControls } from '@/components/zoom-controls';
import type { TaskInfo, MissionEvent, MissionTaskRecord, ToolResultDTO } from '@/api/types';

const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;

/* ── Status-aware task node for run view ── */

function RunTaskNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const task = data as unknown as TaskInfo & { runStatus?: string; runSummary?: string; runError?: string };
  const isIterated = !!task.iterator;
  const status = task.runStatus ?? 'pending';

  const borderColor = status === 'completed' ? 'border-green-500'
    : status === 'running' ? 'border-blue-500'
    : status === 'failed' ? 'border-red-500'
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
        {status === 'completed' && task.runSummary && (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.runSummary}</p>
        )}
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
]);

function getEventBg(eventType: string): string {
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
    case 'task_completed': return `Task "${d.taskName}" completed${d.summary ? `: ${d.summary}` : ''}`;
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
    case 'summary_aggregation': return `Aggregating ${d.summaryCount} summaries for "${d.taskName}"`;
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

function DatasetsTab({ instanceId, missionId }: { instanceId: string; missionId: string }) {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: datasetsData } = useQuery({
    queryKey: ['runDatasets', instanceId, missionId],
    queryFn: () => getRunDatasets(instanceId, missionId),
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
  | { type: 'session'; sessionId: string }
  | { type: 'tool'; toolResult: ToolResultDTO }
  | null;

interface GanttSpan {
  id: string;
  label: string;
  start: number;
  end: number;
  category: 'commander' | 'agent' | 'tool';
  sessionId?: string;
  toolResult?: ToolResultDTO;
}

const SPAN_COLORS: Record<GanttSpan['category'], string> = {
  commander: 'bg-purple-500',
  agent: 'bg-blue-500',
  tool: 'bg-teal-500',
};

function TasksTab({ instanceId, tasks, missionId }: { instanceId: string; tasks: MissionTaskRecord[]; missionId: string }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);
  const [selection, setSelection] = useState<PanelSelection>(null);
  const [traceView, setTraceView] = useState<'detail' | 'flamegraph' | 'table'>('detail');
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());

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
  });

  // Events for gantt + detail
  const { data: missionEventsData } = useQuery({
    queryKey: ['missionEvents', instanceId, missionId],
    queryFn: () => getMissionEvents(instanceId, missionId),
  });

  // Messages for selected session
  const { data: sessionMessages } = useQuery({
    queryKey: ['chatMessages', instanceId, selectedSessionId],
    queryFn: () => getChatMessages(instanceId, selectedSessionId!),
    enabled: !!selectedSessionId,
  });

  const allSessions = taskDetail?.sessions ?? [];
  const selectedTask = tasks.find(t => t.id === selectedTaskId);

  // Detect iterations
  const iterations = useMemo(() => {
    const indices = new Set<number>();
    for (const s of allSessions) {
      if (s.iterationIndex != null) indices.add(s.iterationIndex);
    }
    return Array.from(indices).sort((a, b) => a - b);
  }, [allSessions]);

  const isIterated = iterations.length > 0;

  useEffect(() => {
    if (isIterated) {
      setSelectedIteration(iterations[0] ?? null);
    } else {
      setSelectedIteration(null);
    }
  }, [selectedTaskId, isIterated, iterations]);

  const sessions = useMemo(() => {
    if (!isIterated || selectedIteration == null) return allSessions;
    return allSessions.filter(s => s.iterationIndex === selectedIteration);
  }, [allSessions, isIterated, selectedIteration]);

  // Gantt time range from visible sessions
  const { ganttStart, ganttEnd, ganttDuration } = useMemo(() => {
    if (sessions.length === 0) return { ganttStart: 0, ganttEnd: 0, ganttDuration: 1 };
    let earliest = Infinity;
    let latest = 0;
    for (const s of sessions) {
      const start = new Date(s.startedAt).getTime();
      const end = s.finishedAt ? new Date(s.finishedAt).getTime() : Date.now();
      if (start < earliest) earliest = start;
      if (end > latest) latest = end;
    }
    return { ganttStart: earliest, ganttEnd: latest, ganttDuration: Math.max(latest - earliest, 1) };
  }, [sessions]);

  // Parse events for this task within current gantt range
  const taskEvents = useMemo(() => {
    if (!missionEventsData?.events || !selectedTask) return [];
    return missionEventsData.events
      .map(e => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(e.dataJson || '{}'); } catch { /* skip */ }
        return { ...e, data, time: new Date(e.createdAt).getTime() };
      })
      .filter(e => {
        const evtTaskName = String(e.data.taskName || '');
        // For iterated tasks, event taskName is "write_story[0]", selectedTask is "write_story"
        if (isIterated && selectedIteration != null) {
          return evtTaskName === `${selectedTask.taskName}[${selectedIteration}]`
            || (evtTaskName === selectedTask.taskName && e.time >= ganttStart - 1000 && e.time <= ganttEnd + 1000);
        }
        return evtTaskName === selectedTask.taskName;
      });
  }, [missionEventsData, selectedTask, isIterated, selectedIteration, ganttStart, ganttEnd]);

  // Tool results from API (replaces event-based tool call reconstruction)
  const toolResults = taskDetail?.toolResults ?? [];

  // Build a session ID → session lookup for agent name resolution
  const sessionMap = useMemo(() => {
    const map = new Map<string, typeof allSessions[0]>();
    for (const s of allSessions) map.set(s.id, s);
    return map;
  }, [allSessions]);

  // For call_agent tool results, find the agent session that ran during that window
  const findAgentSession = useCallback((tr: ToolResultDTO) => {
    const trStart = new Date(tr.startedAt).getTime();
    const trEnd = new Date(tr.finishedAt).getTime();
    return sessions.find(s => s.role !== 'commander' && new Date(s.startedAt).getTime() >= trStart - 1000 && new Date(s.startedAt).getTime() <= trEnd);
  }, [sessions]);

  // Gantt spans built from tool results
  // Line 1: Commander session (continuous bar)
  // Line 2: Commander's tool calls (call_agent shown as agent spans, others as tool spans)
  // Line 3+: Agent tool calls (grouped by agent session)
  const ganttLines = useMemo((): GanttSpan[][] => {
    const lines: GanttSpan[][] = [];

    // Line 1: Commander session
    const cmdr = sessions.find(s => s.role === 'commander');
    if (cmdr) {
      lines.push([{
        id: cmdr.id, label: 'commander',
        start: new Date(cmdr.startedAt).getTime(),
        end: cmdr.finishedAt ? new Date(cmdr.finishedAt).getTime() : Date.now(),
        category: 'commander', sessionId: cmdr.id,
      }]);
    }

    // Line 2: Commander's tool calls from tool results
    const cmdrResults = toolResults.filter(tr => cmdr && tr.sessionId === cmdr.id);
    if (cmdrResults.length > 0) {
      const line2: GanttSpan[] = cmdrResults.map(tr => {
        // call_agent: show as agent-colored span with agent name
        if (tr.toolName === 'call_agent') {
          let agentName = 'agent';
          try {
            const parsed = JSON.parse(tr.inputParams || '{}');
            if (parsed.name) agentName = parsed.name;
          } catch { /* use default */ }
          return {
            id: tr.id, label: agentName,
            start: new Date(tr.startedAt).getTime(),
            end: new Date(tr.finishedAt).getTime(),
            category: 'agent' as const, toolResult: tr,
          };
        }
        return {
          id: tr.id, label: tr.toolName,
          start: new Date(tr.startedAt).getTime(),
          end: new Date(tr.finishedAt).getTime(),
          category: 'tool' as const, toolResult: tr,
        };
      });
      line2.sort((a, b) => a.start - b.start);
      lines.push(line2);
    }

    // Lines 3+: Agent tool calls, one line per agent session
    const agentSessions = sessions.filter(s => s.role !== 'commander');
    for (const agentSession of agentSessions) {
      const agentResults = toolResults.filter(tr => tr.sessionId === agentSession.id);
      if (agentResults.length > 0) {
        const line: GanttSpan[] = agentResults.map(tr => ({
          id: tr.id, label: tr.toolName,
          start: new Date(tr.startedAt).getTime(),
          end: new Date(tr.finishedAt).getTime(),
          category: 'tool' as const, toolResult: tr,
        }));
        line.sort((a, b) => a.start - b.start);
        lines.push(line);
      }
    }

    return lines;
  }, [sessions, toolResults]);

  // Session detail events (filter by time range + role matching)
  const sessionDetailEvents = useMemo(() => {
    if (!selectedSessionId) return [];
    const session = allSessions.find(s => s.id === selectedSessionId);
    if (!session) return [];
    const sStart = new Date(session.startedAt).getTime();
    const sEnd = session.finishedAt ? new Date(session.finishedAt).getTime() + 1000 : Date.now();
    const isCmd = session.role === 'commander';

    // For iterated tasks, match the iteration-specific taskName (e.g. "write_story[0]")
    const iterTaskName = isIterated && selectedIteration != null && selectedTask
      ? `${selectedTask.taskName}[${selectedIteration}]`
      : null;

    return taskEvents
      .filter(e => {
        // Commander sessions also receive iteration_* events in iterated tasks
        const matchesRole = isCmd
          ? (e.eventType.startsWith('commander_') || e.eventType.startsWith('iteration_'))
          : (e.eventType.startsWith('agent_'));
        if (!matchesRole) return false;
        if (!isCmd && e.data.agentName !== session.agentName) return false;
        // For iterated tasks, filter events to the selected iteration
        if (isIterated && selectedIteration != null) {
          if (e.eventType.startsWith('iteration_')) {
            // iteration_* events have a separate index field
            if (e.data.index !== selectedIteration) return false;
          } else {
            // commander_*/agent_* events encode iteration in taskName (e.g. "write_story[0]")
            if (iterTaskName && String(e.data.taskName || '') !== iterTaskName) return false;
          }
        }
        return e.time >= sStart && e.time <= sEnd;
      })
      .map(e => ({ eventType: e.eventType, data: e.data, timestamp: e.createdAt }));
  }, [selectedSessionId, allSessions, taskEvents, isIterated, selectedIteration, selectedTask]);

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

  // Zoom/pan state: zoom=1 means full view, panOffset=0..1 is left edge fraction
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<{ startX: number; startOffset: number } | null>(null);

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

  // Native wheel handler (non-passive) for pinch-to-zoom
  useEffect(() => {
    const el = ganttContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
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
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [sessions.length, selectedTaskId]); // re-attach when gantt mounts

  // Pan via mouse drag
  const handlePanStart = useCallback((e: React.PointerEvent) => {
    if (zoom <= 1) return;
    // Only middle-click or when zoomed and dragging on empty area
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-span]')) return; // don't pan when clicking spans
    e.preventDefault();
    panDragRef.current = { startX: e.clientX, startOffset: panOffset };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [zoom, panOffset]);

  const handlePanMove = useCallback((e: React.PointerEvent) => {
    if (!panDragRef.current || !ganttContainerRef.current) return;
    const rect = ganttContainerRef.current.getBoundingClientRect();
    const dx = e.clientX - panDragRef.current.startX;
    const fracDx = dx / rect.width * viewWidth;
    let newOffset = panDragRef.current.startOffset - fracDx;
    newOffset = Math.max(0, Math.min(1 - viewWidth, newOffset));
    setPanOffset(newOffset);
  }, [viewWidth]);

  const handlePanEnd = useCallback(() => {
    panDragRef.current = null;
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

  const hasContent = sessions.length > 0;

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
          <Tabs value={traceView} onValueChange={v => setTraceView(v as 'detail' | 'flamegraph' | 'table')} className="flex flex-col h-full gap-0">
            {/* Header: tabs + iteration selector */}
            <div className="flex items-center gap-3 px-4 pt-2 pb-1 border-b border-border/50 shrink-0">
              <TabsList variant="line" className="h-7">
                <TabsTrigger value="detail" className="text-xs px-2 py-1">Detail</TabsTrigger>
                <TabsTrigger value="flamegraph" className="text-xs px-2 py-1">Flame Graph</TabsTrigger>
                <TabsTrigger value="table" className="text-xs px-2 py-1">Table</TabsTrigger>
              </TabsList>
              {isIterated && traceView !== 'detail' && (
                <select
                  value={selectedIteration ?? ''}
                  onChange={e => {
                    setSelectedIteration(Number(e.target.value));
                    setSelection(null);
                  }}
                  className="text-xs border rounded px-2 py-1 bg-background"
                >
                  {iterations.map(idx => (
                    <option key={idx} value={idx}>Iteration {idx + 1}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Detail view */}
            <TabsContent value="detail" className="flex-1 relative min-h-0 m-0">
              <div className="absolute inset-0 overflow-auto p-4 space-y-4">
                {(() => {
                  const taskConfig = parseTaskConfig(selectedTask);
                  const events = missionEventsData?.events ?? [];

                  // Get resolved objective from events
                  let resolvedObjective: string | undefined;
                  if (isIterated) {
                    // For iterated tasks, find matching iteration_started event
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
                    // Non-iterated: find task_started event
                    const taskEvent = events.find(e => {
                      if (e.eventType !== 'task_started') return false;
                      try { return JSON.parse(e.dataJson).taskName === selectedTask.taskName; } catch { return false; }
                    });
                    if (taskEvent) {
                      try { resolvedObjective = JSON.parse(taskEvent.dataJson).objective; } catch {}
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

                      {/* Summary */}
                      {selectedTask.summary && (
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Summary</div>
                          <div className="text-xs whitespace-pre-wrap bg-muted/50 rounded px-3 py-2">{selectedTask.summary}</div>
                        </div>
                      )}

                      {/* Error */}
                      {selectedTask.error && (
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Error</div>
                          <div className="text-xs whitespace-pre-wrap bg-red-500/10 text-red-500 rounded px-3 py-2">{selectedTask.error}</div>
                        </div>
                      )}

                      {/* Iterated objectives list */}
                      {isIterated && (
                        <div>
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">All Iteration Objectives</div>
                          <div className="space-y-1">
                            {events
                              .filter(e => e.eventType === 'iteration_started')
                              .filter(e => { try { return JSON.parse(e.dataJson).taskName === selectedTask.taskName; } catch { return false; } })
                              .sort((a, b) => { try { return JSON.parse(a.dataJson).index - JSON.parse(b.dataJson).index; } catch { return 0; } })
                              .map((e, i) => {
                                try {
                                  const d = JSON.parse(e.dataJson);
                                  return (
                                    <div key={i} className="text-xs bg-muted/30 rounded px-3 py-1.5">
                                      <span className="text-muted-foreground font-medium">#{d.index + 1}:</span>{' '}
                                      <span className="whitespace-pre-wrap">{d.objective}</span>
                                    </div>
                                  );
                                } catch { return null; }
                              })}
                            {events.filter(e => e.eventType === 'iteration_started').filter(e => { try { return JSON.parse(e.dataJson).taskName === selectedTask.taskName; } catch { return false; } }).length === 0 && (
                              <p className="text-xs text-muted-foreground">No iterations started yet.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </TabsContent>

            {/* Flame Graph view */}
            <TabsContent value="flamegraph" className="flex-1 relative min-h-0 m-0">
              {!hasContent ? (
                <p className="text-sm text-muted-foreground p-4">
                  {allSessions.length > 0 && sessions.length === 0
                    ? 'No sessions for this iteration.'
                    : 'No sessions recorded for this task.'}
                </p>
              ) : (<>
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
                    ref={ganttContainerRef}
                    className={cn('px-8 pb-3 relative', zoom > 1 && 'cursor-grab active:cursor-grabbing')}
                    onPointerDown={handlePanStart}
                    onPointerMove={handlePanMove}
                    onPointerUp={handlePanEnd}
                  >
                    {ganttLines.map((spans, lineIdx) => (
                      <div key={lineIdx} className="relative h-8 overflow-hidden">
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
                            || (span.toolResult?.toolName === 'call_agent' && selection?.type === 'session' && (() => {
                              const as = findAgentSession(span.toolResult!);
                              return as && as.id === selection.sessionId;
                            })());
                          const clampedLeft = Math.max(0, left);
                          const clampedWidth = Math.min(100 - clampedLeft, Math.max(0.3, left + width - clampedLeft));
                          return (
                            <div
                              key={span.id}
                              data-span
                              className={cn(
                                'absolute inset-0 cursor-pointer transition-colors flex items-center overflow-hidden border-[0.5px]',
                                SPAN_COLORS[span.category],
                                isSelected ? 'border-2 border-black brightness-110' : 'border-white/80 hover:brightness-110',
                              )}
                              style={{ left: `${clampedLeft}%`, width: `${clampedWidth}%` }}
                              title={`${span.label} (${durLabel})`}
                              onClick={() => {
                                if (span.sessionId) setSelection({ type: 'session', sessionId: span.sessionId });
                                else if (span.toolResult && span.toolResult.toolName === 'call_agent') {
                                  const agentSession = findAgentSession(span.toolResult);
                                  if (agentSession) setSelection({ type: 'session', sessionId: agentSession.id });
                                  else setSelection({ type: 'tool', toolResult: span.toolResult });
                                }
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
              </>)}
            </TabsContent>

            {/* Table view */}
            <TabsContent value="table" className="flex-1 relative min-h-0 m-0">
              {!hasContent ? (
                <p className="text-sm text-muted-foreground p-4">
                  {allSessions.length > 0 && sessions.length === 0
                    ? 'No sessions for this iteration.'
                    : 'No sessions recorded for this task.'}
                </p>
              ) : (
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
                      // Build hierarchical rows: commander → its tools/agent calls → agent's tools
                      type TableRow = { id: string; parentId: string | null; depth: number; hasChildren: boolean; type: string; typeColor: string; name: string; startMs: number; durMs: number; agentSessionId?: string; onClick: () => void };
                      const rows: TableRow[] = [];

                      const cmdr = sessions.find(s => s.role === 'commander');
                      if (cmdr) {
                        const cmdrRowId = `session-${cmdr.id}`;
                        const startMs = new Date(cmdr.startedAt).getTime();
                        const endMs = cmdr.finishedAt ? new Date(cmdr.finishedAt).getTime() : Date.now();

                        // Commander's tool results, sorted by time
                        const cmdrResults = toolResults
                          .filter(tr => tr.sessionId === cmdr.id)
                          .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

                        rows.push({
                          id: cmdrRowId, parentId: null, depth: 0, hasChildren: cmdrResults.length > 0,
                          type: 'Commander', typeColor: 'bg-purple-500', name: 'commander',
                          startMs, durMs: endMs - startMs,
                          onClick: () => setSelection({ type: 'session', sessionId: cmdr.id }),
                        });

                        for (const tr of cmdrResults) {
                          const isAgentCall = tr.toolName === 'call_agent';
                          const trRowId = `tr-${tr.id}`;
                          let name = tr.toolName;
                          if (isAgentCall) {
                            try {
                              const parsed = JSON.parse(tr.inputParams || '{}');
                              if (parsed.name) name = parsed.name;
                            } catch { /* use toolName */ }
                          }

                          const trStart = new Date(tr.startedAt).getTime();
                          const trEnd = new Date(tr.finishedAt).getTime();

                          // Collect agent children first to know if this row has children
                          let agentResults: typeof toolResults = [];
                          if (isAgentCall) {
                            const agentSessions = sessions.filter(s => s.role !== 'commander');
                            agentResults = toolResults
                              .filter(atr => {
                                if (atr.sessionId === cmdr.id) return false;
                                const aStart = new Date(atr.startedAt).getTime();
                                return agentSessions.some(as => as.id === atr.sessionId)
                                  && aStart >= trStart && aStart <= trEnd;
                              })
                              .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
                          }

                          const resolvedAgentSession = isAgentCall ? findAgentSession(tr) : undefined;
                          rows.push({
                            id: trRowId, parentId: cmdrRowId, depth: 1, hasChildren: agentResults.length > 0,
                            type: isAgentCall ? 'Agent' : 'Tool',
                            typeColor: isAgentCall ? 'bg-blue-500' : 'bg-teal-500',
                            name, startMs: trStart, durMs: trEnd - trStart,
                            agentSessionId: resolvedAgentSession?.id,
                            onClick: () => {
                              if (resolvedAgentSession) { setSelection({ type: 'session', sessionId: resolvedAgentSession.id }); return; }
                              setSelection({ type: 'tool', toolResult: tr });
                            },
                          });

                          for (const atr of agentResults) {
                            const aStart = new Date(atr.startedAt).getTime();
                            const aEnd = new Date(atr.finishedAt).getTime();
                            rows.push({
                              id: `tr-${atr.id}`, parentId: trRowId, depth: 2, hasChildren: false,
                              type: 'Tool', typeColor: 'bg-teal-500',
                              name: atr.toolName, startMs: aStart, durMs: aEnd - aStart,
                              onClick: () => setSelection({ type: 'tool', toolResult: atr }),
                            });
                          }
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
                            (row.id.startsWith('session-') && selection?.type === 'session' && selection.sessionId === row.id.slice(8))
                            || (row.id.startsWith('tr-') && selection?.type === 'tool' && selection.toolResult.id === row.id.slice(3))
                            || (row.agentSessionId != null && selection?.type === 'session' && selection.sessionId === row.agentSessionId);
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
              )}
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
            <Tabs defaultValue="activity" className="w-full">
              <div className="px-3 pt-1">
                <TabsList variant="line" className="w-full">
                  <TabsTrigger value="activity" className="text-[10px]">Activity</TabsTrigger>
                  <TabsTrigger value="messages" className="text-[10px]">Messages</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="activity" className="p-3 space-y-2 mt-0">
                {sessionDetailEvents.length > 0 ? (
                  sessionDetailEvents.map((evt, i) => {
                    if (evt.eventType === 'agent_thinking' || evt.eventType === 'commander_reasoning' || evt.eventType === 'iteration_reasoning') {
                      return (
                        <details key={i} className="group">
                          <summary className="text-[10px] text-violet-500 cursor-pointer font-medium">Thinking...</summary>
                          <p className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {String(evt.data.content || evt.data.text || '')}
                          </p>
                        </details>
                      );
                    }
                    if (evt.eventType === 'agent_calling_tool' || evt.eventType === 'commander_calling_tool') {
                      return (
                        <details key={i} className="border rounded p-2">
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
                        <details key={i} className="border rounded p-2">
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
                    if (evt.eventType === 'agent_answer' || evt.eventType === 'commander_answer' || evt.eventType === 'iteration_answer') {
                      return (
                        <div key={i} className="border-l-2 border-green-500 pl-2">
                          <span className="text-[10px] font-medium text-green-600">Final Answer</span>
                          <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">
                            {String(evt.data.content || evt.data.text || '')}
                          </p>
                        </div>
                      );
                    }
                    if (evt.eventType === 'agent_started' || evt.eventType === 'agent_completed') {
                      return (
                        <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
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
                  sessionMessages.messages.map(msg => (
                    <div key={msg.id} className="border-l-2 pl-2 mb-2" style={{ borderColor: msg.role === 'user' ? '#6366f1' : '#22c55e' }}>
                      <span className="text-[10px] font-medium">{msg.role}</span>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5">{msg.content}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-muted-foreground">No messages recorded.</p>
                )}
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

  const { data: historyEventsData } = useQuery({
    queryKey: ['missionEvents', instanceId, missionId],
    queryFn: () => getMissionEvents(instanceId, missionId),
    enabled: !isRunning,
  });

  // SSE for running missions
  useEffect(() => {
    if (!isRunning) return;
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
        queryClient.invalidateQueries({ queryKey: ['missionEvents', instanceId, missionId] });
      },
      () => {},
    );

    return () => source.close();
  }, [isRunning, instanceId, missionId, queryClient]);

  // Auto-scroll
  useEffect(() => {
    if (eventLogRef.current) {
      eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
    }
  }, [liveEvents, historyEventsData]);

  const displayEvents: NormalizedEvent[] = useMemo(() => {
    if (isRunning) return liveEvents;
    if (!historyEventsData?.events) return [];
    return historyEventsData.events
      .filter(e => !VERBOSE_EVENTS.has(e.eventType))
      .map(e => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(e.dataJson || '{}'); } catch { /* skip */ }
        return { eventType: e.eventType, data, timestamp: e.createdAt };
      });
  }, [isRunning, liveEvents, historyEventsData]);

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
        <div className="text-[10px] text-blue-500 animate-pulse px-2">streaming...</div>
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
  });

  const mission = detail?.mission;
  const taskRecords = detail?.tasks ?? [];
  const isRunning = mission?.status === 'running';

  // Parse task configs from stored snapshots (point-in-time, not live config)
  const parsedTasks: TaskInfo[] = useMemo(() => {
    return taskRecords.map(tr => {
      const parsed = parseTaskConfig(tr);
      return parsed ?? { name: tr.taskName };
    });
  }, [taskRecords]);

  // Build status map from task records + live statuses
  const statusMap = useMemo(() => {
    const map: Record<string, { status: string; summary?: string; error?: string }> = {};
    for (const tr of taskRecords) {
      map[tr.taskName] = { status: tr.status, summary: tr.summary ?? undefined, error: tr.error ?? undefined };
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
      runSummary: statusMap[t.name]?.summary,
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
              <DatasetsTab instanceId={id!} missionId={mid!} />
            </TabsContent>
            <TabsContent value="tasks" className="h-full m-0">
              <TasksTab instanceId={id!} tasks={taskRecords} missionId={mid!} />
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
