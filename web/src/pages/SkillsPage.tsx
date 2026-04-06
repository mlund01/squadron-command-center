import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { EntityCard } from '@/components/entity-card';
import { PageStats } from '@/components/page-stats';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { SkillInfo, AgentInfo, PluginInfo } from '@/api/types';

function buildSkillMiniGraph(skill: SkillInfo, allAgents: AgentInfo[], allPlugins: PluginInfo[]): { nodes: MiniNode[]; edges: MiniEdge[] } {
  const nodes: MiniNode[] = [];
  const edges: MiniEdge[] = [];

  // Agents on the left
  const agents = allAgents.filter((a) => a.skills?.includes(skill.name));
  for (const a of agents) {
    nodes.push({ id: `a:${a.name}`, color: 'violet', size: 'sm' });
    edges.push({ source: `a:${a.name}`, target: 'skill' });
  }

  // Skill in center
  nodes.push({ id: 'skill', color: 'amber', size: 'md' });

  // Plugins/tools on the right
  const seen = new Set<string>();
  for (const ref of skill.tools ?? []) {
    const parts = ref.split('.');
    if (parts.length < 2) continue;
    const ns = (parts[0] === 'builtins' || parts[0] === 'plugins') ? parts[1] : parts[0];
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
      const plugin = allPlugins.find(p => p.name === ns);
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
  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const skills = useMemo(() => {
    return [...(instance?.config.skills ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [instance?.config.skills]);

  const allAgents = instance?.config.agents ?? [];
  const allPlugins = instance?.config.plugins ?? [];

  const stats = useMemo(() => {
    const global = skills.filter(s => !s.agent).length;
    const scoped = skills.filter(s => s.agent).length;
    const withTools = skills.filter(s => s.tools && s.tools.length > 0).length;
    return [
      { label: 'Total Skills', value: skills.length },
      { label: 'Global', value: global },
      { label: 'Agent-Scoped', value: scoped },
      { label: 'With Tools', value: withTools },
    ];
  }, [skills]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Skills</h1>

      {skills.length === 0 ? (
        <p className="text-muted-foreground">No skills configured.</p>
      ) : (
        <>
          <PageStats stats={stats} />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {skills.map((s) => {
              const graph = buildSkillMiniGraph(s, allAgents, allPlugins);
              const badges: { label: string; variant?: 'default' | 'secondary' | 'outline' }[] = [];
              if (s.agent) {
                badges.push({ label: s.agent, variant: 'outline' });
              } else {
                badges.push({ label: 'Global', variant: 'secondary' });
              }
              if (s.tools && s.tools.length > 0) {
                badges.push({ label: `${s.tools.length} tools`, variant: 'secondary' });
              }
              return (
                <EntityCard
                  key={`${s.agent ?? 'global'}-${s.name}`}
                  name={s.name}
                  description={s.description}
                  variant="skill"
                  badges={badges}
                  graph={graph}
                  onClick={() => navigate(`/instances/${id}/skills/${s.name}`)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
