import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, CheckCircle2, CircleAlert, Clock3, Coins, Download, ExternalLink, FileText, Image as ImageIcon, Layers3, MessageSquareText, RefreshCcw, Square, Wrench } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getCostSummary, getMissionHistory, getMissionRun, getMissionRunEvents, getWorkspaceConfig, listHumanInputs, stopMission } from '@/api/client';
import type { MissionEventRecord, MissionInfo, MissionRun, MissionRunDetail } from '@/api/types';
import { MarkdownContent } from '@/components/MarkdownContent';
import { MissionDetailNav } from '@/components/MissionDetailNav';
import { HumanInputPrompt } from '@/components/HumanInputPrompt';
import { MissionGraph, type MissionTaskTelemetry } from '@/components/MissionGraph';
import { RunMissionDialog } from '@/components/RunMissionDialog';
import { Button } from '@/components/ui/button';
import { RunExecutionTimeline } from '@/components/RunExecutionTimeline';
import { MissionTaskConversationDrawer, type TaskView } from '@/pages/MissionRunExecutionPage';
import { cn } from '@/lib/utils';

export function MissionRunsPage() {
  const { missionName = '', runId, workspaceId = '' } = useParams();
  const snapshot = useQuery({ queryKey: ['workspace-config', workspaceId], queryFn: () => getWorkspaceConfig(workspaceId), enabled: Boolean(workspaceId), refetchInterval: 5_000, retry: false });
  const mission = snapshot.data?.config.missions.find((candidate) => candidate.name === missionName);
  const history = useQuery({
    queryKey: ['mission-history', snapshot.data?.instanceId],
    queryFn: () => getMissionHistory(snapshot.data!.instanceId),
    enabled: Boolean(snapshot.data?.connected && snapshot.data?.instanceId),
    refetchInterval: (query) => query.state.data?.missions.some((run) => run.status === 'running') ? 2_000 : 5_000,
    retry: false,
  });
  const costs = useQuery({ queryKey: ['mission-costs', snapshot.data?.instanceId], queryFn: () => getCostSummary(snapshot.data!.instanceId), enabled: Boolean(snapshot.data?.connected && snapshot.data?.instanceId), refetchInterval: 5_000, retry: false });
  const runs = useMemo(() => (history.data?.missions ?? []).filter((run) => run.name === missionName), [history.data?.missions, missionName]);

  if (snapshot.isLoading) return <RunState text="Loading mission runs…" />;
  if (snapshot.isError || !snapshot.data?.connected) return <RunState text="Connect the workspace runner to inspect mission telemetry." />;
  if (!mission) return <RunState text={`Mission “${missionName}” was not found in the current workspace configuration.`} />;

  return <div>
    <MissionDetailNav action={<RunMissionDialog connected={snapshot.data.connected} instanceId={snapshot.data.instanceId} mission={mission} workspaceId={workspaceId} />} mission={mission} workspaceId={workspaceId} />
    {runId ? <MissionRunTelemetry instanceId={snapshot.data.instanceId} mission={mission} runId={runId} runsPath={`/w/${workspaceId}/missions/${encodeURIComponent(mission.name)}/runs`} /> : <MissionRunOverview costs={costs.data?.recentMissions ?? []} loading={history.isLoading} mission={mission} runs={runs} workspaceId={workspaceId} />}
  </div>;
}

function MissionRunOverview({ costs, loading, mission, runs, workspaceId }: { costs: Array<{ missionId: string; totalCost: number; turns: number }>; loading: boolean; mission: MissionInfo; runs: MissionRun[]; workspaceId: string }) {
  if (loading) return <RunState text="Loading run history…" />;
  const terminal = runs.filter((run) => run.status === 'completed' || run.status === 'failed');
  const completed = runs.filter((run) => run.status === 'completed').length;
  const failed = runs.filter((run) => run.status === 'failed').length;
  const running = runs.filter((run) => run.status === 'running').length;
  const durations = terminal.map(runDurationMs).filter((value): value is number => value != null).sort((a, b) => a - b);
  const costByRun = new Map(costs.map((cost) => [cost.missionId, cost]));
  const trackedCost = runs.reduce((sum, run) => sum + (costByRun.get(run.id)?.totalCost ?? 0), 0);
  const trackedTurns = runs.reduce((sum, run) => sum + (costByRun.get(run.id)?.turns ?? 0), 0);
  const base = `/w/${workspaceId}/missions/${encodeURIComponent(mission.name)}/runs`;

  return <div className="space-y-6">
    <div className="grid overflow-hidden rounded-md border bg-card sm:grid-cols-2 lg:grid-cols-4">
      <AggregateMetric label="Success rate" value={terminal.length ? `${Math.round((completed / terminal.length) * 100)}%` : '—'} detail={`${completed} completed · ${failed} failed`} />
      <AggregateMetric label="Median duration" value={formatDuration(percentile(durations, 0.5))} detail={durations.length ? `P95 ${formatDuration(percentile(durations, 0.95))}` : 'No completed durations'} />
      <AggregateMetric
        label="Recent usage"
        value={trackedTurns ? `${formatNumber(trackedTurns)} turns` : '—'}
        detail={trackedTurns ? `${formatCost(trackedCost)} in the recent cost window` : 'No runs in the recent cost window'}
      />
      <AggregateMetric label="Active now" value={String(running)} detail={`${runs.length} total runs`} />
    </div>
    <RunOutcomeBar completed={completed} failed={failed} running={running} stopped={runs.filter((run) => run.status === 'stopped').length} total={runs.length} />
    <section className="overflow-hidden rounded-md border bg-card">
      <div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">Run history</h2><p className="mt-1 text-[10px] text-muted-foreground">Open a run to inspect task execution, route choices, model usage, and operational events.</p></div>
      <div className="overflow-x-auto"><div className="min-w-[680px]">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_10rem_7rem_6rem] gap-4 border-b bg-muted/40 px-4 py-2.5 text-[9px] uppercase tracking-wider text-muted-foreground"><span>Run</span><span>Status</span><span>Started</span><span className="text-right">Duration</span><span className="text-right">Cost</span></div>
        {runs.map((run) => <Link className="grid grid-cols-[minmax(0,1fr)_8rem_10rem_7rem_6rem] gap-4 border-b px-4 py-3 text-[11px] transition-colors last:border-b-0 hover:bg-accent/40" key={run.id} to={`${base}/${encodeURIComponent(run.id)}`}>
          <span className="min-w-0"><span className="block truncate font-medium">{run.id}</span><span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{run.inputsJson ? inputSummary(run.inputsJson) : 'No inputs'}</span></span>
          <RunStatus status={run.status} />
          <span className="self-center text-muted-foreground">{formatTimestamp(run.startedAt)}</span>
          <span className="self-center text-right tabular-nums text-muted-foreground">{formatDuration(runDurationMs(run))}</span>
          <span className="self-center text-right tabular-nums text-muted-foreground">{formatCost(costByRun.get(run.id)?.totalCost)}</span>
        </Link>)}
        {runs.length === 0 && <p className="py-14 text-center text-xs text-muted-foreground">This mission has not been run yet.</p>}
      </div></div>
    </section>
  </div>;
}

function MissionRunTelemetry({ instanceId, mission, runId, runsPath }: { instanceId: string; mission: MissionInfo; runId: string; runsPath: string }) {
  const [selectedTaskName, setSelectedTaskName] = useState('');
  const [selectedIterationIndex, setSelectedIterationIndex] = useState<number | undefined>();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['mission-run', instanceId, runId], queryFn: () => getMissionRun(instanceId, runId), refetchInterval: (query) => query.state.data?.mission.status === 'running' ? 2_000 : false, retry: false });
  const events = useQuery({ queryKey: ['mission-run-events', instanceId, runId], queryFn: () => getMissionRunEvents(instanceId, runId), refetchInterval: detail.data?.mission.status === 'running' ? 2_000 : false, retry: false });
  const humanInputs = useQuery({ queryKey: ['human-inputs', instanceId, runId, 'open'], queryFn: () => listHumanInputs(instanceId, runId), refetchInterval: detail.data?.mission.status === 'running' ? 2_000 : false, retry: false });
  const stop = useMutation({
    mutationFn: () => stopMission(instanceId, runId),
    onSuccess: async () => { await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mission-run', instanceId, runId] }),
      queryClient.invalidateQueries({ queryKey: ['mission-run-events', instanceId, runId] }),
      queryClient.invalidateQueries({ queryKey: ['mission-history', instanceId] }),
    ]); },
  });
  if (detail.isLoading || events.isLoading) return <RunState text="Loading run telemetry…" />;
  if (detail.isError || events.isError || !detail.data) return <RunState text="The runner could not load this run’s telemetry." />;
  const telemetry = summarizeRun(detail.data, events.data?.events ?? [], mission);
  const selectedDefinition = mission.tasks?.find((task) => task.name === selectedTaskName);
  const selectedRun = selectedDefinition ? detail.data.tasks.find((task) => task.taskName === selectedDefinition.name) : undefined;
  const selectedEvents = selectedDefinition ? telemetry.events.filter((event) => event.taskId === selectedRun?.id || eventTaskName(event) === selectedDefinition.name) : [];
  const selectedTask: TaskView | undefined = selectedDefinition ? {
    name: selectedDefinition.name,
    definition: selectedDefinition,
    record: selectedRun ?? { id: selectedDefinition.name, missionId: detail.data.mission.id, taskName: selectedDefinition.name, status: 'pending' },
    status: selectedRun?.status ?? 'pending',
    durationMs: timestampsDuration(selectedRun?.startedAt, selectedRun?.finishedAt),
    summary: selectedRun?.summary,
    outputJson: selectedRun?.outputJson,
    turns: selectedEvents.filter((event) => event.eventType === 'session_turn').length,
    toolCalls: selectedEvents.filter((event) => event.eventType === 'agent_calling_tool' || event.eventType === 'commander_calling_tool').length,
    agentStarts: selectedEvents.filter((event) => event.eventType === 'agent_started').length,
    cost: selectedEvents.filter((event) => event.eventType === 'session_turn').reduce((total, event) => total + numberValue(event.data.cost), 0),
  } : undefined;
  const selectTask = (taskName: string, iterationIndex?: number) => {
    setSelectedTaskName(taskName);
    setSelectedIterationIndex(iterationIndex);
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><Link className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground" to={runsPath}><ArrowLeft className="size-3" />All runs</Link><div className="mt-2 flex items-center gap-2"><h2 className="text-sm font-semibold">{runId}</h2><RunStatus status={detail.data.mission.status} /></div><p className="mt-1 text-[10px] text-muted-foreground">Started {formatTimestamp(detail.data.mission.startedAt)}</p></div>
      <div className="flex items-center gap-2"><span className="rounded border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">Telemetry from {telemetry.events.length} persisted events</span>{detail.data.mission.status === 'running' && <Button disabled={stop.isPending} onClick={() => stop.mutate()} size="xs" variant="outline"><Square className="size-3" />{stop.isPending ? 'Stopping…' : 'Stop'}</Button>}</div>
    </div>
    <MissionInputs value={detail.data.mission.inputsJson} />
    {humanInputs.data?.humanInputs.map((request) => <HumanInputPrompt instanceId={instanceId} key={request.toolCallId} onResolved={() => { queryClient.invalidateQueries({ queryKey: ['human-inputs', instanceId, runId] }); queryClient.invalidateQueries({ queryKey: ['mission-run-events', instanceId, runId] }); }} request={request} />)}
    {stop.isError && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{stop.error instanceof Error ? stop.error.message : 'The mission could not be stopped.'}</p>}
    <section className="overflow-hidden rounded-md border bg-card">
      <div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">Execution canvas</h2><p className="mt-1 text-[10px] text-muted-foreground">Node status and durations come from persisted task records. Select a task to follow its commander and delegated agent work; highlighted router edges show the chosen path.</p></div>
      <div className="h-[35rem] min-w-0"><MissionGraph mission={mission} onSelectTask={(task) => selectTask(task.name)} routeChoices={telemetry.routeChoices} selectedTask={selectedDefinition?.name} telemetry={telemetry.taskTelemetry} /></div>
    </section>
    <RunExecutionTimeline iterations={Object.fromEntries(Object.entries(telemetry.taskTelemetry).map(([name, value]) => [name, value.iteration]))} onSelectTask={selectTask} run={detail.data.mission} selectedIterationIndex={selectedIterationIndex} selectedTaskName={selectedTaskName} tasks={detail.data.tasks} />
    {selectedTask && <MissionTaskConversationDrawer events={selectedEvents} initialIterationIndex={selectedIterationIndex} instanceId={instanceId} key={`${selectedTask.record.id}:${selectedIterationIndex ?? 'all'}`} onClose={() => { setSelectedTaskName(''); setSelectedIterationIndex(undefined); }} task={selectedTask} traceEvents={telemetry.events} />}
    <div className="grid overflow-hidden rounded-md border bg-card sm:grid-cols-2 lg:grid-cols-3">
      <RunMetric icon={Clock3} label="Wall time" value={formatDuration(runDurationMs(detail.data.mission))} detail={`${formatDuration(telemetry.modelTimeMs)} model time`} />
      <RunMetric icon={Layers3} label="Task outcome" value={`${telemetry.completedTasks}/${mission.tasks?.length ?? detail.data.tasks.length}`} detail={`${telemetry.failedTasks} failed · ${telemetry.runningTasks} running`} />
      <RunMetric icon={MessageSquareText} label="Model turns" value={formatNumber(telemetry.turns.length)} detail={`${formatTokens(telemetry.inputTokens + telemetry.outputTokens)} tokens`} />
      <RunMetric icon={Coins} label="Estimated cost" value={formatCost(telemetry.totalCost)} detail={`${formatTokens(telemetry.cacheReadTokens)} cache-read tokens`} />
      <RunMetric icon={Wrench} label="Tool activity" value={formatNumber(telemetry.toolCalls)} detail={`${telemetry.agentStarts} agent starts`} />
      <RunMetric icon={RefreshCcw} label="Iteration health" value={`${telemetry.iterationsCompleted}/${telemetry.iterationsStarted}`} detail={`${telemetry.retries} retries · ${telemetry.iterationsFailed} failed`} />
    </div>
    {(telemetry.openHumanInputs > 0 || telemetry.compactions > 0) && <div className="flex flex-wrap gap-2">{telemetry.openHumanInputs > 0 && <Signal tone="warning" text={`${telemetry.openHumanInputs} human input${telemetry.openHumanInputs === 1 ? '' : 's'} waiting`} />}{telemetry.compactions > 0 && <Signal text={`${telemetry.compactions} context compaction${telemetry.compactions === 1 ? '' : 's'}`} />}</div>}
    <ModelUsage models={telemetry.models} />
  </div>;
}

type ParsedEvent = MissionEventRecord & { data: Record<string, unknown> };
type Turn = { model: string; entity: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; turnDurationMs: number; cost: number };
type ModelTelemetry = { model: string; turns: number; tokens: number; cost: number; durationMs: number };

function buildIterationTelemetry(taskName: string, events: ParsedEvent[], configuredParallel?: boolean): MissionTaskTelemetry['iteration'] {
  const taskEvents = events.filter((event) => eventTaskName(event) === taskName);
  const started = taskEvents.find((event) => event.eventType === 'task_iteration_started');
  const total = numberValue(started?.data.totalItems) || new Set(taskEvents.map((event) => event.iterationIndex).filter((value): value is number => typeof value === 'number')).size;
  if (!total) return undefined;
  const taskFinishedAt = [...taskEvents].reverse().find((event) => event.eventType === 'task_completed' || event.eventType === 'task_failed')?.createdAt;
  const lanes = Array.from({ length: total }, (_, index) => {
    const iterationEvents = taskEvents.filter((event) => event.iterationIndex === index || (typeof event.data.index === 'number' && event.data.index === index));
    const first = iterationEvents.find((event) => event.eventType === 'iteration_started') ?? iterationEvents[0];
    const terminal = [...iterationEvents].reverse().find((event) => event.eventType === 'iteration_completed' || event.eventType === 'iteration_failed');
    const start = first && Number.isFinite(Date.parse(first.createdAt)) ? Date.parse(first.createdAt) : started && Number.isFinite(Date.parse(started.createdAt)) ? Date.parse(started.createdAt) : Date.now();
    const endValue = terminal?.createdAt ?? taskFinishedAt;
    const end = endValue && Number.isFinite(Date.parse(endValue)) ? Math.max(start, Date.parse(endValue)) : Date.now();
    const status = terminal?.eventType === 'iteration_failed' ? 'failed' : terminal?.eventType === 'iteration_completed' ? 'completed' : 'running';
    return { index, status, start, end };
  });
  return {
    completed: lanes.filter((lane) => lane.status === 'completed').length,
    failed: lanes.filter((lane) => lane.status === 'failed').length,
    parallel: typeof started?.data.parallel === 'boolean' ? started.data.parallel : Boolean(configuredParallel),
    running: lanes.filter((lane) => lane.status === 'running').length,
    total,
    lanes,
  };
}

function summarizeRun(detail: MissionRunDetail, records: MissionEventRecord[], mission: MissionInfo) {
  const events: ParsedEvent[] = records.map((event) => ({ ...event, data: parseData(event.dataJson) }));
  const turns: Turn[] = events.filter((event) => event.eventType === 'session_turn').map((event) => ({
    model: textValue(event.data.model) || 'Unknown model', entity: textValue(event.data.entity) || 'unknown', inputTokens: numberValue(event.data.inputTokens), outputTokens: numberValue(event.data.outputTokens), cacheReadTokens: numberValue(event.data.cacheReadTokens), turnDurationMs: numberValue(event.data.turnDurationMs), cost: numberValue(event.data.cost),
  }));
  const taskTelemetry: Record<string, MissionTaskTelemetry> = {};
  detail.tasks.forEach((task) => {
    const definition = mission.tasks?.find((candidate) => candidate.name === task.taskName);
    taskTelemetry[task.taskName] = { status: task.status, error: task.error, durationMs: timestampsDuration(task.startedAt, task.finishedAt), iteration: buildIterationTelemetry(task.taskName, events, definition?.iterator?.parallel) };
  });
  const routeChoices: Record<string, string> = {};
  events.filter((event) => event.eventType === 'route_chosen').forEach((event) => { const router = textValue(event.data.routerTask); const target = textValue(event.data.targetTask); if (router && target) routeChoices[router] = stripRef(target); });
  const byModel = new Map<string, ModelTelemetry>();
  turns.forEach((turn) => { const value = byModel.get(turn.model) ?? { model: turn.model, turns: 0, tokens: 0, cost: 0, durationMs: 0 }; value.turns += 1; value.tokens += turn.inputTokens + turn.outputTokens; value.cost += turn.cost; value.durationMs += turn.turnDurationMs; byModel.set(turn.model, value); });
  const requested = events.filter((event) => event.eventType === 'human_input_requested').length;
  const resolved = events.filter((event) => event.eventType === 'human_input_resolved').length;
  return {
    events, turns, taskTelemetry, routeChoices, models: [...byModel.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
    completedTasks: detail.tasks.filter((task) => task.status === 'completed').length,
    failedTasks: detail.tasks.filter((task) => task.status === 'failed').length,
    runningTasks: detail.tasks.filter((task) => task.status === 'running').length,
    inputTokens: sum(turns, 'inputTokens'), outputTokens: sum(turns, 'outputTokens'), cacheReadTokens: sum(turns, 'cacheReadTokens'), modelTimeMs: sum(turns, 'turnDurationMs'), totalCost: sum(turns, 'cost'),
    toolCalls: events.filter((event) => event.eventType === 'agent_calling_tool' || event.eventType === 'commander_calling_tool').length,
    agentStarts: events.filter((event) => event.eventType === 'agent_started').length,
    iterationsStarted: events.filter((event) => event.eventType === 'iteration_started').length,
    iterationsCompleted: events.filter((event) => event.eventType === 'iteration_completed').length,
    iterationsFailed: events.filter((event) => event.eventType === 'iteration_failed').length,
    retries: events.filter((event) => event.eventType === 'iteration_retrying').length,
    compactions: events.filter((event) => event.eventType === 'compaction').length,
    openHumanInputs: Math.max(0, requested - resolved),
  };
}

function ModelUsage({ models }: { models: ModelTelemetry[] }) { return <section className="overflow-hidden rounded-md border bg-card"><div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">Model usage</h2><p className="mt-1 text-[10px] text-muted-foreground">Session-turn telemetry grouped by model.</p></div>{models.length ? <div className="overflow-x-auto"><div className="min-w-[520px]"><div className="grid grid-cols-[minmax(0,1fr)_4rem_6rem_6rem_6rem] gap-3 border-b bg-muted/40 px-4 py-2 text-[9px] uppercase tracking-wider text-muted-foreground"><span>Model</span><span className="text-right">Turns</span><span className="text-right">Tokens</span><span className="text-right">Model time</span><span className="text-right">Cost</span></div>{models.map((model) => <div className="grid grid-cols-[minmax(0,1fr)_4rem_6rem_6rem_6rem] gap-3 border-b px-4 py-2.5 text-[10px] last:border-0" key={model.model}><span className="truncate font-medium">{model.model}</span><span className="text-right tabular-nums">{model.turns}</span><span className="text-right tabular-nums">{formatTokens(model.tokens)}</span><span className="text-right tabular-nums">{formatDuration(model.durationMs)}</span><span className="text-right tabular-nums">{formatCost(model.cost)}</span></div>)}</div></div> : <p className="py-10 text-center text-xs text-muted-foreground">No session-turn telemetry was recorded.</p>}</section>; }
function MissionInputs({ value }: { value?: string }) {
  const input = parseJSONValue(value);
  const entries = isRecord(input) ? Object.entries(input) : input == null ? [] : [['Input', input] as const];
  return <section className="overflow-hidden rounded-md border bg-card">
    <div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">Mission inputs</h2><p className="mt-1 text-[10px] text-muted-foreground">Values supplied when this run started.</p></div>
    {entries.length ? <dl>{entries.map(([key, entry]) => <div className="grid gap-2 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-5" key={key}><dt className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{humanizeInputKey(key)}</dt><dd className="min-w-0 text-[11px]"><MissionInputValue value={entry} /></dd></div>)}</dl> : <p className="px-4 py-6 text-[10px] text-muted-foreground">No inputs were provided for this run.</p>}
  </section>;
}
function MissionInputValue({ value }: { value: unknown }) {
  const decodedValue = decodeEmbeddedValue(value);
  const file = richInputFile(decodedValue);
  if (file) return <RichInputFile file={file} />;
  if (typeof decodedValue === 'string') return <MarkdownContent className="[&_p]:leading-5" content={decodedValue} />;
  value = decodedValue;
  if (value == null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === 'number' || typeof value === 'boolean') return <code>{String(value)}</code>;
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/35 p-3 text-[9px] leading-4 text-muted-foreground">{JSON.stringify(value, null, 2)}</pre>;
}

type RichInputFile = { filename: string; contentBase64: string; mediaType: string };

function RichInputFile({ file }: { file: RichInputFile }) {
  const source = `data:${file.mediaType};base64,${file.contentBase64}`;
  const isImage = file.mediaType.startsWith('image/');
  return <div className="max-w-3xl overflow-hidden rounded-md border bg-muted/15">
    <div className="flex min-w-0 items-center gap-3 p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">{isImage ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{file.filename}</span><span className="mt-0.5 block text-[9px] uppercase tracking-wider text-muted-foreground">{fileTypeLabel(file.mediaType)} · {formatBytes(base64ByteLength(file.contentBase64))}</span></span>
      <span className="flex shrink-0 items-center gap-1">
        <a aria-label={`Open ${file.filename}`} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" href={source} rel="noreferrer" target="_blank"><ExternalLink className="size-3.5" /></a>
        <a aria-label={`Download ${file.filename}`} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" download={file.filename} href={source}><Download className="size-3.5" /></a>
      </span>
    </div>
    {isImage && <div className="border-t bg-black/[0.03] p-3 dark:bg-white/[0.03]"><img alt={file.filename} className="max-h-96 max-w-full rounded object-contain" src={source} /></div>}
  </div>;
}
function RunOutcomeBar({ completed, failed, running, stopped, total }: { completed: number; failed: number; running: number; stopped: number; total: number }) { if (!total) return null; return <div className="rounded-md border bg-card p-4"><div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted-foreground"><span>{completed} completed</span><span>{failed} failed</span><span>{running} running</span><span>{stopped} stopped</span></div><div className="flex h-2 overflow-hidden rounded-full bg-muted">{completed > 0 && <span className="bg-emerald-500" style={{ width: `${completed / total * 100}%` }} />}{failed > 0 && <span className="bg-destructive" style={{ width: `${failed / total * 100}%` }} />}{running > 0 && <span className="bg-primary" style={{ width: `${running / total * 100}%` }} />}{stopped > 0 && <span className="bg-amber-500" style={{ width: `${stopped / total * 100}%` }} />}</div></div>; }
function AggregateMetric({ detail, label, value }: { detail: string; label: string; value: string }) { return <div className="border-t p-4 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{detail}</p></div>; }
function RunMetric({ detail, icon: Icon, label, value }: { detail: string; icon: typeof Activity; label: string; value: string }) { return <div className="border-t p-4 first:border-t-0 sm:border-l sm:first:border-l-0 lg:[&:nth-child(-n+3)]:border-t-0"><p className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><Icon className="size-3" />{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{detail}</p></div>; }
function RunStatus({ status }: { status: string }) { const Icon = status === 'completed' ? CheckCircle2 : status === 'failed' ? CircleAlert : status === 'running' ? Activity : Clock3; return <span className={cn('inline-flex items-center gap-1.5 self-center capitalize text-muted-foreground', status === 'completed' && 'text-emerald-600 dark:text-emerald-400', status === 'failed' && 'text-destructive', status === 'running' && 'text-primary')}><Icon className={cn('size-3', status === 'running' && 'animate-pulse')} />{status}</span>; }
function Signal({ text, tone }: { text: string; tone?: 'warning' }) { return <span className={cn('rounded border bg-muted/30 px-2.5 py-1 text-[10px]', tone === 'warning' && 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300')}>{text}</span>; }
function RunState({ text }: { text: string }) { return <div className="grid min-h-80 place-items-center rounded-md border bg-card px-6 text-center text-sm text-muted-foreground">{text}</div>; }

function parseData(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function parseJSONValue(value?: string): unknown { if (!value) return undefined; try { return JSON.parse(value); } catch { return value; } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function decodeEmbeddedValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try { return JSON.parse(trimmed) as unknown; } catch { return value; }
}
function richInputFile(value: unknown): RichInputFile | undefined {
  if (!isRecord(value) || typeof value.filename !== 'string' || typeof value.content_base64 !== 'string' || !value.content_base64) return undefined;
  const explicitType = [value.media_type, value.mediaType, value.mime_type, value.mimeType, value.content_type, value.contentType].find((candidate): candidate is string => typeof candidate === 'string' && candidate.includes('/'));
  return {
    filename: value.filename,
    contentBase64: value.content_base64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, ''),
    mediaType: explicitType ?? inferMediaType(value.filename, value.content_base64),
  };
}
function inferMediaType(filename: string, data: string) {
  const extension = filename.split('.').pop()?.toLowerCase();
  const byExtension: Record<string, string> = { avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg', pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' };
  if (extension && byExtension[extension]) return byExtension[extension];
  const compact = data.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (compact.startsWith('JVBERi0')) return 'application/pdf';
  if (compact.startsWith('iVBORw0KGgo')) return 'image/png';
  if (compact.startsWith('/9j/')) return 'image/jpeg';
  if (compact.startsWith('R0lGOD')) return 'image/gif';
  if (compact.startsWith('UklGR')) return 'image/webp';
  return 'application/octet-stream';
}
function base64ByteLength(data: string) { const compact = data.replace(/\s/g, ''); return Math.max(0, Math.floor(compact.length * 3 / 4) - (compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0)); }
function fileTypeLabel(mediaType: string) { if (mediaType === 'application/pdf') return 'PDF'; if (mediaType.startsWith('image/')) return mediaType.slice(6).toUpperCase(); return mediaType === 'application/octet-stream' ? 'File' : mediaType; }
function formatBytes(bytes: number) { if (bytes < 1_024) return `${bytes} B`; if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`; return `${(bytes / 1_048_576).toFixed(1)} MB`; }
function humanizeInputKey(value: string) { return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' '); }
function textValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function sum<T extends Record<string, unknown>>(values: T[], key: keyof T) { return values.reduce((total, value) => total + numberValue(value[key]), 0); }
function runDurationMs(run: MissionRun) { const start = Date.parse(run.startedAt); const end = run.finishedAt ? Date.parse(run.finishedAt) : run.status === 'running' ? Date.now() : Number.NaN; return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined; }
function timestampsDuration(start?: string, finish?: string) { if (!start) return undefined; const startMs = Date.parse(start); const endMs = finish ? Date.parse(finish) : Date.now(); return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined; }
function percentile(values: number[], quantile: number) { if (!values.length) return undefined; return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1))]; }
function formatDuration(milliseconds?: number) { if (milliseconds == null || !Number.isFinite(milliseconds)) return '—'; const seconds = Math.max(0, Math.floor(milliseconds / 1000)); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); if (hours) return `${hours}h ${minutes}m`; if (minutes) return `${minutes}m ${seconds % 60}s`; return `${seconds}s`; }
function formatCost(value?: number) { if (value == null || !Number.isFinite(value)) return '—'; if (value === 0) return '$0.00'; return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`; }
function formatTokens(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value); }
function formatNumber(value: number) { return new Intl.NumberFormat().format(value); }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
function inputSummary(value: string) { try { const parsed = JSON.parse(value) as Record<string, unknown>; const count = Object.keys(parsed).length; return count ? `${count} input${count === 1 ? '' : 's'}` : 'No inputs'; } catch { return 'Inputs recorded'; } }
function stripRef(value: string) { return value.replace(/^(tasks|missions)\./, ''); }
function eventTaskName(event: ParsedEvent) { return textValue(event.data.taskName) || textValue(event.data.task); }
