import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance, runMission } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Play } from 'lucide-react';
import { EntityCard } from '@/components/entity-card';
import { PageStats } from '@/components/page-stats';
import { RunMissionDialog } from '@/components/RunMissionDialog';
import type { MiniNode, MiniEdge } from '@/components/mini-graph';
import type { MissionInfo, AgentInfo } from '@/api/types';

function buildMissionMiniGraph(mission: MissionInfo, allAgents: AgentInfo[]): { nodes: MiniNode[]; edges: MiniEdge[] } {
  const nodes: MiniNode[] = [];
  const edges: MiniEdge[] = [];

  // Mission in center
  nodes.push({ id: 'mission', color: 'teal', size: 'md' });

  // Agents on the left
  for (const aName of mission.agents ?? []) {
    nodes.push({ id: `a:${aName}`, color: 'violet', size: 'sm' });
    edges.push({ source: `a:${aName}`, target: 'mission' });
  }

  // Tasks on the right
  for (const t of mission.tasks ?? []) {
    nodes.push({ id: `t:${t.name}`, color: 'purple', size: 'sm' });
    edges.push({ source: 'mission', target: `t:${t.name}` });

    // Task dependencies
    for (const dep of t.dependsOn ?? []) {
      edges.push({ source: `t:${dep}`, target: `t:${t.name}` });
    }
  }

  return { nodes, edges };
}

export function MissionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [runningMission, setRunningMission] = useState<string | null>(null);
  const [dialogMission, setDialogMission] = useState<MissionInfo | null>(null);
  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const missions = instance?.config.missions ?? [];
  const allAgents = instance?.config.agents ?? [];

  const stats = useMemo(() => {
    const totalTasks = missions.reduce((sum, m) => sum + (m.tasks?.length ?? 0), 0);
    const withSchedules = missions.filter(m => m.schedules && m.schedules.length > 0).length;
    const withTriggers = missions.filter(m => m.trigger).length;
    return [
      { label: 'Total Missions', value: missions.length },
      { label: 'Total Tasks', value: totalTasks },
      { label: 'Scheduled', value: withSchedules },
      { label: 'Triggered', value: withTriggers },
    ];
  }, [missions]);

  const handleRun = async (mission: MissionInfo) => {
    if (!id) return;
    if (mission.inputs && mission.inputs.length > 0) {
      setDialogMission(mission);
      return;
    }
    setRunningMission(mission.name);
    try {
      const result = await runMission(id, mission.name, {});
      navigate(`/instances/${id}/runs/${result.missionId}`);
    } catch {
      setRunningMission(null);
    }
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Missions</h1>

      {missions.length === 0 ? (
        <p className="text-muted-foreground">No missions configured.</p>
      ) : (
        <>
          <PageStats stats={stats} />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {missions.map((m) => {
              const graph = buildMissionMiniGraph(m, allAgents);
              const badges: { label: string; variant?: 'default' | 'secondary' | 'outline' }[] = [
                { label: `${m.tasks?.length ?? 0} tasks`, variant: 'secondary' },
              ];
              if (m.agents && m.agents.length > 0) {
                badges.push({ label: `${m.agents.length} agents`, variant: 'secondary' });
              }
              if (m.inputs && m.inputs.length > 0) {
                badges.push({ label: `${m.inputs.length} inputs`, variant: 'outline' });
              }
              if (m.schedules && m.schedules.length > 0) {
                badges.push({ label: 'scheduled', variant: 'outline' });
              }
              return (
                <EntityCard
                  key={m.name}
                  name={m.name}
                  description={m.description}
                  variant="mission"
                  badges={badges}
                  graph={graph}
                  onClick={() => navigate(`/instances/${id}/missions/${m.name}`)}
                  action={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem
                          disabled={!instance.connected || runningMission === m.name}
                          onClick={() => handleRun(m)}
                        >
                          <Play className="h-3.5 w-3.5 mr-2" />
                          {runningMission === m.name ? 'Starting...' : 'Run Mission'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
              );
            })}
          </div>
        </>
      )}
      {dialogMission && (
        <RunMissionDialog
          instanceId={id!}
          mission={dialogMission}
          open={!!dialogMission}
          onOpenChange={(open) => { if (!open) setDialogMission(null); }}
        />
      )}
    </div>
  );
}
