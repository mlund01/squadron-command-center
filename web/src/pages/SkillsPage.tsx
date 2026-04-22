import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { getInstance } from '@/api/client';
import { SkillCard } from '@/components/skill-card';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { SkillInfo, AgentInfo, PluginInfo } from '@/api/types';
import { cn } from '@/lib/utils';

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) && !(s.description ?? '').toLowerCase().includes(q)) {
        return false;
      }
      switch (filter) {
        case 'global': return !s.agent;
        case 'scoped': return !!s.agent;
        case 'unused': return (usedByCount.get(s.name) ?? 0) === 0;
        case 'all':    return true;
      }
    });
  }, [skills, filter, search, usedByCount]);

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
            <Stat k="skills" v={skills.length} />
            <Stat k="global" v={globalCount} />
            <Stat k="scoped" v={scopedCount} />
            <Stat k="with tools" v={withToolsCount} />

            <span className="flex-1" />

            <div className="flex items-center gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'global'} onClick={() => setFilter('global')}>Global</FilterChip>
              <FilterChip active={filter === 'scoped'} onClick={() => setFilter('scoped')}>Scoped</FilterChip>
              <FilterChip active={filter === 'unused'} onClick={() => setFilter('unused')}>Unused</FilterChip>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 border border-border/60 rounded-sm w-[200px] text-foreground/90">
              <Search className="h-3 w-3 text-muted-foreground/70" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills"
                className="flex-1 bg-transparent outline-none text-[11.5px] placeholder:text-muted-foreground/60 font-sans"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm mt-10 text-center">No skills match.</p>
          ) : (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {visible.map((s) => {
                const graph = buildSkillMiniGraph(s, allAgents, allPlugins);
                return (
                  <SkillCard
                    key={`${s.agent ?? 'global'}-${s.name}`}
                    name={s.name}
                    description={s.description}
                    tools={s.tools?.length ?? 0}
                    usedBy={usedByCount.get(s.name) ?? 0}
                    agent={s.agent ?? null}
                    graph={graph}
                    onClick={() => navigate(`/instances/${id}/skills/${s.name}`)}
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
