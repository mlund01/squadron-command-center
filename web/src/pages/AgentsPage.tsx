import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { getInstance } from '@/api/client';
import { AgentCard } from '@/components/agent-card';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { AgentInfo, MissionInfo, SkillInfo } from '@/api/types';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | 'global' | 'scoped';

function buildAgentMiniGraph(
  agent: AgentInfo,
  missions: MissionInfo[],
  skills: SkillInfo[],
): { nodes: MiniNode[]; edges: MiniEdge[] } {
  const nodes: MiniNode[] = [];
  const edges: MiniEdge[] = [];

  const agentMissions = missions.filter((m) => m.agents?.includes(agent.name));
  for (const m of agentMissions) {
    nodes.push({ id: `m:${m.name}`, color: 'teal', size: 'sm' });
    edges.push({ source: `m:${m.name}`, target: 'agent' });
  }

  nodes.push({ id: 'agent', color: 'violet', size: 'md' });

  const agentSkills = skills.filter((s) => agent.skills?.includes(s.name));
  for (const s of agentSkills) {
    nodes.push({ id: `s:${s.name}`, color: 'amber', size: 'sm' });
    edges.push({ source: 'agent', target: `s:${s.name}` });
  }

  const seen = new Set<string>();
  for (const ref of agent.tools ?? []) {
    const parts = ref.split('.');
    if (parts.length >= 2) {
      const ns = parts[0] === 'builtins' || parts[0] === 'plugins' ? parts[1] : parts[0];
      if (!seen.has(ns)) {
        seen.add(ns);
        nodes.push({ id: `p:${ns}`, color: 'blue', size: 'sm' });
        edges.push({ source: 'agent', target: `p:${ns}` });
      }
    }
  }

  return { nodes, edges };
}

export function AgentsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const agents = useMemo(() => instance?.config.agents ?? [], [instance]);
  const missions = useMemo(() => instance?.config.missions ?? [], [instance]);
  const skills = useMemo(() => instance?.config.skills ?? [], [instance]);

  const globalCount = agents.filter((a) => !a.mission).length;
  const scopedCount = agents.filter((a) => a.mission).length;
  const modelsCount = new Set(agents.map((a) => a.model)).size;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (q && !a.name.toLowerCase().includes(q) && !(a.role ?? '').toLowerCase().includes(q)) {
        return false;
      }
      switch (filter) {
        case 'global': return !a.mission;
        case 'scoped': return !!a.mission;
        case 'all':    return true;
      }
    });
  }, [agents, filter, search]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  return (
    <div className="px-8 py-7 w-full">
      <div className="flex items-end gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">Agents</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            {instance.name} · {agents.length} configured
          </span>
        </div>
      </div>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">No agents configured.</p>
      ) : (
        <>
          <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
            <Stat k="agents" v={agents.length} />
            <Stat k="global" v={globalCount} />
            <Stat k="scoped" v={scopedCount} />
            <Stat k="models" v={modelsCount} />

            <span className="flex-1" />

            <div className="flex items-center gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'global'} onClick={() => setFilter('global')}>Global</FilterChip>
              <FilterChip active={filter === 'scoped'} onClick={() => setFilter('scoped')}>Scoped</FilterChip>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 border border-border/60 rounded-sm w-[200px] text-foreground/90">
              <Search className="h-3 w-3 text-muted-foreground/70" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents"
                className="flex-1 bg-transparent outline-none text-[11.5px] placeholder:text-muted-foreground/60 font-sans"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm mt-10 text-center">No agents match.</p>
          ) : (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {visible.map((a) => {
                const graph = buildAgentMiniGraph(a, missions, skills);
                return (
                  <AgentCard
                    key={a.name}
                    name={a.name}
                    role={a.role}
                    model={a.model}
                    mission={a.mission ?? null}
                    tools={a.tools?.length ?? 0}
                    skills={a.skills?.length ?? 0}
                    graph={graph}
                    onClick={() => navigate(`/instances/${id}/agents/${a.name}`)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="tabular-nums text-[13px] font-medium text-foreground">{v}</span>
      <span className="tracking-[0.3px]">{k}</span>
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-sans text-[11.5px] px-2.5 py-[3px] rounded-sm border transition-colors cursor-pointer',
        active
          ? 'text-foreground bg-accent/40 border-border'
          : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/20',
      )}
    >
      {children}
    </button>
  );
}
