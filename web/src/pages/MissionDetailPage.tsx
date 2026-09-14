import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, Code2, Database, GitBranch, Layers3, Maximize2, Minimize2, Network, Repeat2, UsersRound, Webhook, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { getMissionDefinition, getWorkspaceConfig } from '@/api/client';
import type { MissionInfo, TaskInfo } from '@/api/types';
import { AgentSourcePanel } from '@/components/AgentSourcePanel';
import { MarkdownContent } from '@/components/MarkdownContent';
import { MissionDetailNav } from '@/components/MissionDetailNav';
import { MissionGraph } from '@/components/MissionGraph';
import { MissionSchedulesPanel } from '@/components/MissionSchedulesPanel';
import { RunMissionDialog } from '@/components/RunMissionDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function MissionDetailPage() {
  const { missionName = '', workspaceId = '' } = useParams();
  const [selectedTaskName, setSelectedTaskName] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const snapshot = useQuery({
    queryKey: ['workspace-config', workspaceId],
    queryFn: () => getWorkspaceConfig(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const mission = snapshot.data?.config.missions.find((candidate) => candidate.name === missionName);
  const selectedTask = mission?.tasks?.find((task) => task.name === selectedTaskName);
  const definition = useQuery({
    queryKey: ['mission-definition', workspaceId, missionName],
    queryFn: () => getMissionDefinition(workspaceId, missionName),
    enabled: Boolean(sourceOpen && snapshot.data?.connected),
    staleTime: 0,
    retry: false,
  });
  const source = definition.data?.source ?? mission?.source;

  if (snapshot.isLoading) return <DetailState text="Loading mission definition…" />;
  if (snapshot.isError) return <DetailState text="Connect the workspace runner to inspect this mission." />;
  if (!mission) return <DetailState text={`Mission “${missionName}” was not found in the current workspace configuration.`} />;

  return <div>
    <MissionDetailNav action={<div className="flex items-center gap-2"><Button aria-label="View raw mission configuration" disabled={!snapshot.data?.connected} onClick={() => setSourceOpen(true)} size="sm" title={snapshot.data?.connected ? 'View raw mission configuration' : 'Connect the workspace runner to view raw configuration'} variant="outline"><Code2 className="size-3.5" />View raw</Button><div className="inline-flex overflow-hidden rounded-md shadow-xs"><RunMissionDialog buttonClassName="rounded-r-none border-r border-primary-foreground/25 shadow-none" connected={Boolean(snapshot.data?.connected)} instanceId={snapshot.data?.instanceId ?? ''} mission={mission} workspaceId={workspaceId} /><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="More run options" className="rounded-l-none px-2 shadow-none" size="sm"><ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setScheduleOpen(true)}><CalendarClock />Add schedule</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>} mission={mission} workspaceId={workspaceId} />
    <Dialog onOpenChange={setSourceOpen} open={sourceOpen}>
      <DialogContent aria-describedby={undefined} className="h-[85svh] w-[min(92vw,90rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none" showCloseButton={false}>
        <DialogTitle className="sr-only">Raw mission configuration</DialogTitle>
        {source ? <AgentSourcePanel onBack={() => setSourceOpen(false)} source={source} subject="mission" /> : <DetailState text={definition.isError ? (definition.error instanceof Error ? definition.error.message : 'Raw configuration is unavailable.') : 'Loading raw mission configuration…'} />}
      </DialogContent>
    </Dialog>
    <MissionOverview mission={mission} />
    <div className="mt-6 overflow-hidden rounded-md border bg-card">
      <div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">Mission canvas</h2><p className="mt-1 text-[10px] text-muted-foreground">Dependencies and sends are solid; router choices are dashed. Select a task to inspect its behavior.</p></div>
      <div className="h-[34rem] min-w-0"><MissionGraph mission={mission} onSelectTask={(task) => setSelectedTaskName(task.name)} selectedTask={selectedTask?.name} /></div>
    </div>
    {selectedTask && <TaskDefinitionDrawer key={selectedTask.name} onClose={() => setSelectedTaskName('')} task={selectedTask} />}
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <InputsPanel mission={mission} />
      <TriggerPanel mission={mission} />
      <MissionSchedulesPanel createOpen={scheduleOpen} instanceId={snapshot.data?.instanceId ?? ''} mission={mission} onCreateOpenChange={setScheduleOpen} workspaceId={workspaceId} />
      <DatasetsPanel mission={mission} />
      <AgentsPanel mission={mission} />
    </div>
  </div>;
}

function MissionOverview({ mission }: { mission: MissionInfo }) {
  const stats = [
    ['Tasks', mission.tasks?.length ?? 0, Layers3],
    ['Agents', mission.agents?.length ?? 0, UsersRound],
    ['Inputs', mission.inputs?.length ?? 0, Network],
    ['Max parallel', mission.maxParallel || 1, Repeat2],
  ] as const;
  return <div className="grid overflow-hidden rounded-md border bg-card sm:grid-cols-2 lg:grid-cols-4">{stats.map(([label, value, Icon], index) => <div className={`p-4 ${index > 0 ? 'border-t sm:border-t-0 sm:border-l' : ''}`} key={label}><p className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><Icon className="size-3" />{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></div>)}</div>;
}

function TaskDefinitionDrawer({ onClose, task }: { onClose: () => void; task: TaskInfo }) {
  const [expanded, setExpanded] = useState(false);
  return <aside aria-label={`${task.name} task definition`} className={cn('fixed !m-0 z-50 flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-2xl', expanded ? 'inset-3 w-auto sm:inset-4' : 'inset-y-3 right-3 w-[min(36rem,calc(100vw-1.5rem))] sm:inset-y-4 sm:right-4 sm:w-[min(36rem,calc(100vw-2rem))]')} role="dialog">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
      <div className="grid size-8 shrink-0 place-items-center rounded-full border bg-muted/40"><Layers3 className="size-4" /></div>
      <div className="min-w-0 flex-1"><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Task definition</p><h2 className="mt-0.5 truncate text-xs font-semibold">{task.name}</h2></div>
      <button aria-label={expanded ? 'Exit expanded view' : 'Expand task definition'} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
      <button aria-label="Close task definition" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose}><X className="size-3.5" /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl p-5 sm:p-6">
        <section><p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Objective</p><MarkdownContent className="mt-3 text-[11px] [&_p]:leading-5" content={task.objective || task.description || 'No objective provided.'} /></section>
        <dl className="mt-6 divide-y border-y">
          <InspectorRow label="Execution" value={task.agent || (task.commander ? 'Commander' : 'Mission agents')} />
          <InspectorRow label="Depends on" value={references(task.dependsOn)} />
          <InspectorRow label="Sends to" value={references(task.sendTo)} />
        </dl>
        {task.iterator && <section className="mt-6 rounded-md bg-muted/35 p-4"><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"><Repeat2 className="size-3" />Iterator</p><p className="mt-2 text-xs font-medium">{stripRef(task.iterator.dataset)}</p><p className="mt-1 text-[10px] text-muted-foreground">{task.iterator.parallel ? 'Parallel' : 'Sequential'}{task.iterator.concurrencyLimit ? ` · concurrency ${task.iterator.concurrencyLimit}` : ''}{task.iterator.maxRetries ? ` · ${task.iterator.maxRetries} retries` : ''}</p></section>}
        {task.router?.routes?.length ? <section className="mt-6"><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"><GitBranch className="size-3" />Routes</p><div className="mt-2 divide-y border-y">{task.router.routes.map((route) => <div className="py-3" key={`${route.target}:${route.condition}`}><p className="text-[11px] font-medium">{stripRef(route.target)}{route.isMission ? ' · mission' : ''}</p>{route.condition && <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{route.condition}</p>}</div>)}</div></section> : null}
      </div>
    </div>
  </aside>;
}

function InputsPanel({ mission }: { mission: MissionInfo }) { return <StaticPanel icon={Network} title="Inputs" count={mission.inputs?.length ?? 0}>{mission.inputs?.length ? <div className="divide-y">{mission.inputs.map((input) => <div className="flex items-start gap-4 py-2.5" key={input.name}><div className="min-w-0 flex-1"><p className="text-xs font-medium">{input.name}</p>{input.description && <MarkdownContent className="mt-1 text-[10px] text-muted-foreground [&_p]:leading-4" content={input.description} />}</div><span className="text-[10px] text-muted-foreground">{input.protected ? 'Protected' : input.type || 'value'}{input.required ? ' · required' : ''}</span></div>)}</div> : <Empty text="No mission inputs." />}</StaticPanel>; }
function DatasetsPanel({ mission }: { mission: MissionInfo }) { return <StaticPanel icon={Database} title="Datasets" count={mission.datasets?.length ?? 0}>{mission.datasets?.length ? <div className="divide-y">{mission.datasets.map((dataset) => <div className="py-2.5" key={dataset.name}><p className="text-xs font-medium">{dataset.name}</p><MarkdownContent className="mt-1 text-[10px] text-muted-foreground" content={dataset.description || `${dataset.schema?.length ?? 0} fields`} /></div>)}</div> : <Empty text="No mission datasets." />}</StaticPanel>; }
function AgentsPanel({ mission }: { mission: MissionInfo }) { return <StaticPanel icon={UsersRound} title="Execution" count={mission.agents?.length ?? 0}>{mission.commander && <InspectorRow label="Commander" value={mission.commander} />}{mission.agents?.length ? <div className="mt-2 flex flex-wrap gap-2">{mission.agents.map((agent) => <span className="rounded border bg-muted/30 px-2 py-1 text-[10px]" key={agent}>{stripRef(agent)}</span>)}</div> : <Empty text="No mission-level agents." />}</StaticPanel>; }
function TriggerPanel({ mission }: { mission: MissionInfo }) { return <StaticPanel icon={Webhook} title="Event triggers" count={mission.trigger ? 1 : 0}>{mission.trigger ? <div className="flex items-start gap-3 py-2.5"><Webhook className="mt-0.5 size-3 text-muted-foreground" /><div><p className="text-xs">Webhook</p><p className="mt-1 text-[10px] text-muted-foreground">{mission.trigger.webhookPath || 'Configured path'}{mission.trigger.hasSecret ? ' · secret protected' : ''}</p></div></div> : <Empty text="No event triggers." />}</StaticPanel>; }

function StaticPanel({ children, count, icon: Icon, title }: { children: React.ReactNode; count: number; icon: typeof Network; title: string }) { return <section className="rounded-md border bg-card"><div className="flex items-center gap-2 border-b px-4 py-3"><Icon className="size-3.5 text-muted-foreground" /><h2 className="text-xs font-semibold">{title}</h2><span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{count}</span></div><div className="px-4 py-2">{children}</div></section>; }
function InspectorRow({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[5rem_1fr] gap-3 py-2.5 text-[10px]"><dt className="uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="break-words text-right text-foreground">{value}</dd></div>; }
function Empty({ text }: { text: string }) { return <p className="py-5 text-center text-[11px] text-muted-foreground">{text}</p>; }
function DetailState({ text }: { text: string }) { return <div className="grid min-h-80 place-items-center rounded-md border bg-card px-6 text-center text-sm text-muted-foreground">{text}</div>; }
function references(values?: string[]) { return values?.length ? values.map(stripRef).join(', ') : '—'; }
function stripRef(value: string) { return value.replace(/^(tasks|agents|datasets|missions)\./, ''); }
