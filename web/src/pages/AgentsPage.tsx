import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { AgentCard } from '@/components/agent-card';
import { FilterChip, InlineStat, SearchBox } from '@/components/ui-shell';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { AgentInfo, MissionInfo, SkillInfo } from '@/api/types';

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
    refetchIntervalInBackground: false,
  });

  const agents = useMemo(() => instance?.config.agents ?? [], [instance]);
  const missions = useMemo(() => instance?.config.missions ?? [], [instance]);
  const skills = useMemo(() => instance?.config.skills ?? [], [instance]);

  const globalCount = agents.filter((a) => !a.mission).length;
  const scopedCount = agents.filter((a) => a.mission).length;
  const modelsCount = new Set(agents.map((a) => a.model)).size;

  // Precompute each agent's mini-graph so dagre layout doesn't re-run on every
  // search-box keystroke (filter is applied downstream).
  const enriched = useMemo(() => {
    return agents.map((a) => ({
      agent: a,
      graph: buildAgentMiniGraph(a, missions, skills),
    }));
  }, [agents, missions, skills]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ agent: a }) => {
      if (q && !a.name.toLowerCase().includes(q) && !(a.role ?? '').toLowerCase().includes(q)) {
        return false;
      }
      switch (filter) {
        case 'global': return !a.mission;
        case 'scoped': return !!a.mission;
        case 'all':    return true;
      }
    });
  }, [enriched, filter, search]);

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
            <InlineStat k="agents" v={agents.length} />
            <InlineStat k="global" v={globalCount} />
            <InlineStat k="scoped" v={scopedCount} />
            <InlineStat k="models" v={modelsCount} />

            <span className="flex-1" />

            <div className="flex items-center gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'global'} onClick={() => setFilter('global')}>Global</FilterChip>
              <FilterChip active={filter === 'scoped'} onClick={() => setFilter('scoped')}>Scoped</FilterChip>
            </div>

            <SearchBox value={search} onChange={setSearch} placeholder="Search agents" />
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm mt-10 text-center">No agents match.</p>
          ) : (
            <div className="sqd-card-grid">
              {visible.map(({ agent: a, graph }) => (
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
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

