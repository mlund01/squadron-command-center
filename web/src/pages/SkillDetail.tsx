import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
  Handle,
  Position,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { ChevronsDown, ChevronsUp } from 'lucide-react';

import { getInstance } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { cn } from '@/lib/utils';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { ZoomControls } from '@/components/zoom-controls';
import { NodeChip } from '@/components/node-chip';
import type { SkillInfo, AgentInfo, PluginInfo, ToolInfo } from '@/api/types';
import { X } from 'lucide-react';

/* ── Node dimensions ── */
const SKILL_NODE_WIDTH = 260;
const SKILL_NODE_HEIGHT = 80;
const AGENT_NODE_WIDTH = 220;
const AGENT_NODE_HEIGHT = 60;
const PLUGIN_NODE_WIDTH = 200;
const PLUGIN_NODE_HEIGHT = 60;
const TOOL_NODE_WIDTH = 170;
const TOOL_NODE_HEIGHT = 44;

/* ── Custom Nodes ── */

function SkillNode({ data, selected }: { data: { name: string; description?: string; agent?: string }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg p-3 cursor-pointer transition-all shadow-sm',
      selected ? 'bg-muted border-2 border-foreground' : 'bg-card border-2 border-border',
    )} style={{ width: SKILL_NODE_WIDTH }}>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2.5 !h-2.5" />
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2.5 !h-2.5" />
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-sm truncate">{data.name}</span>
        {data.agent && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{data.agent}</Badge>}
        <NodeChip variant="skill" className="ml-auto" />
      </div>
      {data.description && (
        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{data.description}</p>
      )}
    </div>
  );
}

function AgentNode({ data, selected }: { data: { name: string }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg p-3 cursor-pointer transition-all shadow-sm',
      selected ? 'bg-muted border-2 border-foreground' : 'bg-card border-2 border-border',
    )} style={{ width: AGENT_NODE_WIDTH }}>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2.5 !h-2.5" />
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{data.name}</span>
        <NodeChip variant="agent" className="ml-auto" />
      </div>
    </div>
  );
}

function PluginNode({ data, selected }: { data: { name: string; toolCount: number; builtin?: boolean }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg p-3 cursor-pointer transition-all shadow-sm',
      selected ? 'bg-muted border-2 border-foreground' : 'bg-card border-2 border-border',
    )} style={{ width: PLUGIN_NODE_WIDTH }}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2.5 !h-2.5" />
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{data.name}</span>
        <NodeChip variant={data.builtin ? 'builtin' : 'plugin'} className="ml-auto" />
        <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">{data.toolCount}</Badge>
      </div>
    </div>
  );
}

function ToolNode({ data, selected }: { data: { name: string }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-md px-2.5 py-1.5 cursor-pointer transition-all text-xs shadow-sm',
      selected ? 'bg-muted border-2 border-foreground' : 'bg-card border border-border',
    )} style={{ width: TOOL_NODE_WIDTH }}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />
      <div className="flex items-center gap-1.5">
        <span className="truncate">{data.name}</span>
        <NodeChip variant="tool" className="ml-auto" />
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  skill: SkillNode,
  agent: AgentNode,
  plugin: PluginNode,
  tool: ToolNode,
};

/* ── Graph Layout ── */

function layoutSkillGraph(skill: SkillInfo, agents: AgentInfo[], allPlugins: PluginInfo[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 25, ranksep: 100 });

  const nodeMeta: { id: string; type: string; width: number; height: number; data: Record<string, unknown> }[] = [];
  const edges: Edge[] = [];

  // Skill node (center)
  const skillId = `skill:${skill.name}`;
  g.setNode(skillId, { width: SKILL_NODE_WIDTH, height: SKILL_NODE_HEIGHT });
  nodeMeta.push({ id: skillId, type: 'skill', width: SKILL_NODE_WIDTH, height: SKILL_NODE_HEIGHT, data: { name: skill.name, description: skill.description, agent: skill.agent } });

  // Agent nodes (left)
  const filteredAgents = agents.filter((a) => a.skills?.includes(skill.name));
  const agentNames = new Set<string>();
  for (const a of filteredAgents) {
    const agentId = `agent:${a.name}`;
    if (agentNames.has(a.name)) continue;
    agentNames.add(a.name);
    g.setNode(agentId, { width: AGENT_NODE_WIDTH, height: AGENT_NODE_HEIGHT });
    nodeMeta.push({ id: agentId, type: 'agent', width: AGENT_NODE_WIDTH, height: AGENT_NODE_HEIGHT, data: { name: a.name } });
    g.setEdge(agentId, skillId);
    edges.push({ id: `${agentId}->${skillId}`, source: agentId, target: skillId });
  }

  // Parse tool refs into plugin groups
  const pluginTools = new Map<string, string[]>();
  for (const toolRef of skill.tools ?? []) {
    const parts = toolRef.split('.');
    if (parts.length >= 2) {
      const ns = parts[0] === 'builtins' || parts[0] === 'plugins' ? parts[1] : parts[0];
      const toolName = parts.length >= 3 ? parts[2] : parts[1];
      const isBuiltin = parts[0] === 'builtins';
      const key = `${isBuiltin ? 'builtin' : 'plugin'}:${ns}`;
      if (!pluginTools.has(key)) pluginTools.set(key, []);
      if (toolName !== 'all') {
        pluginTools.get(key)!.push(toolName);
      } else {
        const plugin = allPlugins.find(p => p.name === ns);
        if (plugin?.tools) {
          for (const t of plugin.tools) pluginTools.get(key)!.push(t.name);
        }
      }
    }
  }

  // Plugin + tool nodes (right)
  for (const [key, tools] of pluginTools) {
    const [type, ns] = key.split(':');
    const pluginId = `plugin:${ns}`;
    const isBuiltin = type === 'builtin';

    g.setNode(pluginId, { width: PLUGIN_NODE_WIDTH, height: PLUGIN_NODE_HEIGHT });
    nodeMeta.push({ id: pluginId, type: 'plugin', width: PLUGIN_NODE_WIDTH, height: PLUGIN_NODE_HEIGHT, data: { name: ns, toolCount: tools.length, builtin: isBuiltin } });
    g.setEdge(skillId, pluginId);
    edges.push({ id: `${skillId}->${pluginId}`, source: skillId, target: pluginId });

    for (const toolName of tools) {
      const toolId = `tool:${ns}:${toolName}`;
      g.setNode(toolId, { width: TOOL_NODE_WIDTH, height: TOOL_NODE_HEIGHT });
      nodeMeta.push({ id: toolId, type: 'tool', width: TOOL_NODE_WIDTH, height: TOOL_NODE_HEIGHT, data: { name: toolName } });
      g.setEdge(pluginId, toolId);
      edges.push({ id: `${pluginId}->${toolId}`, source: pluginId, target: toolId });
    }
  }

  dagre.layout(g);

  const nodes: Node[] = nodeMeta.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: n.type,
      position: { x: pos.x - n.width / 2, y: pos.y - n.height / 2 },
      data: n.data,
    };
  });

  return { nodes, edges };
}

/* ── Main Page ── */

export function SkillDetail() {
  const { id, name } = useParams<{ id: string; name: string }>();

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const {
    panelHeight,
    containerRef,
    reactFlowRef,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    togglePanel,
    getMaxHeight,
    onInit,
  } = useResizablePanel();

  const [activeTab, setActiveTab] = useState('general');

  const skill = instance?.config.skills?.find((s) => s.name === name) ?? null;

  const skillAgents = useMemo(() => {
    return (instance?.config.agents ?? []).filter((a) => a.skills?.includes(name!));
  }, [instance?.config.agents, name]);

  const { nodes: rawNodes, edges } = useMemo(() => {
    if (!skill || !instance) return { nodes: [], edges: [] };
    return layoutSkillGraph(skill, instance.config.agents ?? [], instance.config.plugins ?? []);
  }, [skill, instance]);

  const nodes = useMemo(() => {
    return rawNodes.map((n) => {
      let isSelected = false;
      if (activeTab === 'general' || activeTab === 'instructions') {
        if (n.id === `skill:${name}`) isSelected = true;
      } else if (activeTab === 'agents') {
        if (n.type === 'agent') isSelected = true;
      } else if (activeTab === 'tools') {
        if (n.id === `skill:${name}` || n.type === 'plugin' || n.type === 'tool') isSelected = true;
      }
      return { ...n, selected: isSelected };
    });
  }, [rawNodes, activeTab, name]);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.id === `skill:${name}`) {
      setActiveTab('general');
    } else if (node.type === 'agent') {
      setActiveTab('agents');
    } else if (node.type === 'plugin' || node.type === 'tool') {
      setActiveTab('tools');
    }
  }, [name]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;
  if (!skill) return <div className="p-8 text-muted-foreground">Skill not found</div>;

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Graph canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={onInit}
          onNodeClick={onNodeClick}
          fitView
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          minZoom={0.3}
          maxZoom={1.5}
        >
          <Background gap={20} size={1} />
        </ReactFlow>
        <ZoomControls reactFlowRef={reactFlowRef} />
      </div>

      {/* Bottom panel with tabs */}
      <div
        className="shrink-0 border-t flex flex-col"
        style={{ height: panelHeight }}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
          <div
            className="shrink-0 flex items-center gap-2 px-4 border-b bg-muted/30 cursor-ns-resize select-none"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
          >
            <TabsList variant="line">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="instructions">Instructions</TabsTrigger>
              <TabsTrigger value="agents">
                Agents
                {skillAgents.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                    {skillAgents.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="tools">
                Tools
                {skill.tools && skill.tools.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                    {skill.tools.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <div className="ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={togglePanel}
              >
                {panelHeight >= getMaxHeight() ? (
                  <ChevronsDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsUp className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="general" className="h-full m-0">
              <div className="p-4 overflow-y-auto h-full space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{skill.name}</h3>
                  {skill.agent ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{skill.agent}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Global</span>
                  )}
                </div>

                {skill.description && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Description
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">{skill.description}</p>
                  </div>
                )}

                {skill.tools && skill.tools.length > 0 && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Tools
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {skill.tools.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="instructions" className="h-full m-0 overflow-auto">
              <MarkdownPreview content={skill.instructions} />
            </TabsContent>
            <TabsContent value="agents" className="h-full m-0">
              <SkillAgentsTabContent agents={skillAgents} instanceId={id!} />
            </TabsContent>
            <TabsContent value="tools" className="h-full m-0">
              <SkillToolsTabContent skill={skill} plugins={instance.config.plugins ?? []} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

/* ── Agents tab ── */

function SkillAgentsTabContent({ agents, instanceId }: { agents: AgentInfo[]; instanceId: string }) {
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(agents[0] ?? null);

  useEffect(() => {
    if (!selectedAgent && agents.length) setSelectedAgent(agents[0]);
  }, [agents, selectedAgent]);

  if (!agents.length) {
    return <p className="text-sm text-muted-foreground p-4">No agents use this skill.</p>;
  }

  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {agents.map((a) => (
            <button
              key={a.name}
              onClick={() => setSelectedAgent(a)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedAgent?.name === a.name && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{a.name}</span>
                {a.mission && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{a.mission}</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {selectedAgent ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{selectedAgent.name}</h3>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{selectedAgent.model}</Badge>
              <button
                onClick={() => navigate(`/instances/${instanceId}/agents/${selectedAgent.name}`)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View agent →
              </button>
            </div>

            {selectedAgent.role && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Role
                </span>
                <p className="text-xs text-muted-foreground mt-1">{selectedAgent.role}</p>
              </div>
            )}

            {selectedAgent.tools && selectedAgent.tools.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Direct Tools
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedAgent.tools.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {selectedAgent.skills && selectedAgent.skills.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Skills
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedAgent.skills.map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Tools tab ── */

interface SkillPluginGroup {
  name: string;
  builtin: boolean;
  tools: string[];
  pluginInfo?: PluginInfo;
}

function parseSkillToolRefs(skill: SkillInfo, allPlugins: PluginInfo[]): SkillPluginGroup[] {
  const groups = new Map<string, SkillPluginGroup>();
  for (const ref of skill.tools ?? []) {
    const parts = ref.split('.');
    if (parts.length < 2) continue;
    const isBuiltin = parts[0] === 'builtins';
    const ns = (parts[0] === 'builtins' || parts[0] === 'plugins') ? parts[1] : parts[0];
    const toolName = parts.length >= 3 ? parts[2] : parts[1];

    if (!groups.has(ns)) {
      const pluginInfo = allPlugins.find(p => p.name === ns);
      groups.set(ns, { name: ns, builtin: isBuiltin, tools: [], pluginInfo });
    }
    const group = groups.get(ns)!;
    if (toolName === 'all') {
      const plugin = allPlugins.find(p => p.name === ns);
      if (plugin?.tools) {
        for (const t of plugin.tools) {
          const tName = typeof t === 'string' ? t : t.name;
          if (!group.tools.includes(tName)) group.tools.push(tName);
        }
      }
    } else {
      if (!group.tools.includes(toolName)) group.tools.push(toolName);
    }
  }
  return [...groups.values()];
}

function SkillToolsTabContent({ skill, plugins }: { skill: SkillInfo; plugins: PluginInfo[] }) {
  const groups = useMemo(() => parseSkillToolRefs(skill, plugins), [skill, plugins]);
  const [selectedGroup, setSelectedGroup] = useState<SkillPluginGroup | null>(groups[0] ?? null);
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);

  useEffect(() => {
    if (!selectedGroup && groups.length) setSelectedGroup(groups[0]);
  }, [groups, selectedGroup]);

  if (!groups.length) {
    return <p className="text-sm text-muted-foreground p-4">This skill does not add any tools.</p>;
  }

  const pluginTools = selectedGroup?.pluginInfo?.tools ?? [];
  const normalizedTools: ToolInfo[] = pluginTools.map(t => typeof t === 'string' ? { name: t } : t as ToolInfo);
  const toolsByName = new Map(normalizedTools.map(t => [t.name, t]));

  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {groups.map((g) => (
            <button
              key={g.name}
              onClick={() => { setSelectedGroup(g); setSelectedTool(null); }}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedGroup?.name === g.name && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{g.name}</span>
                {g.builtin && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">builtin</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {selectedGroup ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{selectedGroup.name}</h3>
              {selectedGroup.builtin && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">builtin</Badge>
              )}
            </div>

            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Tools provided by this skill
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {selectedGroup.tools.map((t) => {
                  const info = toolsByName.get(t);
                  return (
                    <Badge
                      key={t}
                      variant={selectedTool?.name === t ? 'default' : 'outline'}
                      className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted"
                      onClick={() => setSelectedTool(info ?? { name: t })}
                    >
                      {t}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {selectedTool && (
        <div className="w-80 shrink-0 border-l overflow-y-auto p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm truncate">{selectedTool.name}</h3>
              <button
                onClick={() => setSelectedTool(null)}
                className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            {selectedTool.description && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </span>
                <p className="text-xs text-muted-foreground mt-1">{selectedTool.description}</p>
              </div>
            )}
            {selectedTool.parameters?.properties && Object.keys(selectedTool.parameters.properties).length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Parameters
                </span>
                <div className="mt-1 space-y-1.5">
                  {Object.entries(selectedTool.parameters.properties).map(([pName, prop]) => {
                    const isRequired = selectedTool.parameters?.required?.includes(pName);
                    return (
                      <div key={pName} className="text-xs">
                        <span className="font-mono font-medium">{pName}</span>
                        <span className="text-muted-foreground ml-1">({prop.type})</span>
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                        {prop.description && (
                          <p className="text-muted-foreground mt-0.5 ml-2">{prop.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
