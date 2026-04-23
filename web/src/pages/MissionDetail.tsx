import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { ChevronsDown, ChevronsUp, Repeat, Clock, Webhook, ChevronLeft, ChevronRight, Copy, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';

import { getInstance, getMissionHistory, runMission, getServerInfo } from '@/api/client';
import { useTheme } from '@/components/ThemeProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { ZoomControls } from '@/components/zoom-controls';
import { NodeChip } from '@/components/node-chip';
import { RunMissionDialog } from '@/components/RunMissionDialog';
import { StatusBadge, formatTime, formatDuration } from '@/lib/mission-utils';
import type { TaskInfo, AgentInfo, DatasetInfo, MissionInfo, MissionRecordInfo, ScheduleInfo, TriggerInfo } from '@/api/types';
import { RouterEdge } from '@/components/RouterEdge';

const RUNS_PAGE_SIZE = 10;

const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;

function TaskNode({ data, selected }: { data: TaskInfo & { hasIncoming?: boolean; hasOutgoing?: boolean }; selected?: boolean }) {
  const isIterated = !!data.iterator;
  return (
    <div className="relative">
      {/* Stacked-card effect for iterated tasks */}
      {isIterated && (
        <>
          <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-lg border-2 border-border bg-card shadow-sm" />
          <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg border-2 border-border bg-card" />
        </>
      )}
      <div className={cn(
        'relative rounded-lg p-3 cursor-pointer w-[260px] transition-all',
        selected
          ? `bg-muted border-2 border-foreground ${isIterated ? '' : 'shadow-sm'}`
          : `bg-card border-2 border-border ${isIterated ? '' : 'shadow-sm'}`,
      )}>
        {data.hasIncoming !== false && <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{data.name}</span>
            {data.agent && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {data.agent}
              </Badge>
            )}
            {data.commander && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                cmdr
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isIterated && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Repeat className="h-3 w-3" />
                <span>iterated</span>
              </div>
            )}
            <NodeChip variant="task" />
          </div>
        </div>
        {data.objective && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {data.objective}
          </p>
        )}
        {data.hasOutgoing !== false && <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2 !h-2" />}
      </div>
    </div>
  );
}

function MissionRouteNode({ data }: { data: Record<string, unknown> }) {
  const missionName = data.missionName as string;
  return (
    <div className="relative">
      <div className="relative rounded-lg p-3 cursor-default w-[260px] bg-card border-2 border-border shadow-sm">
        <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-sm">{missionName}</span>
          <NodeChip variant="mission" className="shrink-0" />
        </div>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  task: TaskNode,
  missionRoute: MissionRouteNode,
};

const edgeTypes: EdgeTypes = {
  router: RouterEdge,
};

function layoutGraph(tasks: TaskInfo[], nodeWidth = NODE_WIDTH, nodeHeight = NODE_HEIGHT, isDefcon5 = false): { nodes: Node[]; edges: Edge[] } {
  const routerEdgeColor = isDefcon5 ? '#4a7050' : '#9ca3af';
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });

  for (const task of tasks) {
    g.setNode(task.name, { width: nodeWidth, height: nodeHeight });
  }

  const edges: Edge[] = [];
  for (const task of tasks) {
    // Dependency edges (solid)
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        const edgeId = `${dep}->${task.name}`;
        g.setEdge(dep, task.name);
        edges.push({
          id: edgeId,
          source: dep,
          target: task.name,
          animated: false,
        });
      }
    }
    // Router edges (dotted, with hover tooltip) — skip mission targets (handled below)
    if (task.router) {
      for (const route of task.router.routes) {
        if (route.isMission) continue; // mission route nodes added separately
        g.setEdge(task.name, route.target);
        edges.push({
          id: `${task.name}->route:${route.target}`,
          source: task.name,
          target: route.target,
          type: 'router',
          animated: false,
          data: { condition: route.condition },
          style: { strokeDasharray: '5,5', stroke: routerEdgeColor },
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
          animated: false,
        });
      }
    }
  }

  // Add mission route nodes (virtual nodes for cross-mission router targets)
  const missionNodeIds: { id: string; missionName: string }[] = [];
  const taskNameSet = new Set(tasks.map(t => t.name));
  for (const task of tasks) {
    if (task.router) {
      for (const route of task.router.routes) {
        if (route.isMission && !taskNameSet.has(route.target)) {
          const missionNodeId = `mission:${route.target}`;
          missionNodeIds.push({ id: missionNodeId, missionName: route.target });
          g.setNode(missionNodeId, { width: nodeWidth, height: nodeHeight });
          g.setEdge(task.name, missionNodeId);
          edges.push({
            id: `${task.name}->mission:${route.target}`,
            source: task.name,
            target: missionNodeId,
            type: 'router',
            animated: false,
            data: { condition: route.condition },
            style: { strokeDasharray: '5,5', stroke: routerEdgeColor },
          });
        }
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
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
      data: { ...task, hasIncoming: hasIncoming.has(task.name), hasOutgoing: hasOutgoing.has(task.name) } as unknown as Record<string, unknown>,
    };
  });

  // Add mission route node positions
  for (const mn of missionNodeIds) {
    const pos = g.node(mn.id);
    nodes.push({
      id: mn.id,
      type: 'missionRoute',
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
      selectable: false,
      draggable: false,
      data: { missionName: mn.missionName },
    });
  }

  return { nodes, edges };
}

/* ── Tab content components ── */

function GeneralTabContent({
  mission,
  agents,
}: {
  mission: MissionInfo;
  agents: AgentInfo[];
}) {
  return (
    <div className="overflow-y-auto p-4 h-full">
      <div className="space-y-4 max-w-2xl">
        {mission.commander && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Commander
            </span>
            <p className="text-sm mt-1">{mission.commander}</p>
          </div>
        )}

        {mission.description && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Directive
            </span>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-1">
              {mission.description}
            </p>
          </div>
        )}

        {agents.length > 0 && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Agents
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {agents.map((a) => (
                <Badge key={a.name} variant="secondary" className="text-xs px-2 py-0.5">
                  {a.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Inputs shown in dedicated Inputs tab */}
      </div>
    </div>
  );
}

function DatasetsTabContent({
  datasets,
  selectedDataset,
  onSelectDataset,
}: {
  datasets: DatasetInfo[];
  selectedDataset: DatasetInfo | null;
  onSelectDataset: (ds: DatasetInfo) => void;
}) {
  if (!datasets.length) {
    return <p className="text-sm text-muted-foreground p-4">No datasets defined for this mission.</p>;
  }
  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {datasets.map((ds) => (
            <button
              key={ds.name}
              onClick={() => onSelectDataset(ds)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedDataset?.name === ds.name && 'bg-muted font-medium',
              )}
            >
              <span className="truncate">{ds.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {selectedDataset ? (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">{selectedDataset.name}</h3>

            {selectedDataset.description && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </span>
                <p className="text-xs text-muted-foreground mt-1">{selectedDataset.description}</p>
              </div>
            )}

            {selectedDataset.bindTo && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Bound To
                </span>
                <div className="mt-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {selectedDataset.bindTo}
                  </Badge>
                </div>
              </div>
            )}

            {selectedDataset.schema && selectedDataset.schema.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Schema
                </span>
                <div className="mt-1 space-y-1">
                  {selectedDataset.schema.map((f) => (
                    <div key={f.name} className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{f.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{f.type}</Badge>
                      {f.required && <span className="text-destructive text-xs">required</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TasksTabContent({
  tasks,
  selectedTask,
  onSelectTask,
}: {
  tasks: TaskInfo[];
  selectedTask: TaskInfo | null;
  onSelectTask: (task: TaskInfo) => void;
}) {
  return (
    <div className="flex h-full">
      {/* Left: task list */}
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        {/* Inputs shown in General tab only */}
        <div className="py-1">
          {tasks.map((task) => (
            <button
              key={task.name}
              onClick={() => onSelectTask(task)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedTask?.name === task.name && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{task.name}</span>
                {task.agent && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                    {task.agent}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: task detail */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedTask ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{selectedTask.name}</h3>
              {selectedTask.agent && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {selectedTask.agent}
                </Badge>
              )}
              {selectedTask.commander && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  cmdr
                </Badge>
              )}
            </div>

            {/* Properties grid */}
            <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs max-w-md">
              {selectedTask.dependsOn && selectedTask.dependsOn.length > 0 && (
                <>
                  <span className="text-muted-foreground">Dependencies</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedTask.dependsOn.map((dep) => (
                      <Badge key={dep} variant="outline" className="text-[10px] px-1.5 py-0">
                        {dep}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
              {selectedTask.iterator && (
                <>
                  <span className="text-muted-foreground">Dataset</span>
                  <span>{selectedTask.iterator.dataset}</span>
                  <span className="text-muted-foreground">Mode</span>
                  <span>{selectedTask.iterator.parallel ? 'Parallel' : 'Sequential'}</span>
                  {selectedTask.iterator.parallel && selectedTask.iterator.concurrencyLimit ? (
                    <>
                      <span className="text-muted-foreground">Concurrency</span>
                      <span>{selectedTask.iterator.concurrencyLimit}</span>
                    </>
                  ) : null}
                  {selectedTask.iterator.maxRetries ? (
                    <>
                      <span className="text-muted-foreground">Retries</span>
                      <span>{selectedTask.iterator.maxRetries}</span>
                    </>
                  ) : null}
                </>
              )}
            </div>

            {selectedTask.objective && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Objective
                </span>
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed">
                  {selectedTask.objective}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentsTabContent({
  agents,
  selectedAgent,
  onSelectAgent,
}: {
  agents: AgentInfo[];
  selectedAgent: AgentInfo | null;
  onSelectAgent: (agent: AgentInfo) => void;
}) {
  if (!agents.length) {
    return <p className="text-sm text-muted-foreground p-4">No agents assigned to this mission.</p>;
  }
  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {agents.map((agent) => (
            <button
              key={agent.name}
              onClick={() => onSelectAgent(agent)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedAgent?.name === agent.name && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{agent.name}</span>
                {agent.mission && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                    scoped
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {selectedAgent ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{selectedAgent.name}</h3>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {selectedAgent.model}
              </Badge>
              {selectedAgent.mission ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {selectedAgent.mission}
                </Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground">Global</span>
              )}
            </div>

            {selectedAgent.role && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Role
                </span>
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed">
                  {selectedAgent.role}
                </p>
              </div>
            )}

            {selectedAgent.tools && selectedAgent.tools.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Tools
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedAgent.tools.map((tool) => (
                    <Badge key={tool} variant="outline" className="text-[10px] px-1.5 py-0">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RunsTabContent({
  runs,
  page,
  onPageChange,
  onSelectRun,
}: {
  runs: MissionRecordInfo[];
  page: number;
  onPageChange: (page: number) => void;
  onSelectRun: (runId: string) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(runs.length / RUNS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * RUNS_PAGE_SIZE;
  const pageRuns = runs.slice(start, start + RUNS_PAGE_SIZE);

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">No runs yet for this mission.</p>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="w-32 text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRuns.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => onSelectRun(r.id)}
              >
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatTime(r.startedAt)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums text-right">
                  {r.finishedAt ? formatDuration(r.startedAt, r.finishedAt) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
        <span>
          Showing {start + 1}–{Math.min(start + RUNS_PAGE_SIZE, runs.length)} of {runs.length}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={currentPage === 0}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="tabular-nums">
            Page {currentPage + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={currentPage >= totalPages - 1}
            onClick={() => onPageChange(currentPage + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page component ── */

export function MissionDetail() {
  const { id, name } = useParams<{ id: string; name: string }>();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDefcon5 = resolvedTheme === 'defcon5';
  const [selectedTask, setSelectedTask] = useState<TaskInfo | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<DatasetInfo | null>(null);
  const [activeTab, setActiveTab] = useState('general');
  const [runningMission, setRunningMission] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [runsPage, setRunsPage] = useState(0);

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

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data: history } = useQuery({
    queryKey: ['history', id],
    queryFn: () => getMissionHistory(id!),
    enabled: !!id && !!instance?.connected,
    refetchInterval: 10000,
  });

  const mission = instance?.config.missions?.find((m) => m.name === name);
  const missionRuns = useMemo(() => {
    return (history?.missions ?? [])
      .filter((m) => m.name === name)
      .slice()
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [history?.missions, name]);
  const runCount = missionRuns.length;
  const missionAgentNames = new Set(mission?.agents ?? []);
  const agents = instance?.config.agents?.filter((a) => missionAgentNames.has(a.name));

  const { nodes, edges } = useMemo(() => {
    if (!mission?.tasks || mission.tasks.length === 0) return { nodes: [], edges: [] };
    return layoutGraph(mission.tasks, NODE_WIDTH, NODE_HEIGHT, isDefcon5);
  }, [mission?.tasks, isDefcon5]);

  const nodesWithSelection = useMemo(() => {
    return nodes.map((n) => ({
      ...n,
      selected: activeTab === 'tasks' && n.id === selectedTask?.name,
    }));
  }, [nodes, selectedTask?.name, activeTab]);

  // Auto-select first item in each list
  useEffect(() => {
    if (!selectedTask && mission?.tasks?.length) setSelectedTask(mission.tasks[0]);
  }, [mission?.tasks, selectedTask]);

  useEffect(() => {
    if (!selectedAgent && agents?.length) setSelectedAgent(agents[0]);
  }, [agents, selectedAgent]);

  useEffect(() => {
    if (!selectedDataset && mission?.datasets?.length) setSelectedDataset(mission.datasets[0]);
  }, [mission?.datasets, selectedDataset]);

  const handleRun = async () => {
    if (!id || !name || !mission) return;
    if (mission.inputs && mission.inputs.length > 0) {
      setShowRunDialog(true);
      return;
    }
    setRunningMission(true);
    try {
      const result = await runMission(id, name, {});
      navigate(`/instances/${id}/runs/${result.missionId}`, {
        state: { from: { kind: 'mission', name } },
      });
    } catch {
      setRunningMission(false);
    }
  };

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const task = mission?.tasks?.find((t) => t.name === node.id);
    if (task) {
      setSelectedTask(task);
      setActiveTab('tasks');
    }
  }, [mission?.tasks]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance || !mission) return <div className="p-8 text-muted-foreground">Mission not found</div>;

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Compact header */}
      <div className="shrink-0 px-8 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{mission.name}</h1>
            {mission.description && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{mission.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ScheduleTriggerPopover mission={mission} instanceName={instance.name} />
            <Button
              variant={instance.connected ? 'default' : 'secondary'}
              disabled={!instance.connected || runningMission}
              onClick={handleRun}
            >
              {runningMission ? 'Starting...' : 'Run Mission'}
            </Button>
          </div>
        </div>
      </div>

      {/* ReactFlow canvas — fills remaining space */}
      <div className="flex-1 min-h-0 p-4">
        <div className="relative h-full rounded-lg border bg-card overflow-hidden">
          <ReactFlow
            nodes={nodesWithSelection}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
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
          {/* Tab strip — doubles as drag handle */}
          <div
            className="shrink-0 flex items-center px-4 border-b select-none touch-none cursor-row-resize"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <TabsList variant="line">
              <TabsTrigger value="general">General</TabsTrigger>
              {mission.inputs && mission.inputs.length > 0 && (
                <TabsTrigger value="inputs">
                  Inputs
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                    {mission.inputs.length}
                  </Badge>
                </TabsTrigger>
              )}
              <TabsTrigger value="datasets">
                Datasets
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                  {mission.datasets?.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="tasks">
                Tasks
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                  {mission.tasks?.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="agents">
                Agents
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                  {agents?.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="runs">
                History
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                  {runCount}
                </Badge>
              </TabsTrigger>
            </TabsList>
            <div className="ml-auto">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={togglePanel}>
                {panelHeight >= getMaxHeight() ? <ChevronsDown className="h-3.5 w-3.5" /> : <ChevronsUp className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Content fills remaining space */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="general" className="h-full m-0">
              <GeneralTabContent
                mission={mission}
                agents={agents ?? []}
              />
            </TabsContent>
            {mission.inputs && mission.inputs.length > 0 && (
              <TabsContent value="inputs" className="h-full m-0">
                <div className="overflow-y-auto p-4 h-full">
                  <div className="space-y-3 max-w-2xl">
                    {mission.inputs.map((inp) => (
                      <div key={inp.name} className="border rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{inp.name}</span>
                          {inp.type && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{inp.type}</Badge>
                          )}
                          {inp.required && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">required</Badge>
                          )}
                          {inp.protected && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0 font-medium">
                              <ShieldCheck className="size-3" />
                              protected
                            </span>
                          )}
                        </div>
                        {inp.description && (
                          <p className="text-sm text-muted-foreground mt-1">{inp.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            )}
            <TabsContent value="datasets" className="h-full m-0">
              <DatasetsTabContent
                datasets={mission.datasets ?? []}
                selectedDataset={selectedDataset}
                onSelectDataset={setSelectedDataset}
              />
            </TabsContent>
            <TabsContent value="tasks" className="h-full m-0">
              <TasksTabContent
                tasks={mission.tasks ?? []}
                selectedTask={selectedTask}
                onSelectTask={setSelectedTask}
              />
            </TabsContent>
            <TabsContent value="agents" className="h-full m-0">
              <AgentsTabContent
                agents={agents ?? []}
                selectedAgent={selectedAgent}
                onSelectAgent={setSelectedAgent}
              />
            </TabsContent>
            <TabsContent value="runs" className="h-full m-0">
              <RunsTabContent
                runs={missionRuns}
                page={runsPage}
                onPageChange={setRunsPage}
                onSelectRun={(runId) =>
                  navigate(`/instances/${id}/runs/${runId}`, {
                    state: { from: { kind: 'mission', name: mission.name } },
                  })
                }
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {mission && (
        <RunMissionDialog
          instanceId={id!}
          mission={mission}
          open={showRunDialog}
          onOpenChange={setShowRunDialog}
        />
      )}
    </div>
  );
}

type PopoverView =
  | { type: 'list' }
  | { type: 'schedule'; index: number }
  | { type: 'trigger' };

function ScheduleTriggerPopover({ mission, instanceName }: { mission: MissionInfo; instanceName: string }) {
  const schedules = mission.schedules ?? [];
  const trigger = mission.trigger;
  const count = schedules.length + (trigger ? 1 : 0);
  const [view, setView] = useState<PopoverView>({ type: 'list' });

  if (count === 0) return null;

  return (
    <Popover onOpenChange={() => setView({ type: 'list' })}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Clock className="size-4" />
          <Badge className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[10px] leading-none">
            {count}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        {view.type === 'list' && (
          <>
            <div className="px-4 py-3 border-b">
              <p className="text-sm font-medium">Schedules & Triggers</p>
            </div>
            <div className="divide-y">
              {schedules.map((sched, i) => (
                <button
                  key={i}
                  onClick={() => setView({ type: 'schedule', index: i })}
                  className="flex items-center gap-2 w-full px-4 py-2.5 hover:bg-muted/50 text-left"
                >
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="text-sm">Schedule {i + 1}</span>
                  <span className="ml-auto text-xs text-muted-foreground font-mono">{sched.expression}</span>
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </button>
              ))}
              {trigger && (
                <button
                  onClick={() => setView({ type: 'trigger' })}
                  className="flex items-center gap-2 w-full px-4 py-2.5 hover:bg-muted/50 text-left"
                >
                  <Webhook className="size-3.5 text-muted-foreground" />
                  <span className="text-sm">Webhook</span>
                  <span className="ml-auto text-xs text-muted-foreground font-mono">POST</span>
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </>
        )}
        {view.type === 'schedule' && (
          <ScheduleDetail
            schedule={schedules[view.index]}
            index={view.index}
            onBack={() => setView({ type: 'list' })}
          />
        )}
        {view.type === 'trigger' && trigger && (
          <TriggerDetail
            trigger={trigger}
            missionName={mission.name}
            instanceName={instanceName}
            onBack={() => setView({ type: 'list' })}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ScheduleDetail({ schedule, index, onBack }: { schedule: ScheduleInfo; index: number; onBack: () => void }) {
  const inputEntries = schedule.inputs ? Object.entries(schedule.inputs) : [];
  const isFriendly = !!(schedule.at?.length || schedule.every);

  return (
    <div>
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
        </button>
        <Clock className="size-3.5 text-muted-foreground" />
        <p className="text-sm font-medium">Schedule {index + 1}</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        {isFriendly ? (
          <>
            {schedule.at && schedule.at.length > 0 && (
              <DetailRow label="At" value={schedule.at.join(', ')} />
            )}
            {schedule.every && (
              <DetailRow label="Every" value={schedule.every} />
            )}
            {schedule.weekdays && schedule.weekdays.length > 0 && (
              <DetailRow label="Weekdays" value={schedule.weekdays.join(', ')} />
            )}
          </>
        ) : (
          <DetailRow label="Cron" value={schedule.expression} mono />
        )}
        {schedule.timezone && <DetailRow label="Timezone" value={schedule.timezone} />}
        {inputEntries.length > 0 && (
          <div className="pt-1">
            <span className="text-xs text-muted-foreground">Inputs</span>
            <div className="mt-1 rounded-md border bg-muted/30 px-3 py-2 space-y-1">
              {inputEntries.map(([key, val]) => (
                <div key={key} className="flex items-baseline justify-between gap-4">
                  <span className="text-xs font-mono text-muted-foreground">{key}</span>
                  <span className="text-xs font-mono">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerDetail({ trigger, missionName, instanceName, onBack }: { trigger: TriggerInfo; missionName: string; instanceName: string; onBack: () => void }) {
  const webhookPath = trigger.webhookPath || `/${missionName}`;
  const path = `/webhooks/${instanceName}${webhookPath}`;
  const { data: serverInfo } = useQuery({ queryKey: ['serverInfo'], queryFn: getServerInfo, staleTime: Infinity });
  const fullUrl = `${serverInfo?.baseUrl ?? window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullUrl]);

  return (
    <div>
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
        </button>
        <Webhook className="size-3.5 text-muted-foreground" />
        <p className="text-sm font-medium">Webhook</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div>
          <span className="text-xs text-muted-foreground">URL</span>
          <div className="mt-1 flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5">
            <span className="text-xs font-mono flex-1 break-all">{path}</span>
            <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground flex-shrink-0">
              {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </div>
        {trigger.hasSecret && (
          <div>
            <span className="text-xs text-muted-foreground">Secret Header</span>
            <div className="mt-1 flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5">
              <code className="text-xs font-mono flex-1">X-Webhook-Secret: {showSecret ? trigger.secret || '••••••••' : '••••••••'}</code>
              <button onClick={() => setShowSecret(!showSecret)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
        )}
        {!trigger.hasSecret && (
          <DetailRow label="Secret" value="None" />
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}
