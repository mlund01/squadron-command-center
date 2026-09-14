import { useMemo, useState } from 'react';
import { Activity, Bot, Brain, ChevronDown, ChevronRight, Clock3, Coins, MessageSquareText, Wrench } from 'lucide-react';
import type { MissionEventRecord, MissionRun, MissionTaskRun } from '@/api/types';
import type { MissionIterationTelemetry } from '@/components/MissionGraph';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TraceEvent = MissionEventRecord & { data: Record<string, unknown> };

type TraceKind = 'agent' | 'model' | 'reasoning' | 'task' | 'tool';
type TraceSpan = {
  id: string;
  kind: TraceKind;
  label: string;
  start: number;
  end: number;
  detail?: string;
  sessionId?: string;
};
type TraceRow = { span: TraceSpan; children: TraceSpan[] };

export function RunExecutionTimeline({
  onSelectTask,
  run,
  selectedTaskName,
  selectedIterationIndex,
  tasks,
  iterations,
}: {
  onSelectTask: (taskName: string, iterationIndex?: number) => void;
  run: MissionRun;
  selectedTaskName?: string;
  selectedIterationIndex?: number;
  tasks: MissionTaskRun[];
  iterations?: Record<string, MissionIterationTelemetry | undefined>;
}) {
  const timeline = useMemo(() => buildRunTimeline(run, tasks), [run, tasks]);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(() => new Set());

  const toggleIterations = (taskName: string) => {
    setExpandedTasks((current) => {
      const next = new Set(current);
      if (next.has(taskName)) next.delete(taskName);
      else next.add(taskName);
      return next;
    });
  };

  return <section className="overflow-hidden rounded-md border bg-card">
    <div className="px-4 py-3">
      <h2 className="text-xs font-semibold">Task execution timeline</h2>
      <p className="mt-1 text-[10px] text-muted-foreground">Every executed task aligned to the run clock. Select a row to inspect its conversation and trace.</p>
    </div>
    {timeline.tasks.length ? <div className="overflow-x-auto border-t">
      <div className="min-w-[780px]">
        <TimelineAxis durationMs={timeline.durationMs} labelWidth="15rem" />
        <div>
          {timeline.tasks.map(({ durationMs, end, start, task }) => {
            const iteration = iterations?.[task.taskName];
            const hasIterations = Boolean(iteration && iteration.total > 0);
            const expanded = hasIterations && expandedTasks.has(task.taskName);
            return <div key={task.id}>
          <div
            className={cn('group grid w-full grid-cols-[15rem_minmax(32rem,1fr)] items-center text-left transition-colors hover:bg-accent/40', selectedTaskName === task.taskName && 'bg-accent/60')}
            data-trace-task={task.taskName}
          >
            <span className="flex min-w-0 items-center pl-2">
              {hasIterations && <button aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${task.taskName} iterations`} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggleIterations(task.taskName)} type="button">{expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}</button>}
              <button aria-label={`Inspect ${task.taskName}`} className={cn('min-w-0 flex-1 py-2.5 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', !hasIterations && 'pl-2')} onClick={() => onSelectTask(task.taskName)} type="button">
                <span className="flex min-w-0 items-center gap-2"><span className={cn('size-1.5 shrink-0 rounded-full', statusDot(task.status))} /><span className="truncate text-[10px] font-medium">{task.taskName}</span></span>
                <span className="mt-0.5 block pl-3.5 text-[9px] tabular-nums text-muted-foreground">{hasIterations ? `${iteration!.total} ${iteration!.parallel ? 'parallel' : 'sequential'} · ${iteration!.completed}/${iteration!.total} completed` : `${formatDuration(durationMs)} · ${task.status}`}</span>
              </button>
            </span>
            <button aria-label={`Inspect ${task.taskName} timeline`} className="relative mr-4 h-8 overflow-hidden rounded-sm bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelectTask(task.taskName)} type="button">
              <TimelineGrid />
              <span
                className={cn('absolute top-1/2 h-3 -translate-y-1/2 rounded-[2px] shadow-sm', statusBar(task.status))}
                style={barStyle(start, end, timeline.start, timeline.end)}
                title={`${task.taskName}: ${formatDuration(durationMs)}`}
              />
            </button>
          </div>
          {expanded && iteration!.lanes.map((lane) => <button
            aria-label={`Inspect ${task.taskName} iteration ${lane.index + 1}`}
            className={cn('grid w-full grid-cols-[15rem_minmax(32rem,1fr)] items-center bg-muted/15 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selectedTaskName === task.taskName && selectedIterationIndex === lane.index && 'bg-accent/60')}
            key={`${task.id}-iteration-${lane.index}`}
            onClick={() => onSelectTask(task.taskName, lane.index)}
            type="button"
          >
            <span className="min-w-0 py-2 pl-10 pr-4">
              <span className="flex min-w-0 items-center gap-2"><span className={cn('size-1.5 shrink-0 rounded-full', statusDot(lane.status))} /><span className="truncate text-[10px] font-medium">Iteration {lane.index + 1}</span></span>
              <span className="mt-0.5 block pl-3.5 text-[9px] tabular-nums text-muted-foreground">{formatDuration(lane.end - lane.start)} · {lane.status}</span>
            </span>
            <span className="relative mr-4 h-7 overflow-hidden rounded-sm bg-muted/35"><TimelineGrid /><span className={cn('absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px]', statusBar(lane.status))} style={barStyle(lane.start, lane.end, timeline.start, timeline.end)} /></span>
          </button>)}
          </div>})}
        </div>
      </div>
    </div> : <p className="border-t py-10 text-center text-xs text-muted-foreground">No task execution timing was recorded.</p>}
  </section>;
}

export function TaskTracePanel({ events, onSelectedAgentSessionIdChange, selectedAgentSessionId, task }: { events: TraceEvent[]; onSelectedAgentSessionIdChange: (sessionId: string) => void; selectedAgentSessionId: string; task: MissionTaskRun }) {
  const taskEvents = useMemo(() => scopeTaskEvents(task, events), [events, task]);
  const taskTrace = useMemo(() => buildTaskTrace(task, taskEvents, 'commander'), [task, taskEvents]);
  const selectedAgentSpan = useMemo(() => taskTrace.spans.find((span) => span.kind === 'agent' && span.sessionId === selectedAgentSessionId), [selectedAgentSessionId, taskTrace.spans]);
  const agentView = useMemo(() => selectedAgentSpan ? buildAgentSessionTrace(selectedAgentSpan, events) : undefined, [events, selectedAgentSpan]);
  const trace = agentView?.trace ?? taskTrace;
  const rows = useMemo(() => groupTurnChildren(trace.spans), [trace.spans]);
  const expandableTurnIds = useMemo(() => rows.filter((row) => row.children.length).map((row) => row.span.id), [rows]);
  const [expandedTurnIds, setExpandedTurnIds] = useState<Set<string>>(() => new Set());
  const allExpanded = expandableTurnIds.length > 0 && expandableTurnIds.every((id) => expandedTurnIds.has(id));

  const toggleTurn = (turnId: string) => {
    setExpandedTurnIds((current) => {
      const next = new Set(current);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  };
  const toggleAll = () => setExpandedTurnIds(allExpanded ? new Set() : new Set(expandableTurnIds));
  const drillIntoAgent = (span: TraceSpan) => {
    if (!span.sessionId) return;
    setExpandedTurnIds(new Set());
    onSelectedAgentSessionIdChange(span.sessionId);
  };
  const directAgentResponse = Boolean(agentView && trace.reasoning === 0 && trace.toolCalls === 0);

  return <div className="min-h-0">
      <div className="grid grid-cols-2 border-b sm:grid-cols-5">
        <TraceMetric icon={Clock3} label="Duration" value={formatDuration(trace.durationMs)} />
        <TraceMetric icon={MessageSquareText} label={agentView ? 'Turns' : 'Commander turns'} value={String(trace.turns)} />
        <TraceMetric icon={Wrench} label={agentView ? 'Tool calls' : 'Commander tools'} value={String(trace.toolCalls)} />
        <TraceMetric icon={agentView ? Brain : Bot} label={agentView ? 'Reasoning' : 'Delegations'} value={String(agentView ? trace.reasoning : trace.agents)} />
        <TraceMetric icon={Coins} label={agentView ? 'Cost' : 'Commander cost'} value={formatCost(trace.cost)} />
      </div>

      {directAgentResponse && <div className="mx-5 mt-5 rounded-md bg-muted/35 px-3 py-2.5">
        <p className="text-[10px] font-medium">Direct model response</p>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">Squadron recorded no reasoning or tool-call events for this agent session. The model completed the work in a single response.</p>
      </div>}

      {!agentView && task.error && <div className="m-5 rounded-md bg-destructive/10 px-3 py-2 text-[10px] text-destructive">{task.error}</div>}

      <section className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-xs font-semibold">{agentView ? 'Agent session trace' : 'Trace waterfall'}</h3><p className="mt-1 text-[10px] text-muted-foreground">{agentView ? 'The complete persisted agent session, including work across every turn.' : 'Commander turns and delegated agent sessions aligned on the task clock.'} Expand a turn to inspect its reasoning and tool calls.</p></div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <TraceLegend />
            {expandableTurnIds.length > 0 && <Button className="h-7 px-2 text-[9px]" onClick={toggleAll} size="sm" variant="outline">{allExpanded ? 'Collapse all' : 'Expand all'}</Button>}
          </div>
        </div>
        {rows.length ? <div className="mt-4 overflow-x-auto rounded-md bg-muted/20">
          <div className="min-w-[680px]">
            <TimelineAxis durationMs={trace.durationMs} label={agentView ? 'Session' : 'Task'} labelWidth="14rem" />
            <div>
              {rows.map((row) => <TraceSpanRow expanded={expandedTurnIds.has(row.span.id)} key={row.span.id} onDrillAgent={row.span.kind === 'agent' && row.span.sessionId !== selectedAgentSessionId ? () => drillIntoAgent(row.span) : undefined} onToggle={() => toggleTurn(row.span.id)} row={row} timelineEnd={trace.end} timelineStart={trace.start} />)}
            </div>
          </div>
        </div> : <p className="mt-4 rounded-md bg-muted/30 py-10 text-center text-xs text-muted-foreground">No span-level events were recorded for this task.</p>}
      </section>
  </div>;
}

function TraceSpanRow({ expanded, onDrillAgent, onToggle, row, timelineEnd, timelineStart }: { expanded: boolean; onDrillAgent?: () => void; onToggle: () => void; row: TraceRow; timelineEnd: number; timelineStart: number }) {
  const expandable = row.children.length > 0;
  const cells = <TraceSpanCells childSummary={summarizeChildren(row.children)} drillable={Boolean(onDrillAgent)} expanded={expanded} span={row.span} timelineEnd={timelineEnd} timelineStart={timelineStart} />;

  return <>
    {expandable || onDrillAgent ? <button aria-expanded={expandable ? expanded : undefined} aria-label={onDrillAgent ? `Drill into ${row.span.label} agent session` : undefined} className={cn('grid w-full grid-cols-[14rem_minmax(28rem,1fr)] items-center text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', expanded && 'bg-accent/25')} onClick={onDrillAgent ?? onToggle} type="button">{cells}</button> : <div className="grid grid-cols-[14rem_minmax(28rem,1fr)] items-center">{cells}</div>}
    {expanded && row.children.map((childSpan) => <div className="grid grid-cols-[14rem_minmax(28rem,1fr)] items-center bg-muted/25" key={childSpan.id}><TraceSpanCells child span={childSpan} timelineEnd={timelineEnd} timelineStart={timelineStart} /></div>)}
  </>;
}

function TraceSpanCells({ child, childSummary = '', drillable, expanded, span, timelineEnd, timelineStart }: { child?: boolean; childSummary?: string; drillable?: boolean; expanded?: boolean; span: TraceSpan; timelineEnd: number; timelineStart: number }) {
  const hasDisclosureGutter = span.kind === 'model' || span.kind === 'agent';
  const expandable = Boolean(childSummary);
  return <>
    <div className="min-w-0 px-3 py-2" style={{ paddingLeft: `${12 + traceIndent(span.kind) + (child ? 18 : 0)}px` }}>
      <div className="flex min-w-0 items-center gap-1.5">
        {hasDisclosureGutter && (expandable ? (expanded ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />) : drillable ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : <span aria-hidden="true" className="size-3 shrink-0" />)}
        <TraceIcon kind={span.kind} />
        <span className="truncate text-[10px] font-medium" title={span.label}>{span.label}</span>
      </div>
      <p className={cn('mt-0.5 truncate text-[8px] uppercase tracking-wide text-muted-foreground', hasDisclosureGutter ? 'pl-[2.625rem]' : 'pl-4')}>{span.detail || span.kind}{childSummary && ` · ${childSummary}`} · {formatDuration(span.end - span.start)}</p>
    </div>
    <div className="relative mr-3 h-7 overflow-hidden rounded-sm bg-muted/35">
      <TimelineGrid />
      <span className={cn('absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[2px]', traceBar(span.kind))} style={barStyle(span.start, span.end, timelineStart, timelineEnd)} title={`${span.label}: ${formatDuration(span.end - span.start)}`} />
    </div>
  </>;
}

function scopeTaskEvents(task: MissionTaskRun, events: TraceEvent[]) {
  const direct = events.filter((event) => event.taskId === task.id || eventTaskName(event) === task.taskName);
  const sessionIds = new Set(direct.map(eventSessionId).filter(Boolean));
  return events.filter((event) => event.taskId === task.id || eventTaskName(event) === task.taskName || sessionIds.has(eventSessionId(event)));
}

function buildAgentSessionTrace(agentSpan: TraceSpan, events: TraceEvent[]) {
  const sessionId = agentSpan.sessionId!;
  const sessionEvents = events.filter((event) => eventSessionId(event) === sessionId);
  const eventTimes = sessionEvents.filter((event) => validTime(event.createdAt)).map((event) => Date.parse(event.createdAt));
  const start = Math.min(agentSpan.start, ...eventTimes);
  const end = Math.max(agentSpan.end, ...eventTimes, start + 1);
  const lifecycle = sessionEvents.filter((event) => event.eventType === 'agent_started' || event.eventType === 'agent_completed' || event.eventType === 'agent_failed').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const lastLifecycle = lifecycle[lifecycle.length - 1];
  const status = lastLifecycle?.eventType === 'agent_failed' ? 'failed' : lastLifecycle?.eventType === 'agent_completed' ? 'completed' : 'running';
  const syntheticTask: MissionTaskRun = {
    id: `agent-session-${sessionId}`,
    missionId: sessionEvents[0]?.missionId ?? '',
    taskName: agentSpan.label,
    status,
    startedAt: new Date(start).toISOString(),
    finishedAt: status === 'running' ? undefined : new Date(end).toISOString(),
  };
  const traceEvents = sessionEvents.filter((event) => event.eventType !== 'agent_started' && event.eventType !== 'agent_completed' && event.eventType !== 'agent_failed');
  const trace = buildTaskTrace(syntheticTask, traceEvents);
  const root = trace.spans.find((span) => span.kind === 'task');
  if (root) {
    root.kind = 'agent';
    root.detail = 'complete agent session';
    root.sessionId = sessionId;
  }
  return { name: agentSpan.label, status, trace };
}

function buildRunTimeline(run: MissionRun, tasks: MissionTaskRun[]) {
  const executed = tasks
    .filter((task) => validTime(task.startedAt))
    .map((task) => {
      const start = Date.parse(task.startedAt!);
      const finish = validTime(task.finishedAt) ? Date.parse(task.finishedAt!) : Date.now();
      const end = Math.max(start, finish);
      return { task, start, end, durationMs: end - start };
    })
    .sort((a, b) => a.start - b.start || a.task.taskName.localeCompare(b.task.taskName));
  const recordedStart = validTime(run.startedAt) ? Date.parse(run.startedAt) : executed[0]?.start ?? Date.now();
  const recordedEnd = validTime(run.finishedAt) ? Date.parse(run.finishedAt!) : run.status === 'running' ? Date.now() : recordedStart;
  const start = Math.min(recordedStart, ...executed.map((item) => item.start));
  const end = Math.max(recordedEnd, ...executed.map((item) => item.end), start + 1);
  return { tasks: executed, start, end, durationMs: end - start };
}

function buildTaskTrace(task: MissionTaskRun, events: TraceEvent[], scope: 'all' | 'commander' = 'all') {
  const ordered = [...events].filter((event) => validTime(event.createdAt)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const eventTimes = ordered.map((event) => Date.parse(event.createdAt));
  const recordedStart = validTime(task.startedAt) ? Date.parse(task.startedAt!) : eventTimes[0] ?? Date.now();
  const recordedEnd = validTime(task.finishedAt) ? Date.parse(task.finishedAt!) : task.status === 'running' ? Date.now() : eventTimes[eventTimes.length - 1] ?? recordedStart;
  const start = Math.min(recordedStart, ...eventTimes);
  const end = Math.max(recordedEnd, ...eventTimes, start + 1);
  const spans: TraceSpan[] = [{ id: `task-${task.id}`, kind: 'task', label: task.taskName, start, end, detail: 'task' }];
  const pendingTools = new Map<string, { event: TraceEvent; kind: 'tool'; label: string }>();
  const pendingAgents = new Map<string, TraceEvent>();
  const reasoning = new Map<string, TraceEvent[]>();

  ordered.forEach((event) => {
    const at = Date.parse(event.createdAt);
    if (event.eventType === 'session_turn') {
      const duration = numberValue(event.data.turnDurationMs);
      const entity = textValue(event.data.entity) || 'Model';
      if (scope === 'commander' && entity.toLowerCase() !== 'commander') return;
      const model = textValue(event.data.model);
      const tokens = numberValue(event.data.inputTokens) + numberValue(event.data.outputTokens);
      spans.push({ id: `turn-${event.id}`, kind: 'model', label: `${capitalize(entity)} turn`, detail: [model || 'model', tokens ? `${formatTokens(tokens)} tokens` : ''].filter(Boolean).join(' · '), start: Math.max(start, at - duration), end: at, sessionId: event.sessionId || textValue(event.data.sessionId) });
      return;
    }
    if (event.eventType === 'commander_calling_tool' || event.eventType === 'agent_calling_tool') {
      if (scope === 'commander' && event.eventType === 'agent_calling_tool') return;
      const key = `${event.eventType.startsWith('commander') ? 'commander' : 'agent'}:${textValue(event.data.toolCallId) || event.id}`;
      pendingTools.set(key, { event, kind: 'tool', label: textValue(event.data.toolName) || 'Tool call' });
      return;
    }
    if (event.eventType === 'commander_tool_complete' || event.eventType === 'agent_tool_complete') {
      if (scope === 'commander' && event.eventType === 'agent_tool_complete') return;
      const key = `${event.eventType.startsWith('commander') ? 'commander' : 'agent'}:${textValue(event.data.toolCallId) || event.id}`;
      const pending = pendingTools.get(key);
      if (pending) {
        spans.push({ id: `tool-${pending.event.id}`, kind: 'tool', label: pending.label, start: Date.parse(pending.event.createdAt), end: at, detail: event.eventType.startsWith('commander') ? 'commander tool' : 'agent tool', sessionId: pending.event.sessionId || textValue(pending.event.data.sessionId) });
        pendingTools.delete(key);
      }
      return;
    }
    if (event.eventType === 'agent_started') {
      pendingAgents.set(event.sessionId || textValue(event.data.sessionId) || event.id, event);
      return;
    }
    if (event.eventType === 'agent_completed' || event.eventType === 'agent_failed') {
      const key = event.sessionId || textValue(event.data.sessionId);
      const pending = pendingAgents.get(key);
      if (pending) {
        spans.push({ id: `agent-${pending.id}`, kind: 'agent', label: textValue(pending.data.agentName) || textValue(pending.data.agent) || 'Delegated agent', start: Date.parse(pending.createdAt), end: at, detail: event.eventType === 'agent_failed' ? 'failed delegation' : 'agent delegation', sessionId: key });
        pendingAgents.delete(key);
      }
      return;
    }
    const reasoningMatch = event.eventType.match(/^(commander|agent)_reasoning_(started|completed)$/);
    if (reasoningMatch) {
      const owner = reasoningMatch[1];
      if (scope === 'commander' && owner === 'agent') return;
      const key = `${owner}:${event.sessionId || textValue(event.data.sessionId) || 'task'}`;
      if (reasoningMatch[2] === 'started') {
        const queue = reasoning.get(key) ?? [];
        queue.push(event);
        reasoning.set(key, queue);
      } else {
        const queue = reasoning.get(key);
        const pending = queue?.shift();
        if (pending) spans.push({ id: `reasoning-${pending.id}`, kind: 'reasoning', label: `${capitalize(owner)} reasoning`, start: Date.parse(pending.createdAt), end: at, detail: 'reasoning', sessionId: pending.sessionId || textValue(pending.data.sessionId) });
      }
    }
  });

  pendingTools.forEach(({ event, label }) => spans.push({ id: `tool-${event.id}`, kind: 'tool', label, start: Date.parse(event.createdAt), end, detail: 'in progress', sessionId: event.sessionId || textValue(event.data.sessionId) }));
  pendingAgents.forEach((event, sessionId) => spans.push({ id: `agent-${event.id}`, kind: 'agent', label: textValue(event.data.agentName) || textValue(event.data.agent) || 'Delegated agent', start: Date.parse(event.createdAt), end, detail: 'in progress', sessionId }));
  reasoning.forEach((queue, key) => queue.forEach((event) => spans.push({ id: `reasoning-${event.id}`, kind: 'reasoning', label: `${capitalize(key.split(':')[0])} reasoning`, start: Date.parse(event.createdAt), end, detail: 'in progress', sessionId: event.sessionId || textValue(event.data.sessionId) })));

  if (scope === 'commander') annotateAgentDelegations(spans, ordered);
  const consolidatedSpans = consolidateSingleTurnDelegations(spans);
  consolidatedSpans.sort((a, b) => a.start - b.start || traceOrder(a.kind) - traceOrder(b.kind));
  const turns = ordered.filter((event) => event.eventType === 'session_turn' && (scope === 'all' || textValue(event.data.entity).toLowerCase() === 'commander'));
  const toolCalls = ordered.filter((event) => event.eventType === 'commander_calling_tool' || (scope === 'all' && event.eventType === 'agent_calling_tool'));
  const reasoningEvents = ordered.filter((event) => event.eventType === 'commander_reasoning_completed' || (scope === 'all' && event.eventType === 'agent_reasoning_completed'));
  return {
    agents: ordered.filter((event) => event.eventType === 'agent_started').length,
    cost: turns.reduce((total, event) => total + numberValue(event.data.cost), 0),
    durationMs: end - start,
    end,
    reasoning: reasoningEvents.length,
    spans: consolidatedSpans,
    start,
    toolCalls: toolCalls.length,
    turns: turns.length,
  };
}

function TimelineAxis({ durationMs, label = 'Task', labelWidth }: { durationMs: number; label?: string; labelWidth: string }) {
  return <div className="grid items-end bg-muted/20" style={{ gridTemplateColumns: `${labelWidth} minmax(32rem, 1fr)` }}>
    <span className="px-4 py-2 text-[8px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <span className="relative mr-4 h-7 text-[8px] tabular-nums text-muted-foreground">
      {[0, 0.25, 0.5, 0.75, 1].map((position) => <span className={cn('absolute bottom-2', position === 0 && 'left-0', position === 1 && 'right-0', position > 0 && position < 1 && '-translate-x-1/2')} key={position} style={position > 0 && position < 1 ? { left: `${position * 100}%` } : undefined}>{formatDuration(durationMs * position)}</span>)}
    </span>
  </div>;
}

function TimelineGrid() { return <>{[0.25, 0.5, 0.75].map((position) => <span className="absolute inset-y-0 border-l border-border/60" key={position} style={{ left: `${position * 100}%` }} />)}</>; }
function TraceMetric({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) { return <div className="border-l p-3 first:border-l-0"><p className="flex items-center gap-1.5 text-[8px] uppercase tracking-wider text-muted-foreground"><Icon className="size-3" />{label}</p><p className="mt-1 text-sm font-semibold tabular-nums">{value}</p></div>; }
function TraceLegend() { return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-muted-foreground">{(['model', 'reasoning', 'tool', 'agent'] as TraceKind[]).map((kind) => <span className="flex items-center gap-1" key={kind}><span className={cn('h-1.5 w-3 rounded-[1px]', traceBar(kind))} />{kind}</span>)}</div>; }
function TraceIcon({ kind }: { kind: TraceKind }) { const Icon = kind === 'agent' ? Bot : kind === 'reasoning' ? Brain : kind === 'tool' ? Wrench : kind === 'model' ? MessageSquareText : Activity; return <Icon className="size-3 shrink-0 text-muted-foreground" />; }

function barStyle(start: number, end: number, timelineStart: number, timelineEnd: number) {
  const duration = Math.max(1, timelineEnd - timelineStart);
  const left = clamp((start - timelineStart) / duration * 100, 0, 100);
  const right = clamp((end - timelineStart) / duration * 100, left, 100);
  return { left: `${left}%`, minWidth: '6px', width: `${Math.max(0.45, right - left)}%` };
}
function annotateAgentDelegations(spans: TraceSpan[], events: TraceEvent[]) {
  spans.filter((span) => span.kind === 'agent' && span.sessionId).forEach((agentSpan) => {
    const related = events.filter((event) => eventSessionId(event) === agentSpan.sessionId);
    const turns = related.filter((event) => event.eventType === 'session_turn' && textValue(event.data.entity).toLowerCase() !== 'commander');
    const tools = related.filter((event) => event.eventType === 'agent_calling_tool').length;
    const model = textValue(turns[turns.length - 1]?.data.model);
    const base = agentSpan.detail || 'agent delegation';
    agentSpan.detail = [base, model, `${turns.length} turn${turns.length === 1 ? '' : 's'}`, `${tools} tool${tools === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  });
}
function consolidateSingleTurnDelegations(spans: TraceSpan[]) {
  const agentSpans = spans.filter((span) => span.kind === 'agent' && span.sessionId);
  const hiddenTurns = new Set<string>();
  agentSpans.forEach((agentSpan) => {
    const turns = spans.filter((span) => span.kind === 'model' && span.sessionId === agentSpan.sessionId);
    if (turns.length !== 1) return;
    if (spans.some((span) => (span.kind === 'tool' || span.kind === 'reasoning') && span.sessionId === agentSpan.sessionId)) return;
    const [turn] = turns;
    const toleranceMs = 500;
    if (turn.start < agentSpan.start - toleranceMs || turn.end > agentSpan.end + toleranceMs) return;
    hiddenTurns.add(turn.id);
    agentSpan.detail = `${agentSpan.detail || 'agent delegation'} · ${turn.detail || 'model'} · 1 turn`;
  });
  return spans.filter((span) => !hiddenTurns.has(span.id));
}
function groupTurnChildren(spans: TraceSpan[]): TraceRow[] {
  const turns = spans.filter((span) => span.kind === 'model');
  const childrenByTurn = new Map<string, TraceSpan[]>();
  const groupedChildIds = new Set<string>();

  spans.filter((span) => span.kind === 'tool' || span.kind === 'reasoning').forEach((child) => {
    const sameSession = child.sessionId ? turns.filter((turn) => turn.sessionId === child.sessionId) : [];
    const commanderChild = child.detail?.startsWith('commander') || child.label.toLowerCase().startsWith('commander');
    const sameOwner = turns.filter((turn) => commanderChild ? turn.label.toLowerCase().startsWith('commander') : !turn.label.toLowerCase().startsWith('commander'));
    const candidates = sameSession.length ? sameSession : sameOwner;
    const containing = candidates.filter((turn) => turn.start <= child.start + 500 && turn.end >= child.end - 500).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    const preceding = candidates.filter((turn) => turn.end <= child.start + 1_000).sort((a, b) => b.end - a.end)[0];
    const overlapping = candidates.filter((turn) => turn.start <= child.start && turn.end >= child.start).sort((a, b) => b.start - a.start)[0];
    const parent = child.kind === 'reasoning' ? containing ?? overlapping ?? preceding : preceding ?? overlapping;
    if (!parent) return;
    const children = childrenByTurn.get(parent.id) ?? [];
    children.push(child);
    childrenByTurn.set(parent.id, children);
    groupedChildIds.add(child.id);
  });

  return spans
    .filter((span) => !groupedChildIds.has(span.id))
    .map((span) => ({ span, children: (childrenByTurn.get(span.id) ?? []).sort((a, b) => a.start - b.start || traceOrder(a.kind) - traceOrder(b.kind)) }));
}
function summarizeChildren(children: TraceSpan[]) {
  const reasoning = children.filter((span) => span.kind === 'reasoning').length;
  const tools = children.filter((span) => span.kind === 'tool').length;
  return [reasoning ? `${reasoning} reasoning span${reasoning === 1 ? '' : 's'}` : '', tools ? `${tools} tool call${tools === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}
function traceBar(kind: TraceKind) { return kind === 'agent' ? 'bg-emerald-500' : kind === 'tool' ? 'bg-amber-500' : kind === 'reasoning' ? 'bg-violet-500' : kind === 'model' ? 'bg-sky-500' : 'bg-foreground/70'; }
function statusBar(status: string) { return status === 'completed' ? 'bg-emerald-500' : status === 'failed' ? 'bg-destructive' : status === 'running' ? 'bg-primary animate-pulse' : status === 'stopped' ? 'bg-amber-500' : 'bg-muted-foreground/50'; }
function statusDot(status: string) { return status === 'completed' ? 'bg-emerald-500' : status === 'failed' ? 'bg-destructive' : status === 'running' ? 'bg-primary animate-pulse' : status === 'stopped' ? 'bg-amber-500' : 'bg-muted-foreground/50'; }
function traceIndent(kind: TraceKind) { return kind === 'task' ? 0 : kind === 'agent' ? 10 : kind === 'tool' || kind === 'reasoning' ? 20 : 10; }
function traceOrder(kind: TraceKind) { return kind === 'task' ? 0 : kind === 'agent' ? 1 : kind === 'model' ? 2 : kind === 'reasoning' ? 3 : 4; }
function validTime(value?: string) { return Boolean(value && Number.isFinite(Date.parse(value))); }
function textValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function eventTaskName(event: TraceEvent) { return textValue(event.data.taskName) || textValue(event.data.task); }
function eventSessionId(event: TraceEvent) { return event.sessionId || textValue(event.data.sessionId); }
function numberValue(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function capitalize(value: string) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : value; }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function formatDuration(milliseconds: number) { const safe = Math.max(0, milliseconds); if (safe < 1_000) return `${Math.round(safe)}ms`; const seconds = safe / 1_000; if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`; const minutes = Math.floor(seconds / 60); const remainder = Math.round(seconds % 60); return `${minutes}m ${remainder}s`; }
function formatTokens(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value); }
function formatCost(value: number) { if (!value) return '$0.00'; return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`; }
