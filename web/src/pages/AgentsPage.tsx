import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { EntityCard } from '@/components/entity-card';
import { PageStats } from '@/components/page-stats';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { AgentInfo, MissionInfo, SkillInfo } from '@/api/types';

function buildAgentMiniGraph(agent: AgentInfo, missions: MissionInfo[], skills: SkillInfo[]): { nodes: MiniNode[]; edges: MiniEdge[] } {
  const nodes: MiniNode[] = [];
  const edges: MiniEdge[] = [];

  // Missions on the left
  const agentMissions = missions.filter(m => m.agents?.includes(agent.name));
  for (const m of agentMissions) {
    nodes.push({ id: `m:${m.name}`, color: 'teal', size: 'sm' });
    edges.push({ source: `m:${m.name}`, target: 'agent' });
  }

  // Agent in center
  nodes.push({ id: 'agent', color: 'violet', size: 'md' });

  // Skills
  const agentSkills = skills.filter(s => agent.skills?.includes(s.name));
  for (const s of agentSkills) {
    nodes.push({ id: `s:${s.name}`, color: 'amber', size: 'sm' });
    edges.push({ source: 'agent', target: `s:${s.name}` });
  }

  // Tools/plugins on the right
  const seen = new Set<string>();
  for (const ref of agent.tools ?? []) {
    const parts = ref.split('.');
    if (parts.length >= 2) {
      const ns = (parts[0] === 'builtins' || parts[0] === 'plugins') ? parts[1] : parts[0];
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
  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const agents = instance?.config.agents ?? [];
  const missions = instance?.config.missions ?? [];
  const skills = instance?.config.skills ?? [];

  const stats = useMemo(() => {
    const global = agents.filter(a => !a.mission).length;
    const scoped = agents.filter(a => a.mission).length;
    const models = new Set(agents.map(a => a.model)).size;
    return [
      { label: 'Total Agents', value: agents.length },
      { label: 'Global', value: global },
      { label: 'Mission-Scoped', value: scoped },
      { label: 'Models', value: models },
    ];
  }, [agents]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Agents</h1>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">No agents configured.</p>
      ) : (
        <>
          <PageStats stats={stats} />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {agents.map((a) => {
              const graph = buildAgentMiniGraph(a, missions, skills);
              const badges: { label: string; variant?: 'default' | 'secondary' | 'outline' }[] = [
                { label: a.model, variant: 'secondary' },
              ];
              if (a.mission) {
                badges.push({ label: a.mission, variant: 'outline' });
              }
              if (a.tools && a.tools.length > 0) {
                badges.push({ label: `${a.tools.length} tools`, variant: 'secondary' });
              }
              if (a.skills && a.skills.length > 0) {
                badges.push({ label: `${a.skills.length} skills`, variant: 'secondary' });
              }
              return (
                <EntityCard
                  key={a.name}
                  name={a.name}
                  description={a.role}
                  variant="agent"
                  badges={badges}
                  graph={graph}
                  onClick={() => navigate(`/instances/${id}/agents/${a.name}`)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
