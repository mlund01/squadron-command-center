import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { SkillCard } from '@/components/skill-card';
import { FilterChip, InlineStat, SearchBox } from '@/components/ui-shell';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { SkillInfo, AgentInfo, PluginInfo } from '@/api/types';

type FilterKey = 'all' | 'global' | 'scoped' | 'unused';

function buildSkillMiniGraph(
  skill: SkillInfo,
  allAgents: AgentInfo[],
  allPlugins: PluginInfo[],
): { nodes: MiniNode[]; edges: MiniEdge[] } {
  const nodes: MiniNode[] = [];
  const edges: MiniEdge[] = [];

  const agents = allAgents.filter((a) => a.skills?.includes(skill.name));
  for (const a of agents) {
    nodes.push({ id: `a:${a.name}`, color: 'violet', size: 'sm' });
    edges.push({ source: `a:${a.name}`, target: 'skill' });
  }

  nodes.push({ id: 'skill', color: 'amber', size: 'md' });

  const seen = new Set<string>();
  for (const ref of skill.tools ?? []) {
    const parts = ref.split('.');
    if (parts.length < 2) continue;
    const ns = parts[0] === 'builtins' || parts[0] === 'plugins' ? parts[1] : parts[0];
    const toolName = parts.length >= 3 ? parts[2] : null;

    if (!seen.has(ns)) {
      seen.add(ns);
      nodes.push({ id: `p:${ns}`, color: 'blue', size: 'sm' });
      edges.push({ source: 'skill', target: `p:${ns}` });
    }

    if (toolName && toolName !== 'all') {
      const toolId = `t:${ns}:${toolName}`;
      if (!seen.has(toolId)) {
        seen.add(toolId);
        nodes.push({ id: toolId, color: 'slate', size: 'sm' });
        edges.push({ source: `p:${ns}`, target: toolId });
      }
    } else if (toolName === 'all') {
      const plugin = allPlugins.find((p) => p.name === ns);
      for (const t of plugin?.tools ?? []) {
        const tName = typeof t === 'string' ? t : t.name;
        const toolId = `t:${ns}:${tName}`;
        if (!seen.has(toolId)) {
          seen.add(toolId);
          nodes.push({ id: toolId, color: 'slate', size: 'sm' });
          edges.push({ source: `p:${ns}`, target: toolId });
        }
      }
    }
  }

  return { nodes, edges };
}

export function SkillsPage() {
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

  const skills = useMemo(() => {
    return [...(instance?.config.skills ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [instance?.config.skills]);

  const allAgents = useMemo(() => instance?.config.agents ?? [], [instance]);
  const allPlugins = useMemo(() => instance?.config.plugins ?? [], [instance]);

  const usedByCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allAgents) {
      for (const s of a.skills ?? []) m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [allAgents]);

  const globalCount = skills.filter((s) => !s.agent).length;
  const scopedCount = skills.filter((s) => s.agent).length;
  const withToolsCount = skills.filter((s) => (s.tools?.length ?? 0) > 0).length;

  // Precompute each skill's mini-graph (keeps dagre off the render hot path).
  const enriched = useMemo(() => {
    return skills.map((s) => ({
      skill: s,
      graph: buildSkillMiniGraph(s, allAgents, allPlugins),
      usedBy: usedByCount.get(s.name) ?? 0,
    }));
  }, [skills, allAgents, allPlugins, usedByCount]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ skill: s, usedBy }) => {
      if (q && !s.name.toLowerCase().includes(q) && !(s.description ?? '').toLowerCase().includes(q)) {
        return false;
      }
      switch (filter) {
        case 'global': return !s.agent;
        case 'scoped': return !!s.agent;
        case 'unused': return usedBy === 0;
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
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">Skills</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            {instance.name} · {skills.length} configured
          </span>
        </div>
      </div>

      {skills.length === 0 ? (
        <p className="text-muted-foreground">No skills configured.</p>
      ) : (
        <>
          <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
            <InlineStat k="skills" v={skills.length} />
            <InlineStat k="global" v={globalCount} />
            <InlineStat k="scoped" v={scopedCount} />
            <InlineStat k="with tools" v={withToolsCount} />

            <span className="flex-1" />

            <div className="flex items-center gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'global'} onClick={() => setFilter('global')}>Global</FilterChip>
              <FilterChip active={filter === 'scoped'} onClick={() => setFilter('scoped')}>Scoped</FilterChip>
              <FilterChip active={filter === 'unused'} onClick={() => setFilter('unused')}>Unused</FilterChip>
            </div>

            <SearchBox value={search} onChange={setSearch} placeholder="Search skills" />
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm mt-10 text-center">No skills match.</p>
          ) : (
            <div className="sqd-card-grid">
              {visible.map(({ skill: s, graph, usedBy }) => (
                <SkillCard
                  key={`${s.agent ?? 'global'}-${s.name}`}
                  name={s.name}
                  description={s.description}
                  tools={s.tools?.length ?? 0}
                  usedBy={usedBy}
                  agent={s.agent ?? null}
                  graph={graph}
                  onClick={() => navigate(`/instances/${id}/skills/${s.name}`)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

