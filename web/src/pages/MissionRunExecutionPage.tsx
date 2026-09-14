import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, ArrowUpRight, Bot, Check, CheckCircle2, ChevronRight, CircleAlert, Clock3, ImageIcon, Maximize2, Minimize2, Wrench, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getMissionRun, getMissionRunEvents, getMissionTaskDetail, getWorkspaceConfig } from '@/api/client';
import type { MissionEventRecord, MissionInfo, MissionRunDetail, MissionTaskDetail, MissionTaskRun, TaskInfo } from '@/api/types';
import { MarkdownContent } from '@/components/MarkdownContent';
import { MissionGraph, type MissionTaskTelemetry } from '@/components/MissionGraph';
import { TaskTracePanel, type TraceEvent } from '@/components/RunExecutionTimeline';
import { cn } from '@/lib/utils';

export function MissionRunExecutionPage() {
  const { missionName = '', runId = '', workspaceId = '' } = useParams();
  const [selectedTaskName, setSelectedTaskName] = useState('');
  const snapshot = useQuery({ queryKey: ['workspace-config', workspaceId], queryFn: () => getWorkspaceConfig(workspaceId), enabled: Boolean(workspaceId), retry: false });
  const mission = snapshot.data?.config.missions.find((candidate) => candidate.name === missionName);
  const instanceId = snapshot.data?.instanceId ?? '';
  const detail = useQuery({
    queryKey: ['mission-run', instanceId, runId],
    queryFn: () => getMissionRun(instanceId, runId),
    enabled: Boolean(instanceId && runId),
    refetchInterval: (query) => query.state.data?.mission.status === 'running' ? 2_000 : false,
    retry: false,
  });
  const events = useQuery({
    queryKey: ['mission-run-events', instanceId, runId],
    queryFn: () => getMissionRunEvents(instanceId, runId),
    enabled: Boolean(instanceId && runId),
    refetchInterval: detail.data?.mission.status === 'running' ? 2_000 : false,
    retry: false,
  });
  const model = useMemo(() => mission && detail.data ? buildRunModel(mission, detail.data, events.data?.events ?? []) : undefined, [detail.data, events.data?.events, mission]);
  const selectedTask = model?.tasks.find((task) => task.name === selectedTaskName);

  if (snapshot.isLoading || detail.isLoading || events.isLoading) return <PageState text="Loading mission execution…" />;
  if (snapshot.isError || !snapshot.data?.connected) return <PageState text="Connect the workspace runner to inspect this mission run." />;
  if (!mission) return <PageState text={`Mission “${missionName}” was not found.`} />;
  if (detail.isError || events.isError || !model) return <PageState text="The runner could not load this run." />;

  const taskEvents = selectedTask ? model.events.filter((event) => event.taskId === selectedTask.record.id || eventTaskName(event) === selectedTask.name) : [];
  const backPath = `/w/${workspaceId}/missions/${encodeURIComponent(missionName)}/runs/${encodeURIComponent(runId)}`;

  function selectTask(task: TaskInfo) {
    setSelectedTaskName(task.name);
  }

  return <div className="-mx-4 -my-5 min-h-[calc(100vh-2rem)] bg-background sm:-mx-6 lg:-mx-8">
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link aria-label="Back to run telemetry" className="grid size-8 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" to={backPath}><ArrowLeft className="size-3.5" /></Link>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="truncate text-sm font-semibold">{humanize(mission.name)}</h1><Status status={model.status} /></div><p className="mt-0.5 truncate text-[10px] text-muted-foreground">Run {runId} · select a task to follow its work</p></div>
        <div className="flex gap-5 text-right"><HeaderMetric label="Tasks" value={`${model.completedTasks}/${model.tasks.length}`} /><HeaderMetric label="Elapsed" value={formatDuration(model.wallTimeMs)} /><HeaderMetric label="Model turns" value={formatNumber(model.turns)} /><HeaderMetric label="Cost" value={formatCost(model.totalCost)} /></div>
      </div>
    </header>
    <main className="mx-auto max-w-[100rem] px-4 py-5 sm:px-6 lg:px-8">
      <section className="relative h-[calc(100vh-8.5rem)] min-h-[38rem] overflow-hidden rounded-xl border bg-card">
        <div className="absolute left-4 top-4 z-20 max-w-[calc(100%-5rem)] rounded-lg border bg-background/92 px-3 py-2 shadow-sm backdrop-blur"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Mission canvas</p><p className="mt-1 truncate text-[10px]">{selectedTask ? <><strong>{humanize(selectedTask.name)}</strong> selected · choose another task at any time</> : 'Select a task to open its commander thread'}</p></div>
        <MissionGraph mission={mission} onSelectTask={selectTask} routeChoices={Object.fromEntries(model.routeChoices.map((choice) => [choice.source, choice.target]))} selectedTask={selectedTask?.name} telemetry={model.taskTelemetry} />
      </section>
    </main>
    {selectedTask && <MissionTaskConversationDrawer events={taskEvents} instanceId={instanceId} key={selectedTask.record.id} onClose={() => setSelectedTaskName('')} task={selectedTask} traceEvents={model.events} />}
  </div>;
}

export function MissionTaskConversationDrawer({ events, initialIterationIndex, instanceId, onClose, task, traceEvents = events }: { events: ParsedEvent[]; initialIterationIndex?: number; instanceId: string; onClose: () => void; task: TaskView; traceEvents?: TraceEvent[] }) {
  const [selectedAgentSession, setSelectedAgentSession] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'trace'>('chat');
  const [fullScreen, setFullScreen] = useState(false);
  const [selectedIterationIndex, setSelectedIterationIndex] = useState<number | 'all'>(initialIterationIndex ?? 'all');
  const taskDetail = useQuery({
    queryKey: ['mission-task-detail', instanceId, task.record.id],
    queryFn: () => getMissionTaskDetail(instanceId, task.record.id),
    enabled: Boolean(instanceId && task.record.id),
    refetchInterval: task.status === 'running' ? 2_000 : false,
    retry: false,
  });
  const iterations = useMemo(() => buildIterationViews(taskDetail.data, events, task), [events, task, taskDetail.data]);
  const visibleEvents = useMemo(() => selectedIterationIndex === 'all' ? events : filterIterationEvents(events, taskDetail.data, selectedIterationIndex), [events, selectedIterationIndex, taskDetail.data]);
  const visibleTraceEvents = useMemo(() => selectedIterationIndex === 'all' ? traceEvents : filterIterationEvents(traceEvents as ParsedEvent[], taskDetail.data, selectedIterationIndex), [selectedIterationIndex, taskDetail.data, traceEvents]);
  const visibleDetail = useMemo(() => selectedIterationIndex === 'all' ? taskDetail.data : filterIterationDetail(taskDetail.data, selectedIterationIndex), [selectedIterationIndex, taskDetail.data]);
  const selectedIteration = selectedIterationIndex === 'all' ? undefined : iterations.find((iteration) => iteration.index === selectedIterationIndex);
  const selectedDelegation = buildDelegations(visibleEvents).find((delegation) => delegation.sessionId === selectedAgentSession);
  const selectIteration = (value: number | 'all') => { setSelectedAgentSession(''); setSelectedIterationIndex(value); };
  const traceTask = selectedIteration ? iterationTaskRecord(task.record, selectedIteration) : task.record;
  const aggregateTask: TaskView = iterations.length > 1 ? { ...task, turns: iterations.reduce((total, iteration) => total + iteration.turns, 0) } : task;
  const visibleTask: TaskView = selectedIteration ? { ...aggregateTask, record: traceTask, status: selectedIteration.status, durationMs: selectedIteration.end - selectedIteration.start, turns: selectedIteration.turns, summary: undefined } : aggregateTask;
  const trace = selectedIterationIndex === 'all' && iterations.length > 1
    ? <IterationTraceOverview iterations={iterations} onSelect={selectIteration} />
    : <TaskTracePanel events={visibleTraceEvents} onSelectedAgentSessionIdChange={setSelectedAgentSession} selectedAgentSessionId={selectedAgentSession} task={traceTask} />;

  return <TaskConversationDrawer
    agent={selectedDelegation}
    activeTab={activeTab}
    detail={visibleDetail}
    events={visibleEvents}
    fullScreen={fullScreen}
    loading={taskDetail.isLoading}
    onClose={onClose}
    onCloseAgent={() => setSelectedAgentSession('')}
    onOpenAgent={setSelectedAgentSession}
    onSelectIteration={selectIteration}
    onTabChange={setActiveTab}
    onToggleFullScreen={() => setFullScreen((value) => !value)}
    task={visibleTask}
    trace={trace}
    iterations={iterations}
    selectedIterationIndex={selectedIterationIndex}
  />;
}

function TaskConversationDrawer({ activeTab, agent, detail, events, fullScreen, iterations, loading, onClose, onCloseAgent, onOpenAgent, onSelectIteration, onTabChange, onToggleFullScreen, selectedIterationIndex, task, trace }: { activeTab: 'chat' | 'trace'; agent?: Delegation; detail?: MissionTaskDetail; events: ParsedEvent[]; fullScreen: boolean; iterations: IterationView[]; loading: boolean; onClose: () => void; onCloseAgent: () => void; onOpenAgent: (sessionId: string) => void; onSelectIteration: (value: number | 'all') => void; onTabChange: (tab: 'chat' | 'trace') => void; onToggleFullScreen: () => void; selectedIterationIndex: number | 'all'; task: TaskView; trace: React.ReactNode }) {
  const headerAgent = agent;
  return <aside aria-label={`${humanize(task.name)} task inspector`} className={cn('fixed !m-0 z-50 flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-2xl', fullScreen ? 'inset-3 w-auto sm:inset-4' : 'inset-y-3 right-3 w-[min(46rem,calc(100vw-1.5rem))] sm:inset-y-4 sm:right-4 sm:w-[min(46rem,calc(100vw-2rem))]')} role="dialog">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
      <div className={cn('grid size-8 shrink-0 place-items-center rounded-full border', headerAgent ? 'border-primary/30 bg-primary/10 text-primary' : 'bg-muted/40')}><Bot className="size-4" /></div>
      <div className="min-w-0 flex-1">
        {headerAgent ? <button className="flex max-w-full items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground" onClick={onCloseAgent}><span>{humanize(task.name)}</span>{selectedIterationIndex !== 'all' && <><ChevronRight className="size-2.5" /><span>{iterations.find((item) => item.index === selectedIterationIndex)?.label}</span></>}<ChevronRight className="size-2.5" /><span className="truncate">{headerAgent.agentName}</span></button> : <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{iterations.length > 1 ? `${iterations.length} ${task.definition.iterator?.parallel ? 'parallel' : 'sequential'} iterations` : 'Task inspector'}</p>}
        <div className="mt-0.5 flex items-center gap-2"><h2 className="truncate text-xs font-semibold">{headerAgent ? humanize(headerAgent.agentName) : selectedIterationIndex === 'all' ? humanize(task.name) : iterations.find((item) => item.index === selectedIterationIndex)?.label ?? humanize(task.name)}</h2><Status status={headerAgent?.status ?? (selectedIterationIndex === 'all' ? task.status : iterations.find((item) => item.index === selectedIterationIndex)?.status ?? task.status)} /></div>
      </div>
      <div className="hidden items-center gap-3 text-[9px] text-muted-foreground sm:flex"><span>{headerAgent ? headerAgent.turns : task.turns} turns</span><span>{formatDuration(headerAgent?.durationMs ?? task.durationMs)}</span>{headerAgent?.model && <span className="max-w-28 truncate">{headerAgent.model}</span>}</div>
      {headerAgent && <button aria-label="Return to commander" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onCloseAgent}><ArrowLeft className="size-3.5" /></button>}
      <button aria-label={fullScreen ? 'Exit expanded view' : 'Expand task inspector'} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onToggleFullScreen}>{fullScreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
      <button aria-label="Close task thread" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose}><X className="size-3.5" /></button>
    </header>
    <div aria-label="Task inspector view" className="flex shrink-0 border-b px-5" role="tablist">
      <button aria-selected={activeTab === 'chat'} className={cn('border-b-2 px-3 py-2.5 text-[10px] font-medium transition-colors', activeTab === 'chat' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => onTabChange('chat')} role="tab" type="button">Chat</button>
      <button aria-selected={activeTab === 'trace'} className={cn('border-b-2 px-3 py-2.5 text-[10px] font-medium transition-colors', activeTab === 'trace' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => onTabChange('trace')} role="tab" type="button">Trace</button>
    </div>
    {iterations.length > 1 && !agent && <IterationPicker iterations={iterations} onSelect={onSelectIteration} selected={selectedIterationIndex} />}
    <div className="min-h-0 flex-1 overflow-y-auto">{activeTab === 'trace' ? trace : agent ? <AgentConversation delegation={agent} detail={detail} events={events} /> : selectedIterationIndex === 'all' && iterations.length > 1 ? <IterationChatOverview iterations={iterations} loading={loading} onSelect={onSelectIteration} task={task} /> : <CommanderConversation detail={detail} events={events} loading={loading} onOpenAgent={onOpenAgent} task={task} />}</div>
  </aside>;
}

function IterationPicker({ iterations, onSelect, selected }: { iterations: IterationView[]; onSelect: (value: number | 'all') => void; selected: number | 'all' }) {
  return <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-5 py-2" aria-label="Iteration" role="tablist">
    <button aria-selected={selected === 'all'} className={cn('shrink-0 rounded-md px-2.5 py-1.5 text-[9px] transition-colors', selected === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')} onClick={() => onSelect('all')} role="tab" type="button">All</button>
    {iterations.map((iteration) => <button aria-selected={selected === iteration.index} className={cn('flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[9px] transition-colors', selected === iteration.index ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')} key={iteration.index} onClick={() => onSelect(iteration.index)} role="tab" type="button"><span className={cn('size-1.5 rounded-full', selected === iteration.index ? 'bg-primary-foreground' : statusDotClass(iteration.status))} />{iteration.label}</button>)}
  </div>;
}

function IterationChatOverview({ iterations, loading, onSelect, task }: { iterations: IterationView[]; loading: boolean; onSelect: (value: number | 'all') => void; task: TaskView }) {
  return <div className="mx-auto w-full max-w-3xl px-5 py-6">
    <div className="mb-6"><p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Iterated task</p><h3 className="mt-1 text-sm font-semibold">{humanize(task.name)}</h3><MarkdownContent className="mt-2 text-[10px] text-muted-foreground [&_p]:leading-5" content={task.definition.objective || task.definition.description || 'Complete this task for each dataset item.'} /></div>
    {loading ? <p className="py-8 text-center text-[10px] text-muted-foreground">Loading iteration sessions…</p> : <div className="space-y-2">{iterations.map((iteration) => <button className="group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/30" key={iteration.index} onClick={() => onSelect(iteration.index)} type="button"><span className={cn('size-2 shrink-0 rounded-full', statusDotClass(iteration.status))} /><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{iteration.label}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{iteration.objective || `Iteration ${iteration.index + 1}`} · {iteration.turns} commander turns · {iteration.delegations} delegation{iteration.delegations === 1 ? '' : 's'}</span></span><span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{formatDuration(iteration.end - iteration.start)}</span><ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></button>)}</div>}
  </div>;
}

function IterationTraceOverview({ iterations, onSelect }: { iterations: IterationView[]; onSelect: (value: number | 'all') => void }) {
  const start = Math.min(...iterations.map((iteration) => iteration.start));
  const end = Math.max(...iterations.map((iteration) => iteration.end), start + 1);
  return <section className="p-5"><div><h3 className="text-xs font-semibold">Iteration trace</h3><p className="mt-1 text-[10px] text-muted-foreground">Each branch is aligned to the same task clock. Select a branch to inspect its commander turns, tools, and delegated agents.</p></div><div className="mt-4 overflow-x-auto rounded-md bg-muted/20"><div className="min-w-[680px]"><div className="grid grid-cols-[14rem_minmax(28rem,1fr)] items-end bg-muted/20"><span className="px-4 py-2 text-[8px] uppercase tracking-wider text-muted-foreground">Iteration</span><span className="relative mr-4 h-7 text-[8px] tabular-nums text-muted-foreground"><span className="absolute bottom-2 left-0">0ms</span><span className="absolute bottom-2 right-0">{formatDuration(end - start)}</span></span></div>{iterations.map((iteration) => <button className="grid w-full grid-cols-[14rem_minmax(28rem,1fr)] items-center text-left transition-colors hover:bg-accent/40" key={iteration.index} onClick={() => onSelect(iteration.index)} type="button"><span className="min-w-0 px-4 py-2.5"><span className="flex items-center gap-2"><span className={cn('size-1.5 shrink-0 rounded-full', statusDotClass(iteration.status))} /><span className="truncate text-[10px] font-medium">{iteration.label}</span></span><span className="mt-0.5 block pl-3.5 text-[9px] text-muted-foreground">{iteration.turns} turns · {iteration.delegations} delegation{iteration.delegations === 1 ? '' : 's'}</span></span><span className="relative mr-4 h-8 overflow-hidden rounded-sm bg-muted/35"><span className="absolute inset-y-0 left-1/4 border-l border-border/60" /><span className="absolute inset-y-0 left-1/2 border-l border-border/60" /><span className="absolute inset-y-0 left-3/4 border-l border-border/60" /><span className={cn('absolute top-1/2 h-3 -translate-y-1/2 rounded-[2px]', iteration.status === 'failed' ? 'bg-destructive' : iteration.status === 'running' ? 'bg-primary animate-pulse' : 'bg-emerald-500')} style={waterfallBarStyle(iteration.start, iteration.end, start, end)} /></span></button>)}</div></div></section>;
}

function CommanderConversation({ detail, events, loading, onOpenAgent, task }: { detail?: MissionTaskDetail; events: ParsedEvent[]; loading: boolean; onOpenAgent: (sessionId: string) => void; task: TaskView }) {
  const items = buildCommanderTranscript(events, detail?.subtasks ?? [], detail?.toolResults ?? []);
  const objective = detail?.inputs?.[0]?.objective || task.definition.objective || task.definition.description || 'Complete this task.';
  const isWorking = task.status === 'running';
  return <div className="mx-auto w-full max-w-3xl px-5 py-6">
    <div className="mb-7 flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-xs text-primary-foreground"><p className="mb-1 text-[9px] font-medium uppercase tracking-wider opacity-70">Task objective</p><MarkdownContent className="[&_a]:text-current [&_blockquote]:text-current [&_code]:bg-primary-foreground/15 [&_p]:leading-5 [&_pre]:bg-primary-foreground/10" content={objective} /></div></div>
    {loading && <p className="py-6 text-center text-[10px] text-muted-foreground">Loading the commander’s plan…</p>}
    <div className="space-y-4">{items.map((item, index) => <TranscriptItemView item={item} key={`${item.type}-${item.id}-${index}`} onOpenAgent={onOpenAgent} />)}</div>
    {isWorking && !loading && <WorkingMessage label="Commander is working" />}
    {items.length === 0 && !loading && !isWorking && <div className="rounded-lg border border-dashed p-8 text-center"><Bot className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-xs font-medium">No commander transcript was persisted</p><p className="mt-1 text-[10px] text-muted-foreground">Task status and outputs are still available from the run record.</p></div>}
    {task.summary && <div className="mt-7 flex gap-3 border-t pt-6"><Avatar /><div className="min-w-0"><p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Commander summary</p><MarkdownContent className="mt-2 text-[11px] [&_p]:leading-5" content={task.summary} /></div></div>}
  </div>;
}

function AgentConversation({ delegation, detail, events }: { delegation: Delegation; detail?: MissionTaskDetail; events: ParsedEvent[] }) {
  const items = buildAgentTranscript(events, delegation, detail?.toolResults ?? []);
  const isWorking = delegation.status === 'running';
  return <div className="mx-auto w-full max-w-3xl px-5 py-6">
    <div className="mb-7 flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-xs text-primary-foreground"><p className="mb-1 text-[9px] font-medium uppercase tracking-wider opacity-70">Delegated by commander</p><MarkdownContent className="[&_a]:text-current [&_blockquote]:text-current [&_code]:bg-primary-foreground/15 [&_p]:leading-5 [&_pre]:bg-primary-foreground/10" content={delegation.instruction || 'Complete the delegated work and report back.'} /></div></div>
    <div className="mb-6 grid grid-cols-4 overflow-hidden rounded-lg border bg-muted/20"><MiniStat label="Turns" value={delegation.turns} /><MiniStat label="Tools" value={delegation.toolCalls} /><MiniStat label="Duration" value={formatDuration(delegation.durationMs)} /><MiniStat label="Cost" value={formatCost(delegation.cost)} /></div>
    <div className="space-y-4">{items.map((item, index) => <TranscriptItemView item={item} key={`${item.type}-${item.id}-${index}`} onOpenAgent={() => {}} />)}</div>
    {isWorking && <WorkingMessage label={`${humanize(delegation.agentName)} is working`} />}
    {items.length === 0 && !isWorking && <p className="rounded-lg border border-dashed p-8 text-center text-[10px] text-muted-foreground">This delegation has no persisted message events.</p>}
  </div>;
}

function WorkingMessage({ label }: { label: string }) {
  return <div aria-label={label} aria-live="polite" className="mt-5 flex items-center gap-3" role="status">
    <Avatar />
    <span className="ai-working-shimmer text-[11px] font-medium">{label}…</span>
  </div>;
}

function TranscriptItemView({ item, onOpenAgent }: { item: TranscriptItem; onOpenAgent: (sessionId: string) => void }) {
  if (item.type === 'reasoning') return <details className="group ml-10 py-1"><summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"><Activity className="size-3" /><span>Reasoning</span><span className="text-[9px] tabular-nums">{item.durationMs ? formatDuration(item.durationMs) : ''}</span><ChevronRight className="size-3 transition-transform group-open:rotate-90" /></summary><MarkdownContent className="mt-2 pl-5 text-[10px] text-muted-foreground [&_p]:leading-5" content={item.content} /></details>;
  if (item.type === 'answer') return <div className="flex gap-3"><Avatar /><div className="min-w-0 flex-1 pt-1"><MarkdownContent className="text-[11px] [&_p]:leading-5" content={item.content} /></div></div>;
  if (item.type === 'plan') {
    const completed = item.subtasks.filter((subtask) => subtask.status === 'completed').length;
    return <section className="ml-10 overflow-hidden rounded-lg border bg-muted/20">
      <div className="flex items-center gap-2 border-b px-3 py-2.5 text-[10px] font-medium"><CheckCircle2 className="size-3.5 text-muted-foreground" /><span className="flex-1">Commander plan</span><span className="text-[9px] text-muted-foreground">{completed}/{item.subtasks.length}</span></div>
      <div className="px-3 py-2">{item.subtasks.map((subtask) => <div className="flex items-start gap-2 py-1.5 text-[10px]" key={`${subtask.sessionId}-${subtask.iterationIndex ?? 'task'}-${subtask.index}`}><span className={cn('mt-0.5 grid size-3.5 place-items-center rounded-full border', subtask.status === 'completed' && 'border-emerald-500 bg-emerald-500 text-white')}>{subtask.status === 'completed' && <Check className="size-2.5" />}</span><span className={cn('leading-4', subtask.status === 'completed' ? 'text-muted-foreground' : 'font-medium')}>{subtask.title}</span></div>)}</div>
      {(item.input || item.result) && <details className="group border-t"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[9px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"><Wrench className="size-3" /><span className="flex-1">set_subtasks</span><span className="tabular-nums">{item.durationMs ? formatDuration(item.durationMs) : ''}</span><ChevronRight className="size-3 transition-transform group-open:rotate-90" /></summary><div className="divide-y border-t px-3"><ToolValue label="Input" value={item.input} /><ToolValue label="Result" value={item.result} /></div></details>}
    </section>;
  }
  if (item.type === 'delegation') return <button className="group ml-10 flex w-[calc(100%-2.5rem)] items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/10" onClick={() => onOpenAgent(item.delegation.sessionId)}><div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Bot className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[9px] font-medium uppercase tracking-wider text-primary">Agent delegation</span><Status status={item.delegation.status} /></div><p className="mt-1 text-[11px] font-semibold">{humanize(item.delegation.agentName)}</p><div className="mt-1 max-h-10 overflow-hidden text-[10px] text-muted-foreground"><MarkdownContent allowLinks={false} className="[&_p]:leading-4" content={item.delegation.instruction || 'Delegated work'} /></div><div className="mt-2 flex gap-3 text-[9px] text-muted-foreground"><span>{item.delegation.turns} turns</span><span>{item.delegation.toolCalls} tools</span><span>{formatDuration(item.delegation.durationMs)}</span></div></div><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></button>;
  if (item.type === 'tool') return <details className="group ml-10 rounded-lg border bg-muted/20"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden"><Wrench className="size-3.5 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium">{item.toolName}</p><p className="mt-0.5 text-[9px] text-muted-foreground">Tool call · {item.result ? 'completed' : 'running'}</p></div><span className="text-[9px] tabular-nums text-muted-foreground">{item.durationMs ? formatDuration(item.durationMs) : ''}</span><ChevronRight className="size-3 text-muted-foreground transition-transform group-open:rotate-90" /></summary><div className="divide-y border-t px-3"><ToolValue label="Input" value={item.input} /><ToolValue label="Result" media={item.media} value={item.result} /></div></details>;
  return <div className="ml-10 rounded-lg border border-dashed px-3 py-2.5 text-[10px] text-muted-foreground"><span className="font-medium text-foreground">{item.label}</span><MarkdownContent className="mt-1 [&_p]:leading-4" content={item.content} /></div>;
}

function ToolValue({ label, value, media = [] }: { label: string; value: string; media?: ToolImage[] }) {
  const display = parseToolValue(value);
  const status = display.metadata.find(([key]) => key.toLowerCase() === 'status')?.[1];
  const metadata = display.metadata.filter(([key]) => !['status', 'task'].includes(key.toLowerCase()));
  const valueIsMediaPlaceholder = media.length > 0 && (value.trim() === '[image]' || value.trim() === '');
  return <section className="py-3">
    <div className="flex items-center gap-2"><p className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>{status && <span className={cn('text-[9px] capitalize', status === 'success' ? 'text-emerald-700 dark:text-emerald-300' : status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{status}</span>}</div>
    <div className="mt-2 max-h-80 overflow-auto">
      {!value && media.length === 0 ? <p className="text-[10px] text-muted-foreground">Waiting for a result…</p> : <>
        {metadata.length > 0 && <dl className="mb-4 flex flex-wrap gap-x-5 gap-y-2">{metadata.map(([key, metadataValue]) => <div className="flex items-baseline gap-2" key={key}><dt className="text-[8px] uppercase tracking-wider text-muted-foreground">{key}</dt><dd className="text-[10px] font-medium">{metadataValue}</dd></div>)}</dl>}
        {!valueIsMediaPlaceholder && <StructuredToolValue value={display.value} />}
        {media.length > 0 && <div className={cn('space-y-3', !valueIsMediaPlaceholder && 'mt-3')}>{media.map((attachment, index) => <ToolImagePreview key={`${attachment.src.slice(0, 64)}-${index}`} {...attachment} />)}</div>}
      </>}
    </div>
    {value && <details className="group/raw mt-2"><summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[9px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"><ChevronRight className="size-3 transition-transform group-open/raw:rotate-90" />{label === 'Result' ? 'Raw tool response' : 'Raw tool input'}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/35 p-3 text-[9px] leading-4 text-muted-foreground">{prettyJSON(value)}</pre></details>}
  </section>;
}

function StructuredToolValue({ value }: { value: unknown }) {
  if (value == null) return <span className="text-[10px] text-muted-foreground">null</span>;
  const image = toolImage(value);
  if (image) return <ToolImagePreview {...image} />;
  if (typeof value === 'string') return <MarkdownContent className="text-[10px] text-muted-foreground [&_p]:leading-5" content={normalizeEmbeddedMarkdown(value)} />;
  if (typeof value === 'number' || typeof value === 'boolean') return <code className="text-[10px]">{String(value)}</code>;
  if (Array.isArray(value)) return <ol className="list-decimal space-y-2 pl-5 text-[10px]">{value.map((entry, index) => <li className="pl-1" key={index}><StructuredToolValue value={entry} /></li>)}</ol>;
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-[10px] text-muted-foreground">Empty object</span>;
    return <dl className="space-y-4">{entries.map(([key, entry]) => isCompactToolValue(entry)
      ? <div className="flex items-baseline gap-3" key={key}><dt className="shrink-0 text-[8px] font-medium uppercase tracking-wider text-muted-foreground">{humanize(key)}</dt><dd className="min-w-0 break-words text-[10px] font-medium">{compactToolValue(entry)}</dd></div>
      : <div key={key}><dt className="text-[8px] font-medium uppercase tracking-wider text-muted-foreground">{humanize(key)}</dt><dd className="mt-2 min-w-0 text-[10px]"><StructuredToolValue value={entry} /></dd></div>)}</dl>;
  }
  return <span className="text-[10px] text-muted-foreground">{String(value)}</span>;
}

function ToolImagePreview({ mediaType, src }: { mediaType: string; src: string }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <button aria-label="Expand image preview" className="group/image relative block h-64 w-full overflow-hidden rounded-lg border bg-muted/25 p-2 text-left" onClick={() => setExpanded(true)} type="button">
      <img alt="Tool output preview" className="h-full w-full rounded object-cover object-top" src={src} />
      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 text-[8px] uppercase tracking-wider text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100"><Maximize2 className="size-3" />Expand</span>
    </button>
    <div className="mt-2 flex items-center gap-1.5 text-[8px] uppercase tracking-wider text-muted-foreground"><ImageIcon className="size-3" />{mediaType}</div>
    {expanded && <div aria-label="Image preview" className="fixed inset-3 z-[80] flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:inset-4" role="dialog">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4"><ImageIcon className="size-4 text-muted-foreground" /><span className="flex-1 text-[10px] font-medium">{mediaType}</span><button aria-label="Close image preview" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setExpanded(false)} type="button"><X className="size-4" /></button></header>
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-muted/25 p-4"><img alt="Expanded tool output" className="max-h-full max-w-full object-contain" src={src} /></div>
    </div>}
  </>;
}

function toolImage(value: unknown): { mediaType: string; src: string } | undefined {
  if (typeof value === 'string') {
    const match = /^data:(image\/(?:png|jpe?g|gif|webp|avif));base64,([a-z0-9+/=\s]+)$/i.exec(value.trim());
    if (match) return { mediaType: match[1].toLowerCase(), src: `data:${match[1]};base64,${match[2].replace(/\s/g, '')}` };
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const mediaType = [value.mediaType, value.media_type, value.mimeType, value.mime_type].find((entry): entry is string => typeof entry === 'string' && /^image\/(?:png|jpe?g|gif|webp|avif)$/i.test(entry));
  const data = [value.data, value.imageData, value.image_data, value.base64].find((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  if (!mediaType || !data) return undefined;
  const direct = toolImage(data);
  return direct ?? { mediaType: mediaType.toLowerCase(), src: `data:${mediaType};base64,${data.replace(/\s/g, '')}` };
}

function parseToolValue(value: string): { metadata: Array<[string, string]>; value: unknown } {
  const trimmed = value.trim();
  if (!trimmed) return { metadata: [], value: '' };
  const parsed = parseJSONValue(trimmed);
  if (parsed.ok) return { metadata: [], value: parsed.value };

  const outputMarker = /\n\s*Output:\s*\n/i.exec(trimmed);
  if (!outputMarker) return { metadata: [], value: trimmed };
  const prefix = trimmed.slice(0, outputMarker.index).trim();
  const output = trimmed.slice(outputMarker.index + outputMarker[0].length).trim();
  const metadata = prefix.split(/\r?\n/).map((line) => /^([^:]+):\s*(.*)$/.exec(line)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => [match[1].trim(), match[2].trim()] as [string, string]);
  const parsedOutput = parseJSONValue(output);
  return { metadata, value: parsedOutput.ok ? parsedOutput.value : output };
}

function parseJSONValue(value: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(value) }; } catch { return { ok: false }; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isCompactToolValue(value: unknown) { return value == null || typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 80 && !value.includes('\n')); }
function compactToolValue(value: unknown) { return value == null ? 'null' : String(value); }
function normalizeEmbeddedMarkdown(value: string) {
  const trimmed = value.trim();
  return /^1\.\s/.test(trimmed) && /\s2\.\s/.test(trimmed) ? trimmed.replace(/\s+(?=\d+\.\s)/g, '\n') : value;
}
function Avatar() { return <div className="grid size-7 shrink-0 place-items-center rounded-full border bg-muted/40"><Bot className="size-3.5" /></div>; }

export type ParsedEvent = MissionEventRecord & { data: Record<string, unknown> };
export type TaskView = { name: string; definition: TaskInfo; record: MissionTaskRun; status: string; durationMs?: number; summary?: string; outputJson?: string; turns: number; toolCalls: number; agentStarts: number; cost: number };
type Delegation = { sessionId: string; agentName: string; instruction: string; status: string; startedAt: string; durationMs?: number; turns: number; toolCalls: number; model: string; cost: number };
type IterationView = { index: number; label: string; objective: string; status: string; start: number; end: number; turns: number; delegations: number };
type ToolImage = { mediaType: string; src: string };
type TranscriptItem =
  | { type: 'reasoning'; id: string; content: string; durationMs?: number }
  | { type: 'answer'; id: string; content: string }
  | { type: 'plan'; id: string; subtasks: MissionTaskDetail['subtasks']; input: string; result: string; durationMs?: number }
  | { type: 'tool'; id: string; toolName: string; input: string; result: string; media: ToolImage[]; durationMs?: number }
  | { type: 'delegation'; id: string; delegation: Delegation }
  | { type: 'note'; id: string; label: string; content: string };
type PersistedToolResult = MissionTaskDetail['toolResults'][number];

function buildIterationViews(detail: MissionTaskDetail | undefined, events: ParsedEvent[], task: TaskView): IterationView[] {
  if (!task.definition.iterator) return [];
  const indices = new Set<number>();
  detail?.datasetItems?.forEach((item) => indices.add(item.index));
  detail?.inputs.forEach((input) => { if (typeof input.iterationIndex === 'number') indices.add(input.iterationIndex); });
  detail?.sessions.forEach((session) => { if (typeof session.iterationIndex === 'number') indices.add(session.iterationIndex); });
  events.forEach((event) => {
    if (typeof event.iterationIndex === 'number') indices.add(event.iterationIndex);
    else if ((event.eventType === 'iteration_started' || event.eventType === 'iteration_completed' || event.eventType === 'iteration_failed') && typeof event.data.index === 'number') indices.add(event.data.index);
  });
  const announcedTotal = events.find((event) => event.eventType === 'task_iteration_started');
  const total = numberValue(announcedTotal?.data.totalItems);
  for (let index = 0; index < total; index += 1) indices.add(index);
  return [...indices].sort((a, b) => a - b).map((index) => {
    const scoped = filterIterationEvents(events, detail, index);
    const lifecycle = scoped.filter((event) => event.eventType === 'iteration_started' || event.eventType === 'iteration_completed' || event.eventType === 'iteration_failed').sort(eventTimeSort);
    const sessions = detail?.sessions.filter((session) => session.iterationIndex === index) ?? [];
    const timeValues = [...lifecycle.map((event) => Date.parse(event.createdAt)), ...sessions.flatMap((session) => [Date.parse(session.startedAt), session.finishedAt ? Date.parse(session.finishedAt) : Number.NaN])].filter(Number.isFinite);
    const taskStart = validTimestamp(task.record.startedAt) ? Date.parse(task.record.startedAt!) : Date.now();
    const start = timeValues.length ? Math.min(...timeValues) : taskStart;
    const terminal = [...lifecycle].reverse().find((event) => event.eventType === 'iteration_completed' || event.eventType === 'iteration_failed');
    const finishValues = terminal ? [Date.parse(terminal.createdAt)] : sessions.map((session) => session.finishedAt ? Date.parse(session.finishedAt) : Number.NaN).filter(Number.isFinite);
    const end = finishValues.length ? Math.max(start, ...finishValues) : task.status === 'running' ? Date.now() : Math.max(start, validTimestamp(task.record.finishedAt) ? Date.parse(task.record.finishedAt!) : start + 1);
    const status = terminal?.eventType === 'iteration_failed' ? 'failed' : terminal?.eventType === 'iteration_completed' ? 'completed' : sessions.some((session) => session.status === 'failed') ? 'failed' : sessions.length && sessions.every((session) => session.status === 'completed') ? 'completed' : 'running';
    const datasetItem = detail?.datasetItems?.find((item) => item.index === index);
    const objective = detail?.inputs.find((input) => input.iterationIndex === index)?.objective || textValue(lifecycle.find((event) => event.eventType === 'iteration_started')?.data.objective);
    return {
      index,
      label: datasetItemLabel(datasetItem?.itemJson, index),
      objective,
      status,
      start,
      end,
      turns: scoped.filter((event) => event.eventType === 'session_turn' && textValue(event.data.entity).toLowerCase() === 'commander').length,
      delegations: scoped.filter((event) => event.eventType === 'agent_started').length,
    };
  });
}

function filterIterationEvents(events: ParsedEvent[], detail: MissionTaskDetail | undefined, index: number) {
  const sessionIds = new Set(detail?.sessions.filter((session) => session.iterationIndex === index).map((session) => session.id) ?? []);
  return events.filter((event) => event.iterationIndex === index || (typeof event.data.index === 'number' && event.data.index === index && event.eventType.startsWith('iteration_')) || sessionIds.has(event.sessionId || textValue(event.data.sessionId)));
}

function filterIterationDetail(detail: MissionTaskDetail | undefined, index: number): MissionTaskDetail | undefined {
  if (!detail) return undefined;
  const sessions = detail.sessions.filter((session) => session.iterationIndex === index);
  const sessionIds = new Set(sessions.map((session) => session.id));
  return {
    ...detail,
    sessions,
    inputs: detail.inputs.filter((input) => input.iterationIndex === index),
    outputs: detail.outputs.filter((output) => output.datasetIndex == null || output.datasetIndex === index),
    subtasks: detail.subtasks.filter((subtask) => subtask.iterationIndex === index || sessionIds.has(subtask.sessionId)),
    toolResults: detail.toolResults.filter((result) => sessionIds.has(result.sessionId)),
  };
}

function iterationTaskRecord(task: MissionTaskRun, iteration: IterationView): MissionTaskRun {
  return { ...task, status: iteration.status, startedAt: new Date(iteration.start).toISOString(), finishedAt: iteration.status === 'running' ? undefined : new Date(iteration.end).toISOString() };
}

function datasetItemLabel(itemJson: string | undefined, index: number) {
  if (!itemJson) return `Iteration ${index + 1}`;
  try {
    const value = JSON.parse(itemJson) as unknown;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (isRecord(value)) {
      for (const key of ['label', 'name', 'value', 'id', 'key', 'word']) {
        const candidate = value[key];
        if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
      }
      const primitive = Object.values(value).find((candidate) => typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean');
      if (primitive != null) return String(primitive);
    }
  } catch { /* Fall back to the stable iteration number. */ }
  return `Iteration ${index + 1}`;
}

function waterfallBarStyle(start: number, end: number, timelineStart: number, timelineEnd: number) {
  const duration = Math.max(1, timelineEnd - timelineStart);
  const left = Math.max(0, Math.min(100, (start - timelineStart) / duration * 100));
  const right = Math.max(left, Math.min(100, (end - timelineStart) / duration * 100));
  return { left: `${left}%`, minWidth: '6px', width: `${Math.max(0.45, right - left)}%` };
}

function statusDotClass(status: string) { return status === 'completed' ? 'bg-emerald-500' : status === 'failed' ? 'bg-destructive' : status === 'running' ? 'bg-primary animate-pulse' : 'bg-muted-foreground/50'; }
function validTimestamp(value?: string) { return Boolean(value && Number.isFinite(Date.parse(value))); }

function buildRunModel(mission: MissionInfo, detail: MissionRunDetail, rawEvents: MissionEventRecord[]) {
  const events: ParsedEvent[] = rawEvents.map((event) => ({ ...event, data: parseObject(event.dataJson) }));
  const taskNameById = new Map(detail.tasks.map((record) => [record.id, record.taskName]));
  const taskEvents = new Map<string, ParsedEvent[]>();
  events.forEach((event) => { const name = taskNameById.get(event.taskId ?? '') || eventTaskName(event); if (name) taskEvents.set(name, [...(taskEvents.get(name) ?? []), event]); });
  const recordByName = new Map(detail.tasks.map((record) => [record.taskName, record]));
  const tasks: TaskView[] = (mission.tasks ?? []).map((definition) => {
    const record = recordByName.get(definition.name) ?? { id: definition.name, missionId: detail.mission.id, taskName: definition.name, status: 'pending' };
    const scoped = taskEvents.get(definition.name) ?? [];
    const turns = scoped.filter((event) => event.eventType === 'session_turn');
    return { name: definition.name, definition, record, status: record.status, durationMs: timestampDuration(record.startedAt, record.finishedAt), summary: record.summary, outputJson: record.outputJson, turns: turns.length, toolCalls: scoped.filter(isToolCall).length, agentStarts: scoped.filter((event) => event.eventType === 'agent_started').length, cost: sumEventData(turns, 'cost') };
  });
  const turns = events.filter((event) => event.eventType === 'session_turn');
  const routeChoices = events.filter((event) => event.eventType === 'route_chosen').map((event) => ({ source: textValue(event.data.routerTask) || textValue(event.data.task), target: stripRef(textValue(event.data.targetTask) || textValue(event.data.target)) })).filter((choice) => choice.source && choice.target);
  const taskTelemetry: Record<string, MissionTaskTelemetry> = Object.fromEntries(tasks.map((task) => [task.name, { status: task.status, error: task.record.error, durationMs: task.durationMs }]));
  return { mission, detail, status: detail.mission.status, events, tasks, routeChoices, taskTelemetry, wallTimeMs: timestampDuration(detail.mission.startedAt, detail.mission.finishedAt) ?? 0, completedTasks: tasks.filter((task) => task.status === 'completed').length, turns: turns.length, totalCost: sumEventData(turns, 'cost') };
}

function buildDelegations(events: ParsedEvent[]) {
  const sorted = [...events].sort(eventTimeSort);
  const seen = new Set<string>();
  const delegations: Delegation[] = [];
  sorted.filter((event) => event.eventType === 'agent_started').forEach((start) => {
    const agentName = textValue(start.data.agentName) || 'agent';
    const sessionId = delegationKey(start);
    if (seen.has(sessionId)) return;
    seen.add(sessionId);
    const related = sorted.filter((event) => event.sessionId === start.sessionId || (!start.sessionId && textValue(event.data.agentName) === agentName));
    const completed = related.find((event) => event.eventType === 'agent_completed' && Date.parse(event.createdAt) >= Date.parse(start.createdAt));
    const last = completed ?? related[related.length - 1] ?? start;
    const turns = related.filter((event) => event.eventType === 'session_turn' && textValue(event.data.entity) !== 'commander');
    delegations.push({ sessionId, agentName, instruction: textValue(start.data.instruction), status: completed ? 'completed' : 'running', startedAt: start.createdAt, durationMs: durationBetween(start.createdAt, last.createdAt), turns: turns.length, toolCalls: related.filter((event) => event.eventType === 'agent_calling_tool').length, model: textValue(turns[turns.length - 1]?.data.model), cost: sumEventData(turns, 'cost') });
  });
  return delegations;
}

function buildCommanderTranscript(events: ParsedEvent[], subtasks: MissionTaskDetail['subtasks'], toolResults: PersistedToolResult[]): TranscriptItem[] {
  const sorted = [...events].sort(eventTimeSort);
  const delegationBySession = new Map(buildDelegations(sorted).map((delegation) => [delegation.sessionId, delegation]));
  const seenDelegations = new Set<string>();
  const pendingTools = new Map<string, { index: number; startedAt: string }>();
  const items: TranscriptItem[] = [];
  let reasoningStartedAt = '';
  sorted.forEach((event) => {
    if (event.eventType === 'commander_reasoning_started') reasoningStartedAt = event.createdAt;
    if (event.eventType === 'commander_reasoning_completed') { const content = textValue(event.data.content); if (content) items.push({ type: 'reasoning', id: event.id, content, durationMs: durationBetween(reasoningStartedAt, event.createdAt) }); reasoningStartedAt = ''; }
    if (event.eventType === 'commander_calling_tool') {
      const toolName = textValue(event.data.toolName);
      if (toolName === 'call_agent') return;
      const id = textValue(event.data.toolCallId) || event.id;
      const persisted = findPersistedToolResult(toolResults, event, id);
      pendingTools.set(id, { index: items.length, startedAt: event.createdAt });
      if (toolName === 'set_subtasks') items.push({ type: 'plan', id, subtasks, input: persisted?.inputParams ?? textValue(event.data.input), result: '' });
      else items.push({ type: 'tool', id, toolName: toolName || 'Tool', input: persisted?.inputParams ?? textValue(event.data.input), result: '', media: toolImagesFromPersisted(persisted) });
    }
    if (event.eventType === 'commander_tool_complete') completeTool(items, pendingTools, event, toolResults);
    if (event.eventType === 'agent_started') { const key = delegationKey(event); const delegation = delegationBySession.get(key); if (delegation && !seenDelegations.has(key)) { seenDelegations.add(key); items.push({ type: 'delegation', id: event.id, delegation }); } }
    if (event.eventType === 'commander_answer') { const content = textValue(event.data.content); if (content) items.push({ type: 'answer', id: event.id, content }); }
    if (event.eventType === 'compaction' && textValue(event.data.entity) === 'commander') items.push({ type: 'note', id: event.id, label: 'Context compacted', content: `${formatNumber(numberValue(event.data.messagesCompacted))} earlier messages were compacted to keep the commander within its context window.` });
  });
  if (subtasks.length > 0 && !items.some((item) => item.type === 'plan')) items.unshift({ type: 'plan', id: 'persisted-plan', subtasks, input: '', result: '' });
  return items;
}

function buildAgentTranscript(events: ParsedEvent[], delegation: Delegation, toolResults: PersistedToolResult[]): TranscriptItem[] {
  const sorted = events.filter((event) => event.sessionId === delegation.sessionId || (!event.sessionId && textValue(event.data.agentName) === delegation.agentName)).sort(eventTimeSort);
  const pendingTools = new Map<string, { index: number; startedAt: string }>();
  const items: TranscriptItem[] = [];
  let reasoningStartedAt = '';
  sorted.forEach((event) => {
    if (event.eventType === 'agent_reasoning_started') reasoningStartedAt = event.createdAt;
    if (event.eventType === 'agent_reasoning_completed') { const content = textValue(event.data.content); if (content) items.push({ type: 'reasoning', id: event.id, content, durationMs: durationBetween(reasoningStartedAt, event.createdAt) }); reasoningStartedAt = ''; }
    if (event.eventType === 'agent_calling_tool') { const id = textValue(event.data.toolCallId) || event.id; const persisted = findPersistedToolResult(toolResults, event, id); pendingTools.set(id, { index: items.length, startedAt: event.createdAt }); items.push({ type: 'tool', id, toolName: textValue(event.data.toolName) || 'Tool', input: persisted?.inputParams ?? textValue(event.data.payload), result: '', media: toolImagesFromPersisted(persisted) }); }
    if (event.eventType === 'agent_tool_complete') completeTool(items, pendingTools, event, toolResults);
    if (event.eventType === 'agent_answer') { const content = textValue(event.data.content); if (content) items.push({ type: 'answer', id: event.id, content }); }
    if (event.eventType === 'agent_ask_commander') items.push({ type: 'note', id: event.id, label: 'Asked commander', content: textValue(event.data.content) });
    if (event.eventType === 'agent_commander_response') items.push({ type: 'note', id: event.id, label: 'Commander replied', content: textValue(event.data.content) });
    if (event.eventType === 'compaction') items.push({ type: 'note', id: event.id, label: 'Context compacted', content: `${formatNumber(numberValue(event.data.messagesCompacted))} earlier messages were compacted.` });
  });
  return items;
}

function completeTool(items: TranscriptItem[], pendingTools: Map<string, { index: number; startedAt: string }>, event: ParsedEvent, toolResults: PersistedToolResult[]) {
  const id = textValue(event.data.toolCallId) || event.id;
  const pending = pendingTools.get(id);
  if (!pending) return;
  const item = items[pending.index];
  const persisted = findPersistedToolResult(toolResults, event, id);
  const result = persisted?.output ?? textValue(event.data.result);
  if (item?.type === 'tool' || item?.type === 'plan') items[pending.index] = { ...item, result, durationMs: durationBetween(pending.startedAt, event.createdAt) };
  pendingTools.delete(id);
}

function findPersistedToolResult(toolResults: PersistedToolResult[], event: ParsedEvent, toolCallId: string) {
  return toolResults.find((result) => result.toolCallId === toolCallId && (!event.sessionId || result.sessionId === event.sessionId));
}

function toolImagesFromPersisted(result?: PersistedToolResult): ToolImage[] {
  return (result?.media ?? [])
    .filter((media) => media.kind === 'image' && /^image\//i.test(media.mediaType) && media.data)
    .map((media) => ({ mediaType: media.mediaType, src: `data:${media.mediaType};base64,${media.data}` }));
}

function HeaderMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground">{label}</p></div>; }
function MiniStat({ label, value }: { label: string; value: React.ReactNode }) { return <div className="border-l p-3 first:border-l-0"><p className="text-[11px] font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground">{label}</p></div>; }
function Status({ status }: { status: string }) { const Icon = status === 'completed' ? CheckCircle2 : status === 'failed' ? CircleAlert : status === 'running' ? Activity : Clock3; return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] capitalize text-muted-foreground', status === 'completed' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', status === 'failed' && 'border-destructive/30 bg-destructive/10 text-destructive', status === 'running' && 'border-primary/30 bg-primary/10 text-primary')}><Icon className="size-2.5" />{status}</span>; }
function PageState({ text }: { text: string }) { return <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">{text}</div>; }

function isToolCall(event: ParsedEvent) { return event.eventType === 'agent_calling_tool' || event.eventType === 'commander_calling_tool'; }
function sumEventData(events: ParsedEvent[], key: string) { return events.reduce((total, event) => total + numberValue(event.data[key]), 0); }
function eventTaskName(event: ParsedEvent) { return textValue(event.data.taskName) || textValue(event.data.task); }
function delegationKey(event: ParsedEvent) { return event.sessionId || `${textValue(event.data.agentName) || 'agent'}:${event.id}`; }
function eventTimeSort(a: ParsedEvent, b: ParsedEvent) { return Date.parse(a.createdAt) - Date.parse(b.createdAt); }
function durationBetween(start?: string, finish?: string) { if (!start || !finish) return undefined; const value = Date.parse(finish) - Date.parse(start); return Number.isFinite(value) && value >= 0 ? value : undefined; }
function parseObject(value: string) { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function prettyJSON(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function textValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function stripRef(value: string) { return value.replace(/^(tasks|missions)\./, ''); }
function humanize(value: string) { return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function timestampDuration(start?: string, finish?: string) { if (!start) return undefined; const startMs = Date.parse(start); const endMs = finish ? Date.parse(finish) : Date.now(); return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined; }
function formatDuration(milliseconds?: number) { if (milliseconds == null || !Number.isFinite(milliseconds)) return '—'; const seconds = Math.max(0, Math.floor(milliseconds / 1000)); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); if (hours) return `${hours}h ${minutes}m`; if (minutes) return `${minutes}m ${seconds % 60}s`; return `${seconds}s`; }
function formatCost(value: number) { if (!Number.isFinite(value) || value === 0) return '$0.00'; return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`; }
function formatNumber(value: number) { return new Intl.NumberFormat().format(value); }
