import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Bot, ChevronDown, Clock3, Maximize2, MessageSquareText, Minimize2, RefreshCcw, Wrench, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { MissionEventRecord, MissionInfo, MissionRun, MissionRuntimeContentPart, MissionRuntimeInfo, MissionRuntimeMessage, MissionRuntimeTask } from '@/api/types';
import { MarkdownContent } from '@/components/MarkdownContent';
import { MissionGraph, type MissionTaskTelemetry } from '@/components/MissionGraph';
import { Button } from '@/components/ui/button';
import { parseCommanderSnapshot, type CommanderSnapshot } from '@/lib/commander-snapshot';
import { cn } from '@/lib/utils';
import './MissionRuntimeRun.css';

type RuntimeEvent = MissionEventRecord & {
  data: Record<string, unknown>;
  taskName: string;
  attemptId: string;
};
type Selection = { kind: 'commander' } | { kind: 'task'; name: string };

export function MissionRuntimeRun({ events: records, mission, run, runtime, status }: { events: MissionEventRecord[]; mission: MissionInfo; run: MissionRun; runtime: MissionRuntimeInfo; status: string }) {
  const { workspaceId = '' } = useParams();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<'chat' | 'trace'>('chat');
  const [expanded, setExpanded] = useState(false);
  const events = useMemo(() => records.map(parseRuntimeEvent), [records]);
  const taskByName = useMemo(() => new Map(runtime.tasks.map((task) => [task.name, task])), [runtime.tasks]);
  const iterationParentNames = useMemo(() => new Set((mission.tasks ?? []).filter((task) => task.iterator).map((task) => task.name)), [mission.tasks]);
  const executedTasks = runtime.tasks.filter((task) => !iterationParentNames.has(task.name));
  const telemetry = useMemo(() => Object.fromEntries((mission.tasks ?? []).map((task) => {
    const children = runtime.tasks.filter((candidate) => candidate.name === task.name || candidate.name.startsWith(`${task.name}[`));
    const iterationChildren = task.iterator ? children.filter((child) => isIterationChild(child.name, task.name)) : [];
    const parent = taskByName.get(task.name);
    const state = parent?.state ?? (children.some((child) => child.state === 'running') ? 'running' : 'blocked');
    const status = state === 'ready' || state === 'blocked' || state === 'dispatching' ? 'configured' : state === 'retry_pending' || state === 'waiting' ? 'running' : state;
    const iteration = task.iterator && iterationChildren.length ? {
      completed: iterationChildren.filter((child) => child.state === 'completed').length,
      failed: iterationChildren.filter((child) => child.state === 'failed').length,
      running: iterationChildren.filter((child) => child.state === 'running' || child.state === 'dispatching').length,
      total: iterationChildren.length,
      parallel: task.iterator.parallel,
      lanes: [],
    } : undefined;
    return [task.name, { status, error: parent?.error, iteration } satisfies MissionTaskTelemetry];
  })), [mission.tasks, runtime.tasks, taskByName]);
  const routeChoices = useMemo(() => Object.fromEntries(events.filter((event) => event.eventType === 'route.selected').map((event) => {
    const route = objectValue(event.data.Route ?? event.data.route);
    return [event.taskName, stringValue(route.Target ?? route.target)];
  }).filter(([source, target]) => source && target)), [events]);
  const launchedRuns = useMemo(() => events.filter((event) => event.eventType === 'cross_mission_launch.completed').map((event) => {
    const launch = objectValue(event.data.Launch ?? event.data.launch);
    return { mission: stringValue(launch.target ?? launch.Target), runId: stringValue(launch.childRunId ?? launch.ChildRunID) };
  }).filter((launch) => launch.mission && launch.runId), [events]);
  const selectedTask = selection?.kind === 'task' ? taskByName.get(selection.name) : undefined;
  const selectedIterationChildren = selectedTask && iterationParentNames.has(selectedTask.name) ? runtime.tasks.filter((task) => isIterationChild(task.name, selectedTask.name)).sort((a, b) => iterationIndex(a.name) - iterationIndex(b.name)) : [];
  const commanderTurns = runtime.commander.messages.filter((message) => message.role === 'assistant').length;
  const completed = executedTasks.filter((task) => task.state === 'completed').length;
  const waits = executedTasks.filter((task) => task.humanInput).length;
  const retries = executedTasks.reduce((total, task) => total + Math.max(0, task.attempt - 1), 0);
  const recoveries = events.filter((event) => event.eventType === 'mission.recovered');
  const runActive = status === 'running' || status === 'waiting';
  const commanderActive = runActive && runtime.commander.state === 'active';
  const executorActive = runActive && runtime.tasks.some((task) => task.state === 'running' || task.state === 'dispatching');
  const commanderStatus = commanderActive ? executorActive ? 'Waiting for task executors' : 'Commander deciding' : undefined;
  const failureEvent = [...events].reverse().find((event) => event.eventType === 'mission.failed');
  const failureReason = stringValue(failureEvent?.data.Error ?? failureEvent?.data.error) || runtime.tasks.find((task) => task.state === 'failed')?.error;
  const staleTerminalCheckpoint = ['completed', 'failed', 'stopped'].includes(status) && status !== runtime.state;
  const choose = (next: Selection) => { setSelection(next); setTab('chat'); };

  return <>
    {status === 'failed' && <section className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-[11px]" role="alert"><p className="font-semibold text-destructive">Mission failed</p><p className="mt-1 text-muted-foreground">{failureReason || (staleTerminalCheckpoint ? 'The run ended before its last runtime checkpoint reached a terminal state. Earlier failure details were not persisted.' : 'Inspect the failed task or trace for details.')}</p></section>}
    {status === 'stopped' && staleTerminalCheckpoint && <p className="rounded-md border px-4 py-3 text-[11px] text-muted-foreground">This run was stopped. Its last runtime checkpoint remains available for inspection.</p>}
    <section className="grid overflow-hidden rounded-md border bg-card sm:grid-cols-2 lg:grid-cols-4" aria-label="Run summary">
      <Metric label="Task executions" value={`${completed}/${executedTasks.length}`} detail={`${executedTasks.filter((task) => task.state === 'running').length} running`} />
      <Metric label="Commander turns" value={String(commanderTurns)} detail={staleTerminalCheckpoint ? 'Last checkpoint: ' + runtime.commander.state : runtime.commander.state} />
      <Metric label="Waiting for input" value={String(waits)} detail={waits ? 'Action needed' : 'None'} />
      <Metric label="Retries" value={String(retries)} detail={`${runtime.revision} durable revisions`} />
    </section>
    {launchedRuns.length > 0 && <section aria-label="Routed mission runs" className="rounded-md border bg-card px-4 py-3 text-[11px]"><p className="font-semibold">Continued in another mission</p><div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{launchedRuns.map((launch) => <Link className="inline-flex items-center gap-1.5 text-primary hover:underline" key={`${launch.mission}/${launch.runId}`} to={`/w/${workspaceId}/missions/${encodeURIComponent(launch.mission)}/runs/${encodeURIComponent(launch.runId)}`}>{launch.mission} · {launch.runId}<ArrowUpRight className="size-3" /></Link>)}</div></section>}
    <section className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div><h2 className="text-xs font-semibold">Execution canvas</h2><p className="mt-1 text-[10px] text-muted-foreground">The commander follows this graph. Select a task to inspect its executor session.</p></div><Button onClick={() => choose({ kind: 'commander' })} size="xs" variant="outline"><MessageSquareText className="size-3" />Commander conversation</Button></div>
      <div className="h-[35rem] min-w-0"><MissionGraph mission={mission} onSelectTask={(task) => choose({ kind: 'task', name: task.name })} routeChoices={routeChoices} selectedTask={selection?.kind === 'task' ? baseTaskName(selection.name) : undefined} telemetry={telemetry} /></div>
    </section>
    <TaskTimeline events={events} onSelect={choose} recoveries={recoveries} run={run} selected={selection} tasks={executedTasks} />
    {selection && <aside aria-label={selection.kind === 'commander' ? 'Commander session' : `${selection.name} task executor`} className={cn('fixed z-50 flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-2xl', expanded ? 'inset-3 sm:inset-4' : 'inset-y-3 right-3 w-[min(43rem,calc(100vw-1.5rem))] sm:inset-y-4 sm:right-4 sm:w-[min(43rem,calc(100vw-2rem))]')} role="dialog">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border bg-muted/40">{selection.kind === 'commander' ? <Bot className="size-4" /> : <Activity className="size-4" />}</span>
        <div className="min-w-0 flex-1"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">{selection.kind === 'commander' ? 'Mission commander' : iterationParentNames.has(selection.name) ? 'Iteration' : 'Task executor'}</p><h2 className="mt-0.5 truncate text-xs font-semibold">{selection.kind === 'commander' ? mission.name : selection.name}</h2></div>
        <span className="text-[10px] capitalize text-muted-foreground">{selection.kind === 'commander' && staleTerminalCheckpoint ? 'Last checkpoint: ' + runtime.commander.state : selection.kind === 'commander' ? runtime.commander.state : selectedTask?.state}</span>
        <button aria-label={expanded ? 'Exit expanded view' : 'Expand session'} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
        <button aria-label="Close session" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setSelection(null)}><X className="size-3.5" /></button>
      </header>
      <nav aria-label="Session view" className="flex h-9 shrink-0 gap-1 border-b px-5"><TabButton active={tab === 'chat'} label="Chat" onClick={() => setTab('chat')} /><TabButton active={tab === 'trace'} label="Trace" onClick={() => setTab('trace')} /></nav>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-4xl space-y-5 p-5 sm:p-6">
        {tab === 'chat' ? selection.kind === 'commander'
          ? <Conversation empty="The commander has not produced a message yet." messages={runtime.commander.messages} mode="commander" status={commanderStatus} />
          : selectedTask ? iterationParentNames.has(selectedTask.name) ? <IterationOverview children={selectedIterationChildren} onSelect={choose} task={selectedTask} /> : <TaskConversation active={runActive} events={events} task={selectedTask} /> : <p className="text-xs text-muted-foreground">Task telemetry is not available yet.</p>
          : <RuntimeTrace events={events} run={run} selection={selection} task={selectedTask} />}
      </div></div>
    </aside>}
  </>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="border-t p-4 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{detail}</p></div>; }
function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) { return <button aria-current={active ? 'page' : undefined} className={cn('border-b-2 px-3 text-[10px] font-medium', active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={onClick} type="button">{label}</button>; }

type RecoveryAttempt = { taskName: string; attemptId: string; tools: { toolUseId: string; toolName: string }[] };

function recoveryAttempts(event: RuntimeEvent): RecoveryAttempt[] {
  const restart = objectValue(event.data.Restart ?? event.data.restart);
  return arrayOfObjects(restart.attempts ?? restart.Attempts).map((value) => ({
    taskName: stringValue(value.taskName ?? value.TaskName),
    attemptId: stringValue(value.attemptId ?? value.AttemptID),
    tools: arrayOfObjects(value.inFlightTools ?? value.InFlight).map((tool) => ({
      toolUseId: stringValue(tool.toolUseId ?? tool.ToolUseID),
      toolName: stringValue(tool.toolName ?? tool.ToolName),
    })),
  }));
}

function eventAfterRecovery(event: RuntimeEvent, recovery: RuntimeEvent, attemptId: string): boolean {
  return event.attemptId === attemptId && Date.parse(event.createdAt) >= Date.parse(recovery.createdAt);
}

function RecoverySummary({ events, recoveries }: { events: RuntimeEvent[]; recoveries: RuntimeEvent[] }) {
  return <div aria-label="Worker recovery" className="border-b px-4 py-3 text-[11px]">
    <div className="flex items-center gap-2 font-medium">
      <RefreshCcw className="size-3.5 text-primary" />
      <span>Worker recovered {recoveries.length > 1 ? `${recoveries.length} times` : 'during this run'}</span>
      <span className="font-normal text-muted-foreground">· latest {formatTime(recoveries.at(-1)?.createdAt ?? '')}</span>
    </div>
    <details className="mt-2 text-[10px]">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Recovery details</summary>
      <div className="mt-2 space-y-3">{recoveries.map((recovery) => {
        const restart = objectValue(recovery.data.Restart ?? recovery.data.restart);
        const checkpointAt = stringValue(restart.lastCheckpointAt ?? restart.LastCheckpointAt);
        const attempts = recoveryAttempts(recovery);
        return <div key={recovery.id}>
          <p className="font-medium">Recovery recorded {formatTime(recovery.createdAt)}{checkpointAt && <span className="font-normal text-muted-foreground"> · last checkpoint {formatTime(checkpointAt)}</span>}</p>
          {attempts.length ? <ul className="mt-1 space-y-1 text-muted-foreground">{attempts.map((attempt) => <RecoveryAttemptRow attempt={attempt} events={events} key={attempt.attemptId} recovery={recovery} />)}</ul> : <p className="mt-1 text-muted-foreground">No task attempt was active at the last checkpoint.</p>}
        </div>;
      })}</div>
    </details>
  </div>;
}

function RecoveryAttemptRow({ attempt, events, recovery }: { attempt: RecoveryAttempt; events: RuntimeEvent[]; recovery: RuntimeEvent }) {
  const related = events.filter((event) => eventAfterRecovery(event, recovery, attempt.attemptId));
  const blocked = related.some((event) => event.eventType === 'task.recovery_blocked');
  const resumed = related.some((event) => event.eventType === 'task.lease_acquired');
  return <li>
    <span className="font-medium text-foreground">{attempt.taskName}</span> · same attempt {attempt.attemptId}{blocked ? ' · operator action needed' : resumed ? ' · resumed from checkpoint' : ' · awaiting resume'}
    {attempt.tools.map((tool) => {
      const replayEvents = related.filter((event) => stringValue(objectValue(event.data.ToolReplay ?? event.data.toolReplay).toolUseId) === tool.toolUseId);
      const replayed = replayEvents.some((event) => event.eventType === 'task.tool_replay_completed');
      const replayStarted = replayEvents.some((event) => event.eventType === 'task.tool_replay_started');
      const outcome = replayed ? 'safe replay completed' : replayStarted ? 'safe replay started' : blocked ? 'outcome uncertain' : 'in flight at recovery';
      return <span className="block pl-3" key={tool.toolUseId}>{tool.toolName} · {outcome}</span>;
    })}
  </li>;
}

function TaskTimeline({ events, onSelect, recoveries, run, selected, tasks }: { events: RuntimeEvent[]; onSelect: (selection: Selection) => void; recoveries: RuntimeEvent[]; run: MissionRun; selected: Selection | null; tasks: MissionRuntimeTask[] }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (run.finishedAt) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const interval = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(interval);
  }, [run.finishedAt]);
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Math.max(now, start + 1, ...events.map((event) => Date.parse(event.createdAt)).filter(Number.isFinite));
  const duration = Math.max(1, end - start);
  return <section className="overflow-hidden rounded-md border bg-card"><div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">Task execution timeline</h2><p className="mt-1 text-[10px] text-muted-foreground">All tasks share the mission clock. Overlapping bars ran in parallel; separate bars show retries.</p></div>{recoveries.length > 0 && <RecoverySummary events={events} recoveries={recoveries} />}<div className="overflow-x-auto"><div className="min-w-[640px] p-4">
    <div className="grid grid-cols-[13rem_minmax(0,1fr)] gap-3 pb-2 text-[9px] uppercase tracking-wider text-muted-foreground"><span>Session</span><div className="relative flex justify-between"><span>Start</span><span>{formatDuration(duration)}</span>{events.filter((event) => event.eventType === 'mission.recovered').map((event) => <span aria-label={`Worker recovery at ${formatTime(event.createdAt)}`} className="absolute -bottom-1 top-0 w-0.5 bg-violet-500" key={event.id} style={{ left: `${Math.max(0, Math.min(100, (Date.parse(event.createdAt) - start) / duration * 100))}%` }} title={`Worker recovery recorded ${formatTime(event.createdAt)}`} />)}</div></div>
    <button className={cn('grid w-full grid-cols-[13rem_minmax(0,1fr)] items-center gap-3 rounded px-2 py-2 text-left hover:bg-accent/40', selected?.kind === 'commander' && 'bg-accent/40')} onClick={() => onSelect({ kind: 'commander' })}><span className="flex items-center gap-2 text-[10px] font-medium"><Bot className="size-3" />Commander</span><span className="relative h-5 bg-muted/25"><span className="absolute inset-y-1 left-0 right-0 rounded-sm bg-sky-500/75" /></span></button>
    {tasks.map((task) => <button className={cn('grid w-full grid-cols-[13rem_minmax(0,1fr)] items-center gap-3 rounded px-2 py-2 text-left hover:bg-accent/40', selected?.kind === 'task' && selected.name === task.name && 'bg-accent/40')} key={task.name} onClick={() => onSelect({ kind: 'task', name: task.name })}><span className="min-w-0"><span className="block truncate text-[10px] font-medium">{task.name}</span><span className="mt-0.5 block text-[9px] text-muted-foreground">{task.state.replaceAll('_', ' ')}{task.attempt > 1 ? ` · ${task.attempt} attempts` : ''}</span></span><span className="relative h-6 bg-muted/25">{task.attempts?.map((attempt) => { const attemptStart = Date.parse(attempt.dispatchedAt); const terminal = events.find((event) => event.attemptId === attempt.id && ['task.completed', 'task.attempt_failed', 'task.failed'].includes(event.eventType)); const attemptEnd = terminal ? Date.parse(terminal.createdAt) : end; const left = Math.max(0, Math.min(100, (attemptStart - start) / duration * 100)); const width = Math.max(0.8, Math.min(100 - left, (attemptEnd - attemptStart) / duration * 100)); return <span className={cn('absolute inset-y-1 rounded-sm', terminal?.eventType === 'task.attempt_failed' || terminal?.eventType === 'task.failed' ? 'bg-destructive' : task.state === 'running' && !terminal ? 'animate-pulse bg-primary' : 'bg-emerald-500')} key={attempt.id} style={{ left: `${left}%`, width: `${width}%` }} title={`Attempt ${attempt.number} · ${formatDuration(attemptEnd - attemptStart)}`} />; })}</span></button>)}
  </div></div></section>;
}

function TaskConversation({ active, events, task }: { active: boolean; events: RuntimeEvent[]; task: MissionRuntimeTask }) {
  const [attemptId, setAttemptId] = useState(task.attempts?.at(-1)?.id ?? '');
  const attempt = task.attempts?.find((candidate) => candidate.id === attemptId) ?? task.attempts?.at(-1);
  const turns = attempt?.messages?.filter((message) => message.model) ?? [];
  const inputTokens = turns.reduce((total, message) => total + (message.model?.inputTokens ?? 0), 0);
  const outputTokens = turns.reduce((total, message) => total + (message.model?.outputTokens ?? 0), 0);
  const terminalEvent = attempt && events.find((event) => event.attemptId === attempt.id && ['task.completed', 'task.attempt_failed', 'task.failed'].includes(event.eventType));
  const attemptEnd = terminalEvent?.createdAt ?? (active && attempt?.id === task.attempts?.at(-1)?.id && ['running', 'dispatching', 'waiting'].includes(task.state) ? new Date().toISOString() : undefined);
  const attemptDuration = attempt && attemptEnd ? Date.parse(attemptEnd) - Date.parse(attempt.dispatchedAt) : undefined;
  return <>
    {task.humanInput && <div className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-[11px]"><p className="font-medium">Waiting for human input{task.humanInput.shortSummary ? ` · ${task.humanInput.shortSummary}` : ''}</p><MarkdownContent className="mt-2 text-muted-foreground" content={task.humanInput.question} /><p className="mt-2 text-[10px] text-muted-foreground">Close this panel to answer on the run page.</p></div>}
    {task.retryReadyAt && <p className="flex items-center gap-2 text-[10px] text-muted-foreground"><RefreshCcw className="size-3" />Retry scheduled for {formatTime(task.retryReadyAt)}</p>}
    {task.error && <p className="border-l-2 border-destructive px-3 text-[11px] text-destructive">{task.error}</p>}
    {task.attempts && task.attempts.length > 1 && <div className="flex flex-wrap gap-1.5">{task.attempts.map((candidate) => <Button key={candidate.id} onClick={() => setAttemptId(candidate.id)} size="xs" variant={candidate.id === attempt?.id ? 'secondary' : 'outline'}>Attempt {candidate.number}</Button>)}</div>}
    {attempt && <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-y py-3 text-[10px] sm:grid-cols-4"><Fact label="Model" value={attempt.model} /><Fact label="Attempt" value={String(attempt.number)} /><Fact label="Phase" value={attempt.phase || task.state} /><Fact label="Started" value={formatTime(attempt.dispatchedAt)} />{attempt.runAs && <Fact label="Run as" value={attempt.runAs} />}{attemptDuration != null && Number.isFinite(attemptDuration) && <Fact label="Elapsed" value={formatDuration(attemptDuration)} />}{turns.length > 0 && <><Fact label="Model turns" value={turns.length.toLocaleString()} /><Fact label="Tokens" value={`${inputTokens.toLocaleString()} in · ${outputTokens.toLocaleString()} out`} /></>}<div className="col-span-2 sm:col-span-4"><Fact label="Granted tools" value={attempt.tools?.join(', ') || 'None'} /></div></div>}
    {attempt ? <Conversation empty="The executor has not produced a message yet." messages={attempt.messages ?? []} mode="executor" status={active && (task.state === 'running' || task.state === 'dispatching') ? 'Task executor working' : undefined} /> : <p className="text-xs text-muted-foreground">This task has not been dispatched.</p>}
    {task.summary && !hasMatchingAssistantResult(attempt?.messages ?? [], task.summary) && <section className="border-t pt-4"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Accepted result</p><MarkdownContent className="mt-2 text-[11px]" content={task.summary} /></section>}
  </>;
}

function IterationOverview({ children, onSelect, task }: { children: MissionRuntimeTask[]; onSelect: (selection: Selection) => void; task: MissionRuntimeTask }) {
  const completed = children.filter((child) => child.state === 'completed').length;
  return <section className="space-y-4">
    <div><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Iteration progress</p><p className="mt-1 text-xs font-medium">{completed} of {children.length} task executions completed</p></div>
    {task.error && <p className="border-l-2 border-destructive px-3 text-[11px] text-destructive">{task.error}</p>}
    {children.length ? <div className="space-y-2">{children.map((child) => <button className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-[11px] hover:bg-accent/40" key={child.name} onClick={() => onSelect({ kind: 'task', name: child.name })} type="button"><span className="font-medium">{child.name}</span><span className="capitalize text-muted-foreground">{child.state.replaceAll('_', ' ')}</span></button>)}</div> : <p className="text-[11px] text-muted-foreground">Waiting for the dataset to expand into task executions.</p>}
    {task.summary && <details className="border-t pt-3 text-[11px]"><summary className="cursor-pointer font-medium">Combined result</summary><MarkdownContent className="mt-2" content={task.summary} /></details>}
  </section>;
}

function hasMatchingAssistantResult(messages: MissionRuntimeMessage[], summary: string): boolean {
  const accepted = summary.trim();
  const untruncated = accepted.endsWith('...') ? accepted.slice(0, -3).trimEnd() : accepted;
  return messages.some((message) => message.role === 'assistant' && message.parts.some((part) =>
    part.type === 'text' && (part.text?.trim() === accepted || (accepted.endsWith('...') && part.text?.trim().startsWith(untruncated)))));
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>; }

function Conversation({ empty, messages, mode, status }: { empty: string; messages: MissionRuntimeMessage[]; mode: 'commander' | 'executor'; status?: string }) {
  if (!messages.length) return status ? <WorkingIndicator label={status} /> : <p className="py-10 text-center text-xs text-muted-foreground">{empty}</p>;
  const results = new Map<string, MissionRuntimeContentPart>();
  const uses = new Set<string>();
  const media = new Map<string, MissionRuntimeContentPart[]>();
  messages.forEach((message) => message.parts.forEach((part) => { if (part.type === 'tool_result' && part.toolUseId) results.set(part.toolUseId, part); if (part.type === 'tool_use' && part.toolUseId) uses.add(part.toolUseId); if ((part.type === 'tool_image' || part.type === 'tool_document') && part.toolUseId) media.set(part.toolUseId, [...(media.get(part.toolUseId) ?? []), part]); }));
  return <div className="space-y-5">{messages.map((message, index) => {
    const snapshot = mode === 'commander' ? parseCommanderSnapshot(message) : null;
    const taskInput = mode === 'executor' ? executorInput(message) : null;
    const visibleParts = message.parts.filter((part) => !(part.toolUseId && uses.has(part.toolUseId) && ['tool_result', 'tool_image', 'tool_document'].includes(part.type)));
    if (!snapshot && !taskInput && !visibleParts.some((part) => ['text', 'thinking', 'tool_use', 'tool_result', 'image', 'document', 'tool_image', 'tool_document'].includes(part.type))) return null;
    if (snapshot) return <CommanderState key={message.id ?? index} snapshot={snapshot} />;
    if (taskInput) return <ExecutorInput key={message.id ?? index} input={taskInput} />;
    return <section className="space-y-2" key={message.id ?? index}>
    <div className="flex items-center gap-2 text-[9px] text-muted-foreground"><span className="font-semibold uppercase tracking-wider text-foreground">{message.role === 'assistant' ? mode === 'commander' ? 'Commander' : 'Task executor' : message.role}</span>{message.model?.model && <span>· {message.model.model}</span>}</div>
    {visibleParts.map((part, partIndex) => <ContentPart key={`${part.toolUseId ?? part.type}:${partIndex}`} media={part.toolUseId ? media.get(part.toolUseId) : undefined} mode={mode} part={part} result={part.toolUseId ? results.get(part.toolUseId) : undefined} skipResult={false} />)}
  </section>})}{status && <WorkingIndicator label={status} />}</div>;
}

function WorkingIndicator({ label }: { label: string }) {
  return <div aria-live="polite" className="flex items-center gap-3 py-2 text-[11px] text-muted-foreground"><Bot className="size-3.5 shrink-0" /><span className="runtime-working-shimmer rounded px-2 py-1">{label}</span></div>;
}

function CommanderState({ snapshot }: { snapshot: CommanderSnapshot }) {
  return <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Mission state · {snapshot.ready.length ? `${snapshot.ready.join(', ')} ready` : 'No tasks ready'}</summary><div className="mt-2 space-y-2 pl-3">{Object.keys(snapshot.stateCounts).length > 0 && <p>Task states: {Object.entries(snapshot.stateCounts).map(([state, count]) => `${count} ${state.replaceAll('_', ' ')}`).join(' · ')}</p>}{snapshot.completed.length > 0 && <p>Completed: {snapshot.completed.join(', ')}</p>}{Object.entries(snapshot.results).map(([task, result]) => result.Summary && <div key={task}><p className="font-medium">{task} result</p><MarkdownContent className="mt-1 text-[10px]" content={result.Summary} /></div>)}</div></details>;
}

type ExecutorInput = { objective: string; inputs: Record<string, unknown> };
function executorInput(message: MissionRuntimeMessage): ExecutorInput | null {
  if (message.role !== 'user' || message.parts.length !== 1 || message.parts[0].type !== 'text') return null;
  try {
    const value = objectValue(JSON.parse(message.parts[0].text || ''));
    if (typeof value.task !== 'string' || typeof value.objective !== 'string') return null;
    return { objective: value.objective, inputs: objectValue(value.inputs) };
  } catch { return null; }
}
function ExecutorInput({ input }: { input: ExecutorInput }) {
  return <section className="border-l-2 border-primary/60 bg-primary/5 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Task objective</p><MarkdownContent className="mt-1 text-[11px]" content={input.objective} />{Object.keys(input.inputs).length > 0 && <details className="mt-2 text-[10px]"><summary className="cursor-pointer">Task inputs</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-[10px]">{JSON.stringify(input.inputs, null, 2)}</pre></details>}</section>;
}

function ContentPart({ media, mode, part, result, skipResult }: { media?: MissionRuntimeContentPart[]; mode: 'commander' | 'executor'; part: MissionRuntimeContentPart; result?: MissionRuntimeContentPart; skipResult: boolean }) {
  if (skipResult) return null;
  if (part.type === 'text') return <MarkdownContent className="text-[11px] leading-5" content={part.text || ''} />;
  if (part.type === 'thinking') return <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">Reasoning</summary><MarkdownContent className="mt-2 pl-3 text-[11px]" content={part.text || ''} /></details>;
  if (part.type === 'tool_use') return <details className="border-l-2 border-border bg-muted/15 text-[10px]"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2"><Wrench className="size-3 text-muted-foreground" /><span className="font-medium">{mode === 'commander' ? 'Commander decision' : 'Tool call'} · {part.toolName || 'tool'}</span><span className="ml-auto text-muted-foreground">{result ? 'Completed' : 'In progress'}</span><ChevronDown className="size-3 text-muted-foreground" /></summary><div className="space-y-3 border-t px-3 py-3">{part.toolInputJson && <div><p className="mb-1 text-[9px] uppercase text-muted-foreground">Input</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px]">{prettyJSON(part.toolInputJson)}</pre></div>}{(result || media?.length) && <div className="border-t pt-3"><p className="mb-1 text-[9px] uppercase text-muted-foreground">Result</p>{result && <MarkdownContent className="text-[11px]" content={result.text || (result.isError ? 'Tool failed.' : 'Tool completed.')} />}{media?.map((attachment, index) => <ContentPart key={index} mode={mode} part={attachment} skipResult={false} />)}</div>}</div></details>;
  if (part.type === 'tool_result') return <div className="border-l-2 border-border px-3 text-[11px]"><MarkdownContent content={part.text || 'Tool completed.'} /></div>;
  if ((part.type === 'image' || part.type === 'tool_image') && part.imageData) return <img alt="Session attachment" className="max-h-80 max-w-full rounded border object-contain" src={`data:${part.imageMediaType || 'image/png'};base64,${part.imageData}`} />;
  if ((part.type === 'document' || part.type === 'tool_document') && part.documentData) return <a className="text-[10px] underline" download={part.documentFilename || 'document'} href={`data:${part.documentMediaType || 'application/octet-stream'};base64,${part.documentData}`}>{part.documentFilename || 'Download document'}</a>;
  return null;
}

function RuntimeTrace({ events, run, selection, task }: { events: RuntimeEvent[]; run: MissionRun; selection: Selection; task?: MissionRuntimeTask }) {
  const relevant = selection.kind === 'commander' ? events.filter((event) => event.eventType.startsWith('commander.') || event.eventType === 'task.dispatched' || event.eventType === 'route.selected' || event.eventType.startsWith('human_input.') || event.eventType.startsWith('mission.')) : events.filter((event) => event.taskName === selection.name || (event.eventType === 'mission.recovered' && recoveryAttempts(event).some((attempt) => attempt.taskName === selection.name)));
  return <><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Clock3 className="size-3" />{relevant.length} persisted events · mission clock started {formatTime(run.startedAt)}</div>{task?.attempts?.map((attempt) => <div className="border-l-2 border-primary/50 pl-3" key={attempt.id}><p className="text-[11px] font-medium">Attempt {attempt.number} · {attempt.model}</p><p className="mt-1 text-[10px] text-muted-foreground">{formatTime(attempt.dispatchedAt)} · {attempt.phase || task.state}</p>{attempt.toolOperations?.map((tool) => <p className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground" key={tool.toolUseId}><Wrench className="size-3" />{tool.toolName} · {tool.status.replaceAll('_', ' ')}</p>)}</div>)}<ol className="space-y-0 border-l border-border pl-4">{relevant.map((event) => <li className="relative py-2 text-[10px]" key={event.id}><span className="absolute -left-[1.17rem] top-3 size-1.5 rounded-full bg-primary" /><p className="font-medium">{humanizeEvent(event.eventType)}</p><p className="mt-0.5 text-muted-foreground">{formatTime(event.createdAt)}{event.attemptId ? ` · ${event.attemptId}` : ''}</p>{event.eventType === 'mission.recovered' && <p className="mt-1 text-muted-foreground">Last checkpoint {formatTime(stringValue(objectValue(event.data.Restart ?? event.data.restart).lastCheckpointAt))} · {arrayOfObjects(objectValue(event.data.Restart ?? event.data.restart).attempts).length} original task attempt(s) retained</p>}{event.eventType.startsWith('task.tool_replay_') && <p className="mt-1 text-muted-foreground">{stringValue(objectValue(event.data.ToolReplay ?? event.data.toolReplay).toolName)} · replay-safe invocation of the original tool call</p>}</li>)}</ol>{!relevant.length && <p className="py-8 text-center text-xs text-muted-foreground">No persisted events yet.</p>}</>;
}

function parseRuntimeEvent(event: MissionEventRecord): RuntimeEvent { let data: Record<string, unknown> = {}; try { data = objectValue(JSON.parse(event.dataJson)); } catch { /* malformed historical event remains visible by type */ } return { ...event, data, taskName: stringValue(data.TaskName ?? data.taskName), attemptId: stringValue(data.AttemptID ?? data.attemptId) }; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function arrayOfObjects(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(objectValue) : []; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function baseTaskName(value: string): string { return value.replace(/\[\d+\]$/, ''); }
function isIterationChild(name: string, parent: string): boolean { return name.startsWith(`${parent}[`) && baseTaskName(name) === parent; }
function iterationIndex(name: string): number { return Number(name.match(/\[(\d+)\]$/)?.[1] ?? 0); }
function prettyJSON(value: string): string { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function humanizeEvent(value: string): string { return value.replaceAll('.', ' ').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date); }
function formatDuration(milliseconds: number): string { const seconds = Math.max(0, Math.round(milliseconds / 1000)); return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`; }
