import { useMemo, useState } from 'react';
import { Bot, BrainCircuit, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getWorkspaceConfig, listWorkspaces } from '@/api/client';
import type { AgentInfo, MissionInfo } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type AgentFilter = 'all' | 'workspace' | 'mission';

export function AgentsPage() {
  const { workspaceId } = useParams();
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [search, setSearch] = useState('');
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  const snapshot = useQuery({
    queryKey: ['workspace-config', workspaceId],
    queryFn: () => getWorkspaceConfig(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const agents = useMemo(() => snapshot.data?.config.agents ?? [], [snapshot.data]);
  const missions = useMemo(() => snapshot.data?.config.missions ?? [], [snapshot.data]);
  const visibleAgents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return agents.filter((agent) => {
      const scopeMatches = filter === 'all'
        || (filter === 'workspace' && !agent.mission)
        || (filter === 'mission' && Boolean(agent.mission));
      const text = [agent.name, agent.role, agent.description, agent.model, agent.mission, ...(agent.tools ?? []), ...(agent.skills ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return scopeMatches && (!query || text.includes(query));
    });
  }, [agents, filter, search]);

  const workspaceAgents = agents.filter((agent) => !agent.mission).length;
  const missionAgents = agents.length - workspaceAgents;
  const capabilityCount = new Set(agents.flatMap((agent) => [...(agent.tools ?? []), ...(agent.skills ?? [])])).size;

  return (
    <div>
      <PageHeader
        description="The reusable AI capabilities available to this workspace and its missions."
        eyebrow={workspace?.name ?? 'Workspace'}
        title="Agents"
      />

      {snapshot.data?.configError && (
        <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          The runner reported a configuration error: {snapshot.data.configError}
        </div>
      )}

      {snapshot.isLoading ? (
        <AgentState title="Loading workspace configuration…" />
      ) : snapshot.isError ? (
        <AgentState
          description="Start the workspace runner from the workflows directory. Agents will appear here as soon as Squadron reports its configuration."
          title="Waiting for workspace configuration"
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3 border-b pb-4">
            <div className="flex items-center gap-1">
              {(['all', 'workspace', 'mission'] as const).map((value) => (
                <Button
                  className="capitalize"
                  key={value}
                  onClick={() => setFilter(value)}
                  size="xs"
                  variant={filter === value ? 'secondary' : 'ghost'}
                >
                  {value === 'mission' ? 'Mission-scoped' : value}
                </Button>
              ))}
            </div>
            <div className="flex-1" />
            <label className="relative min-w-56 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-8 pl-9 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search agents" value={search} />
            </label>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <InlineStat label="agents" value={agents.length} />
            <InlineStat label="workspace" value={workspaceAgents} />
            <InlineStat label="mission-scoped" value={missionAgents} />
            <InlineStat label="capabilities" value={capabilityCount} />
          </div>

          {visibleAgents.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {visibleAgents.map((agent) => (
                <AgentCard
                  agent={agent}
                  key={`${agent.mission ?? 'workspace'}:${agent.name}`}
                  missions={missions}
                />
              ))}
            </div>
          ) : (
            <AgentState title={agents.length === 0 ? 'No agents configured.' : 'No agents match this search.'} />
          )}
        </>
      )}
    </div>
  );
}

function AgentCard({ agent, missions }: { agent: AgentInfo; missions: MissionInfo[] }) {
  const { workspaceId } = useParams();
  const scope = agent.mission ? `?${new URLSearchParams({ mission: agent.mission })}` : '';
  const missionUsage = agent.mission
    ? [agent.mission]
    : missions.filter((mission) => mission.agents?.includes(agent.name)).map((mission) => mission.name);
  const capabilities = [
    ...(agent.tools ?? []).map((tool) => ({ kind: 'tool' as const, name: formatCapability(tool) })),
    ...(agent.skills ?? []).map((skill) => ({ kind: 'skill' as const, name: formatCapability(skill) })),
  ];

  return (
    <Link to={`/w/${workspaceId}/agents/${encodeURIComponent(agent.name)}${scope}`} className="flex min-h-52 flex-col rounded-md border bg-card p-4 transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Open ${agent.name}${agent.mission ? ` in ${agent.mission}` : ''}`}>
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded border bg-muted text-primary">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground" title={agent.name}>{agent.name}</h2>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground" title={formatModel(agent.model)}>
            <BrainCircuit className="size-3 shrink-0" /><span className="truncate">{formatModel(agent.model)}</span>
          </p>
        </div>
      </div>

      <div className="mt-3 flex-1">
        <p className="line-clamp-2 text-xs leading-5 text-foreground/90" title={agent.role || agent.description}>
          {agent.role || agent.description || 'No purpose described.'}
        </p>
        {agent.role && agent.description && (
          <p className="mt-1.5 line-clamp-1 text-[11px] leading-5 text-muted-foreground" title={agent.description}>{agent.description}</p>
        )}
      </div>

      <div className="mt-3 border-t pt-3">
        <div className="mb-2 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <Wrench className="size-3 shrink-0" />
          <span className="shrink-0">{capabilities.length} capabilit{capabilities.length === 1 ? 'y' : 'ies'}</span>
          <span className="shrink-0">·</span>
          <span className="truncate" title={agent.mission ? `Mission · ${agent.mission}` : undefined}>
            {agent.mission ? `Mission · ${agent.mission}` : missionUsage.length > 0 ? `Used by ${missionUsage.length} mission${missionUsage.length === 1 ? '' : 's'}` : 'Available workspace-wide'}
          </span>
        </div>
        {capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {capabilities.slice(0, 3).map((capability, index) => (
              <span className="inline-flex max-w-36 items-center gap-1 truncate rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" key={`${capability.kind}:${capability.name}:${index}`}>
                {capability.kind === 'skill' ? <Sparkles className="size-2.5 shrink-0" /> : <Wrench className="size-2.5 shrink-0" />}
                <span className="truncate">{capability.name}</span>
              </span>
            ))}
            {capabilities.length > 3 && <span className="px-1 py-0.5 text-[10px] text-muted-foreground">+{capabilities.length - 3}</span>}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="size-3" />Model-only agent</p>
        )}
      </div>
    </Link>
  );
}

function InlineStat({ label, value }: { label: string; value: number }) {
  return <span><strong className="font-semibold text-foreground">{value}</strong> {label}</span>;
}

function AgentState({ description, title }: { description?: string; title: string }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-md border bg-card px-6 text-center">
      <div>
        <Bot className="mx-auto mb-3 size-6 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function formatModel(model: string) {
  return model.replace(/^models\./, '').replaceAll('_', ' ');
}

function formatCapability(capability: string) {
  const parts = capability.replace(/^(plugins|mcp|builtins|skills)\./, '').split('.');
  return parts.at(-1) === 'all' ? parts.slice(0, -1).join(' · ') : parts.join(' · ');
}
