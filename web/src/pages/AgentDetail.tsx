import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ChevronsDown, ChevronsUp, X } from 'lucide-react';

import { getInstance, sendChatMessage, getChatHistory, getChatMessages, archiveChat } from '@/api/client';
import { subscribeChatEvents } from '@/api/chat-sse';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { StatusBadge, formatTime } from '@/lib/mission-utils';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { ZoomControls } from '@/components/zoom-controls';
import type { AgentInfo, MissionInfo, PluginInfo, ToolInfo, ChatSessionInfo, ChatEvent } from '@/api/types';

/* ── Chat types & component (preserved) ── */

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tools?: { name: string; status: 'calling' | 'complete' }[];
}

function AgentChat({ instanceId, agentName, connected, initialMessages, existingSessionId, onChatCreated }: {
  instanceId: string;
  agentName: string;
  connected: boolean;
  initialMessages?: ChatMessage[];
  existingSessionId?: string;
  onChatCreated?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionIdRef = useRef<string | undefined>(existingSessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setInput('');
    setIsStreaming(true);
    inputRef.current?.focus();

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoning: '', tools: [] }]);

    try {
      // Send message first — backend returns the sessionId in the ack
      const response = await sendChatMessage(instanceId, agentName, trimmed, sessionIdRef.current);
      const activeSessionId = response.sessionId;
      if (!sessionIdRef.current) {
        sessionIdRef.current = activeSessionId;
      }

      // Subscribe to SSE — buffered events are replayed immediately
      subscribeChatEvents(
        instanceId,
        activeSessionId,
        (event: ChatEvent) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };

            switch (event.eventType) {
              case 'reasoning_chunk': {
                const content = (event.data as { content?: string })?.content ?? '';
                last.reasoning = (last.reasoning ?? '') + content;
                break;
              }
              case 'answer_chunk': {
                const content = (event.data as { content?: string })?.content ?? '';
                last.content += content;
                break;
              }
              case 'calling_tool': {
                const toolName = (event.data as { toolName?: string })?.toolName ?? 'unknown';
                last.tools = [...(last.tools ?? []), { name: toolName, status: 'calling' }];
                break;
              }
              case 'tool_complete': {
                const toolName = (event.data as { toolName?: string })?.toolName ?? '';
                last.tools = (last.tools ?? []).map((t) =>
                  t.name === toolName && t.status === 'calling'
                    ? { ...t, status: 'complete' as const }
                    : t
                );
                break;
              }
              case 'error': {
                const msg = (event.data as { message?: string })?.message ?? 'Unknown error';
                last.content += `\n\n[Error: ${msg}]`;
                break;
              }
            }

            updated[updated.length - 1] = last;
            return updated;
          });
        },
        () => {
          setIsStreaming(false);
          inputRef.current?.focus();
          onChatCreated?.();
        },
        (error) => {
          setIsStreaming(false);
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            last.content += `\n\n[Connection error: ${error}]`;
            updated[updated.length - 1] = last;
            return updated;
          });
        },
      );
    } catch (err) {
      setIsStreaming(false);
      setMessages((prev) => {
        const updated = [...prev];
        const last = { ...updated[updated.length - 1] };
        last.content = `[Failed to send: ${err instanceof Error ? err.message : 'unknown error'}]`;
        updated[updated.length - 1] = last;
        return updated;
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm text-center mt-8">
            Send a message to start chatting.
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              {msg.role === 'assistant' && msg.reasoning && (
                <details className="mb-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                    Reasoning
                  </summary>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                    {msg.reasoning}
                  </p>
                </details>
              )}

              {msg.role === 'assistant' && msg.tools && msg.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.tools.map((tool, j) => (
                    <Badge
                      key={j}
                      variant={tool.status === 'complete' ? 'secondary' : 'outline'}
                      className="text-[10px]"
                    >
                      {tool.status === 'calling' ? '... ' : '+ '}
                      {tool.name}
                    </Badge>
                  ))}
                </div>
              )}

              <p className="text-sm whitespace-pre-wrap break-words">
                {msg.content}
                {msg.role === 'assistant' && isStreaming && i === messages.length - 1 && !msg.content && (
                  <span className="text-muted-foreground">Thinking...</span>
                )}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t p-3 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={!connected}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={isStreaming || !input.trim() || !connected}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function bareToolName(agentTool: string): string {
  const match = agentTool.match(/^plugins\.[^.]+\.(.+)$/);
  return match ? match[1] : agentTool;
}

/* ── Node dimensions ── */

const AGENT_NODE_WIDTH = 300;
const AGENT_NODE_HEIGHT = 120;
const MISSION_NODE_WIDTH = 220;
const MISSION_NODE_HEIGHT = 80;
const PLUGIN_NODE_WIDTH = 220;
const PLUGIN_NODE_HEIGHT = 80;
const TOOL_NODE_WIDTH = 180;
const TOOL_NODE_HEIGHT = 50;

/* ── Custom node components ── */

function AgentNode({ data, selected }: { data: { agent: AgentInfo }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg p-4 cursor-pointer transition-all w-[300px]',
      selected
        ? 'bg-muted border-2 border-foreground shadow-md'
        : 'bg-card border-2 border-foreground/20 shadow-md',
    )}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2.5 !h-2.5" />
      <div className="flex items-center gap-2 mb-1">
        <span className="font-bold text-base">{data.agent.name}</span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{data.agent.model}</Badge>
      </div>
      {data.agent.role && (
        <p className="text-xs text-muted-foreground line-clamp-2">{data.agent.role}</p>
      )}
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2.5 !h-2.5" />
    </div>
  );
}

function MissionNode({ data, selected }: { data: { mission: MissionInfo }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg p-3 cursor-pointer transition-all w-[220px]',
      selected ? 'bg-muted border-2 border-foreground shadow-sm' : 'bg-card border-2 border-border shadow-sm',
    )}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-semibold text-sm">{data.mission.name}</span>
      </div>
      {data.mission.tasks && (
        <p className="text-xs text-muted-foreground">
          {data.mission.tasks.length} {data.mission.tasks.length === 1 ? 'task' : 'tasks'}
        </p>
      )}
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2 !h-2" />
    </div>
  );
}

function PluginNode({ data, selected }: { data: { plugin: PluginInfo; agentToolCount: number }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg p-3 cursor-pointer transition-all w-[220px]',
      selected ? 'bg-muted border-2 border-foreground shadow-sm' : 'bg-card border-2 border-border shadow-sm',
    )}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-semibold text-sm">{data.plugin.name}</span>
        {data.plugin.builtin && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">builtin</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {data.agentToolCount} {data.agentToolCount === 1 ? 'tool' : 'tools'}
      </p>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2 !h-2" />
    </div>
  );
}

function ToolNode({ data, selected }: { data: { toolName: string; pluginName: string }; selected?: boolean }) {
  return (
    <div className={cn(
      'rounded-md px-3 py-2 cursor-pointer transition-all w-[180px]',
      selected ? 'bg-muted border-2 border-foreground' : 'bg-card border border-border',
    )}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-1.5 !h-1.5" />
      <span className="text-xs font-mono truncate block">{bareToolName(data.toolName)}</span>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  mission: MissionNode,
  plugin: PluginNode,
  tool: ToolNode,
};

/* ── Graph layout ── */

interface AgentGraphData {
  agentInfo: AgentInfo;
  missions: MissionInfo[];
  plugins: PluginInfo[];
  toolToPlugin: Map<string, string>;
  agentToolsByPlugin: Map<string, string[]>;
}

function layoutAgentGraph(data: AgentGraphData): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 120 });

  const agentId = `agent:${data.agentInfo.name}`;
  g.setNode(agentId, { width: AGENT_NODE_WIDTH, height: AGENT_NODE_HEIGHT });

  const edges: Edge[] = [];
  const nodeMeta: { id: string; type: string; data: Record<string, unknown>; width: number; height: number }[] = [];

  nodeMeta.push({
    id: agentId,
    type: 'agent',
    data: { agent: data.agentInfo },
    width: AGENT_NODE_WIDTH,
    height: AGENT_NODE_HEIGHT,
  });

  // Mission nodes (left of agent)
  for (const mission of data.missions) {
    const mId = `mission:${mission.name}`;
    g.setNode(mId, { width: MISSION_NODE_WIDTH, height: MISSION_NODE_HEIGHT });
    g.setEdge(mId, agentId);
    edges.push({ id: `${mId}->${agentId}`, source: mId, target: agentId });
    nodeMeta.push({
      id: mId,
      type: 'mission',
      data: { mission },
      width: MISSION_NODE_WIDTH,
      height: MISSION_NODE_HEIGHT,
    });
  }

  // Plugin nodes (right of agent) + Tool nodes (right of plugins)
  for (const plugin of data.plugins) {
    const pId = `plugin:${plugin.name}`;
    const agentTools = data.agentToolsByPlugin.get(plugin.name) ?? [];

    g.setNode(pId, { width: PLUGIN_NODE_WIDTH, height: PLUGIN_NODE_HEIGHT });
    g.setEdge(agentId, pId);
    edges.push({ id: `${agentId}->${pId}`, source: agentId, target: pId });
    nodeMeta.push({
      id: pId,
      type: 'plugin',
      data: { plugin, agentToolCount: agentTools.length },
      width: PLUGIN_NODE_WIDTH,
      height: PLUGIN_NODE_HEIGHT,
    });

    for (const toolName of agentTools) {
      const tId = `tool:${toolName}`;
      g.setNode(tId, { width: TOOL_NODE_WIDTH, height: TOOL_NODE_HEIGHT });
      g.setEdge(pId, tId);
      edges.push({ id: `${pId}->${tId}`, source: pId, target: tId });
      nodeMeta.push({
        id: tId,
        type: 'tool',
        data: { toolName, pluginName: plugin.name },
        width: TOOL_NODE_WIDTH,
        height: TOOL_NODE_HEIGHT,
      });
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

/* ── Tab content components ── */

function GeneralTabContent({ agent }: { agent: AgentInfo }) {
  return (
    <div className="overflow-y-auto p-4 h-full">
      <div className="space-y-4 max-w-2xl">
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Model
          </span>
          <p className="text-sm mt-1">{agent.model}</p>
        </div>

        {agent.role && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Role
            </span>
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed">
              {agent.role}
            </p>
          </div>
        )}

        {agent.description && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </span>
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed">
              {agent.description}
            </p>
          </div>
        )}

        {agent.tools && agent.tools.length > 0 && (
          <div>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Tools
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {agent.tools.map((tool) => (
                <Badge key={tool} variant="outline" className="text-[10px] px-1.5 py-0">
                  {tool}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MissionsTabContent({
  missions,
  selectedMission,
  onSelectMission,
  instanceId,
}: {
  missions: MissionInfo[];
  selectedMission: MissionInfo | null;
  onSelectMission: (m: MissionInfo) => void;
  instanceId: string;
}) {
  if (!missions.length) {
    return <p className="text-sm text-muted-foreground p-4">This agent is not assigned to any missions.</p>;
  }
  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {missions.map((m) => (
            <button
              key={m.name}
              onClick={() => onSelectMission(m)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedMission?.name === m.name && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{m.name}</span>
                {m.tasks && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                    {m.tasks.length}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {selectedMission ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{selectedMission.name}</h3>
              <Link
                to={`/instances/${instanceId}/missions/${selectedMission.name}`}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View mission →
              </Link>
            </div>

            {selectedMission.description && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </span>
                <p className="text-xs text-muted-foreground mt-1">{selectedMission.description}</p>
              </div>
            )}

            {selectedMission.commander && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Commander
                </span>
                <p className="text-xs mt-1">{selectedMission.commander}</p>
              </div>
            )}

            {selectedMission.tasks && selectedMission.tasks.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Tasks
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedMission.tasks.map((t) => (
                    <Badge key={t.name} variant="outline" className="text-[10px] px-1.5 py-0">
                      {t.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {selectedMission.agents && selectedMission.agents.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Agents
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedMission.agents.map((a) => (
                    <Badge key={a} variant="secondary" className="text-[10px] px-1.5 py-0">
                      {a}
                    </Badge>
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

/** Normalize plugin tools — handles both legacy string[] and new ToolInfo[] formats */
function normalizePluginTools(tools?: (string | ToolInfo)[]): ToolInfo[] {
  if (!tools) return [];
  return tools.map((t) => (typeof t === 'string' ? { name: t } : t));
}

function PluginsTabContent({
  plugins,
  selectedPlugin,
  onSelectPlugin,
  agentToolsByPlugin,
}: {
  plugins: PluginInfo[];
  selectedPlugin: PluginInfo | null;
  onSelectPlugin: (p: PluginInfo) => void;
  agentToolsByPlugin: Map<string, string[]>;
}) {
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);

  if (!plugins.length) {
    return <p className="text-sm text-muted-foreground p-4">No plugins provide tools for this agent.</p>;
  }

  const allPluginTools = normalizePluginTools(selectedPlugin?.tools as (string | ToolInfo)[] | undefined);
  const toolsByName = new Map(allPluginTools.map((t) => [t.name, t]));
  const usedAgentTools = selectedPlugin ? (agentToolsByPlugin.get(selectedPlugin.name) ?? []) : [];
  const usedBareNames = new Set(usedAgentTools.map(bareToolName));
  const unusedTools = allPluginTools.filter((t) => !usedBareNames.has(t.name));

  const handleSelectPlugin = (p: PluginInfo) => {
    onSelectPlugin(p);
    setSelectedTool(null);
  };

  return (
    <div className="flex h-full">
      {/* Plugin list */}
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="py-1">
          {plugins.map((p) => (
            <button
              key={p.name}
              onClick={() => handleSelectPlugin(p)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                selectedPlugin?.name === p.name && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{p.name}</span>
                {p.builtin && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                    builtin
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Plugin detail with tool chips */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedPlugin ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{selectedPlugin.name}</h3>
              {selectedPlugin.builtin && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">builtin</Badge>
              )}
            </div>

            {selectedPlugin.path && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Path
                </span>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{selectedPlugin.path}</p>
              </div>
            )}

            {(usedAgentTools.length > 0 || allPluginTools.length > 0) && (
              <div>
                {usedAgentTools.length > 0 && (
                  <>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Tools used by this agent
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {usedAgentTools.map((t) => {
                        const name = bareToolName(t);
                        const info = toolsByName.get(name);
                        return (
                          <Badge
                            key={t}
                            variant={selectedTool?.name === name ? 'default' : 'outline'}
                            className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted"
                            onClick={() => setSelectedTool(info ?? { name })}
                          >
                            {name}
                          </Badge>
                        );
                      })}
                    </div>
                  </>
                )}
                {unusedTools.length > 0 && (
                  <div className={usedAgentTools.length > 0 ? 'mt-2' : ''}>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Other plugin tools
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {unusedTools.map((t) => (
                        <Badge
                          key={t.name}
                          variant={selectedTool?.name === t.name ? 'default' : 'outline'}
                          className="text-[10px] px-1.5 py-0 opacity-50 cursor-pointer hover:opacity-75"
                          onClick={() => setSelectedTool(t)}
                        >
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Tool detail panel (far right) */}
      {selectedTool && (
        <div className="w-80 shrink-0 border-l overflow-y-auto p-4">
          <ToolDetail
            tool={selectedTool}
            isUsed={usedBareNames.has(selectedTool.name)}
            onClose={() => setSelectedTool(null)}
          />
        </div>
      )}
    </div>
  );
}

function ToolDetail({ tool, isUsed, onClose }: { tool: ToolInfo; isUsed: boolean; onClose: () => void }) {
  const params = tool.parameters;
  const properties = params?.properties ? Object.entries(params.properties) : [];
  const requiredSet = new Set(params?.required ?? []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-semibold text-sm truncate">{tool.name}</h3>
          <Badge variant={isUsed ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 shrink-0">
            {isUsed ? 'used' : 'unused'}
          </Badge>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {tool.description && (
        <p className="text-xs text-muted-foreground leading-relaxed">{tool.description}</p>
      )}

      {properties.length > 0 && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Parameters
          </span>
          <div className="mt-1.5 space-y-2">
            {properties.map(([name, prop]) => (
              <div key={name} className="border rounded-md px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-medium">{name}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
                    {prop.type}
                  </Badge>
                  {requiredSet.has(name) && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-destructive text-destructive">
                      required
                    </Badge>
                  )}
                </div>
                {prop.description && (
                  <p className="text-xs text-muted-foreground mt-1">{prop.description}</p>
                )}
                {prop.properties && (
                  <NestedProperties properties={prop.properties} required={prop.required} depth={1} />
                )}
                {prop.items && prop.items.properties && (
                  <div className="mt-1.5">
                    <span className="text-[10px] text-muted-foreground">items:</span>
                    <NestedProperties properties={prop.items.properties} required={prop.items.required} depth={1} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NestedProperties({ properties, required, depth }: {
  properties: Record<string, import('@/api/types').ToolProperty>;
  required?: string[];
  depth: number;
}) {
  const requiredSet = new Set(required ?? []);
  const entries = Object.entries(properties);

  return (
    <div className={cn('space-y-1 mt-1.5', depth > 0 && 'ml-3 pl-2 border-l')}>
      {entries.map(([name, prop]) => (
        <div key={name}>
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-mono">{name}</span>
            <span className="text-[10px] text-muted-foreground font-mono">{prop.type}</span>
            {requiredSet.has(name) && (
              <span className="text-[10px] text-destructive">*</span>
            )}
          </div>
          {prop.description && (
            <p className="text-[11px] text-muted-foreground">{prop.description}</p>
          )}
          {prop.properties && (
            <NestedProperties properties={prop.properties} required={prop.required} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

function ChatsTabContent({
  chatHistory,
  selectedChat,
  onSelectChat,
  connected,
  onNewChat,
  onArchiveChat,
  instanceId,
  agentName,
  onChatCreated,
  liveChatActive,
  liveChatKey,
  liveChatSessionId,
  liveChatMessages,
}: {
  chatHistory: ChatSessionInfo[];
  selectedChat: ChatSessionInfo | null;
  onSelectChat: (chat: ChatSessionInfo | null) => void;
  connected: boolean;
  onNewChat: () => void;
  onArchiveChat: (sessionId: string) => void;
  instanceId: string;
  agentName: string;
  onChatCreated: () => void;
  liveChatActive: boolean;
  liveChatKey: number;
  liveChatSessionId?: string;
  liveChatMessages?: ChatMessage[];
}) {
  if (!connected) {
    return <p className="text-sm text-muted-foreground p-4">Instance disconnected. Chat history unavailable.</p>;
  }

  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r overflow-y-auto">
        <div className="p-2 border-b">
          <Button size="sm" className="w-full" onClick={onNewChat}>New Chat</Button>
        </div>
        <div className="py-1">
          {chatHistory.map((chat) => (
            <div
              key={chat.sessionId}
              onClick={() => onSelectChat(chat)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors cursor-pointer flex items-center justify-between group',
                selectedChat?.sessionId === chat.sessionId && 'bg-muted font-medium',
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <StatusBadge status={chat.status} />
                <span className="text-xs text-muted-foreground truncate">
                  {formatTime(chat.startedAt)}
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onArchiveChat(chat.sessionId); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          ))}
          {chatHistory.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">No conversations yet.</p>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {liveChatActive ? (
          <AgentChat
            key={liveChatKey}
            instanceId={instanceId}
            agentName={agentName}
            connected={connected}
            initialMessages={liveChatMessages}
            existingSessionId={liveChatSessionId}
            onChatCreated={onChatCreated}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── Main page component ── */

export function AgentDetail() {
  const { id, name } = useParams<{ id: string; name: string }>();
  const queryClient = useQueryClient();

  // Tab + selection state
  const [activeTab, setActiveTab] = useState('general');
  const [selectedMission, setSelectedMission] = useState<MissionInfo | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null);
  const [selectedChat, setSelectedChat] = useState<ChatSessionInfo | null>(null);

  // Active chat state (inline in tab)
  const [liveChatActive, setLiveChatActive] = useState(false);
  const [liveChatKey, setLiveChatKey] = useState(0);
  const [liveChatSessionId, setLiveChatSessionId] = useState<string | undefined>();
  const [liveChatMessages, setLiveChatMessages] = useState<ChatMessage[] | undefined>();

  // Resizable panel + canvas
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

  // Queries
  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data: chatHistory } = useQuery({
    queryKey: ['chatHistory', id, name],
    queryFn: () => getChatHistory(id!, name!),
    enabled: !!id && !!name && !!instance?.connected,
    refetchInterval: 10000,
  });

  // Derived data
  const agent = instance?.config.agents?.find((a) => a.name === name);

  const { missions, plugins, toolToPlugin, agentToolsByPlugin } = useMemo(() => {
    const allPlugins = instance?.config.plugins ?? [];
    const agentTools = agent?.tools ?? [];

    // Agent tools use "plugins.<namespace>.<tool>" format
    // Plugin tools use bare names. Parse to match them.
    const tToP = new Map<string, string>(); // agent tool name -> plugin name
    const byPlugin = new Map<string, string[]>(); // plugin name -> [agent tool full names]

    for (const t of agentTools) {
      const match = t.match(/^plugins\.([^.]+)\.(.+)$/);
      if (match) {
        const [, pluginName] = match;
        tToP.set(t, pluginName);
        const existing = byPlugin.get(pluginName) ?? [];
        existing.push(t);
        byPlugin.set(pluginName, existing);
      }
    }

    const relevantPlugins = allPlugins.filter((p) => byPlugin.has(p.name));

    const relevantMissions = (instance?.config.missions ?? []).filter(
      (m) => m.agents?.includes(name!)
    );

    return { missions: relevantMissions, plugins: relevantPlugins, toolToPlugin: tToP, agentToolsByPlugin: byPlugin };
  }, [instance?.config, agent?.tools, name]);

  const { nodes, edges } = useMemo(() => {
    if (!agent) return { nodes: [], edges: [] };
    return layoutAgentGraph({ agentInfo: agent, missions, plugins, toolToPlugin, agentToolsByPlugin });
  }, [agent, missions, plugins, toolToPlugin, agentToolsByPlugin]);

  const nodesWithSelection = useMemo(() => {
    return nodes.map((n) => {
      let isSelected = false;
      if (activeTab === 'general' && n.id === `agent:${name}`) {
        isSelected = true;
      } else if (activeTab === 'missions' && n.id === `mission:${selectedMission?.name}`) {
        isSelected = true;
      } else if (activeTab === 'plugins') {
        if (n.id === `plugin:${selectedPlugin?.name}`) {
          isSelected = true;
        }
        if (n.type === 'tool' && (n.data as { pluginName: string }).pluginName === selectedPlugin?.name) {
          isSelected = true;
        }
      }
      return { ...n, selected: isSelected };
    });
  }, [nodes, activeTab, name, selectedMission?.name, selectedPlugin?.name]);

  // Auto-select first items
  useEffect(() => {
    if (!selectedMission && missions.length) setSelectedMission(missions[0]);
  }, [missions, selectedMission]);

  useEffect(() => {
    if (!selectedPlugin && plugins.length) setSelectedPlugin(plugins[0]);
  }, [plugins, selectedPlugin]);


  // Node click handler
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const [type, ...rest] = node.id.split(':');
    const nodeName = rest.join(':');

    switch (type) {
      case 'agent':
        setActiveTab('general');
        break;
      case 'mission': {
        const m = missions.find((m) => m.name === nodeName);
        if (m) {
          setSelectedMission(m);
          setActiveTab('missions');
        }
        break;
      }
      case 'plugin': {
        const p = plugins.find((p) => p.name === nodeName);
        if (p) {
          setSelectedPlugin(p);
          setActiveTab('plugins');
        }
        break;
      }
      case 'tool': {
        const pluginName = toolToPlugin.get(nodeName);
        const p = plugins.find((p) => p.name === pluginName);
        if (p) {
          setSelectedPlugin(p);
          setActiveTab('plugins');
        }
        break;
      }
    }
  }, [missions, plugins, toolToPlugin]);

  // Chat handlers
  const handleNewChat = () => {
    setSelectedChat(null);
    setLiveChatActive(true);
    setLiveChatKey((k) => k + 1);
    setLiveChatSessionId(undefined);
    setLiveChatMessages(undefined);
    setActiveTab('chats');
  };

  const handleSelectChat = async (chat: ChatSessionInfo | null) => {
    if (!chat) {
      setLiveChatActive(false);
      setLiveChatSessionId(undefined);
      setLiveChatMessages(undefined);
      setSelectedChat(null);
      return;
    }
    setSelectedChat(chat);
    try {
      const result = await getChatMessages(id!, chat.sessionId);
      const msgs: ChatMessage[] = result.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      setLiveChatActive(true);
      setLiveChatKey((k) => k + 1);
      setLiveChatSessionId(chat.sessionId);
      setLiveChatMessages(msgs);
    } catch (err) {
      console.error('Failed to load chat messages:', err);
    }
  };

  const handleArchiveChat = async (sessionId: string) => {
    setSelectedChat((prev) => prev?.sessionId === sessionId ? null : prev);
    if (liveChatSessionId === sessionId) {
      setLiveChatActive(false);
      setLiveChatSessionId(undefined);
      setLiveChatMessages(undefined);
    }
    try {
      await archiveChat(id!, sessionId);
      queryClient.invalidateQueries({ queryKey: ['chatHistory', id, name] });
    } catch (err) {
      console.error('Failed to archive chat:', err);
    }
  };

  const handleChatCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['chatHistory', id, name] });
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance || !agent) return <div className="p-8 text-muted-foreground">Agent not found</div>;

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Compact header */}
      <div className="shrink-0 px-8 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{agent.name}</h1>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{agent.model}</Badge>
              {agent.mission && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{agent.mission}</Badge>
              )}
            </div>
            {agent.role && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{agent.role}</p>
            )}
          </div>
          <Button
            variant={instance.connected ? 'default' : 'secondary'}
            disabled={!instance.connected}
            onClick={handleNewChat}
          >
            New Chat
          </Button>
        </div>
      </div>

      {/* ReactFlow canvas */}
      <div className="flex-1 min-h-0 p-4">
        <div className="relative h-full rounded-lg border bg-card overflow-hidden">
          <ReactFlow
            nodes={nodesWithSelection}
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
      </div>

      {/* Bottom panel */}
      <div
        className="shrink-0 border-t bg-card shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
        style={{ height: panelHeight }}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0 h-full">
          {/* Tab strip — doubles as drag handle */}
          <div
            className="shrink-0 flex items-center px-4 border-b select-none touch-none cursor-row-resize"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <TabsList variant="line">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="missions">
                Missions
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                  {missions.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="plugins">
                Plugins
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                  {plugins.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="chats">
                Chats
                {(chatHistory?.chats?.length ?? 0) > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">
                    {chatHistory!.chats.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <div className="ml-auto">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={togglePanel}>
                {panelHeight >= getMaxHeight() ? <ChevronsDown className="h-3.5 w-3.5" /> : <ChevronsUp className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Content fills remaining space */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="general" className="h-full m-0">
              <GeneralTabContent agent={agent} />
            </TabsContent>
            <TabsContent value="missions" className="h-full m-0">
              <MissionsTabContent
                missions={missions}
                selectedMission={selectedMission}
                onSelectMission={setSelectedMission}
                instanceId={id!}
              />
            </TabsContent>
            <TabsContent value="plugins" className="h-full m-0">
              <PluginsTabContent
                plugins={plugins}
                selectedPlugin={selectedPlugin}
                onSelectPlugin={setSelectedPlugin}
                agentToolsByPlugin={agentToolsByPlugin}
              />
            </TabsContent>
            <TabsContent value="chats" className="h-full m-0">
              <ChatsTabContent
                chatHistory={chatHistory?.chats ?? []}
                selectedChat={selectedChat}
                onSelectChat={handleSelectChat}
                connected={instance.connected}
                onNewChat={handleNewChat}
                onArchiveChat={handleArchiveChat}
                instanceId={id!}
                agentName={name!}
                onChatCreated={handleChatCreated}
                liveChatActive={liveChatActive}
                liveChatKey={liveChatKey}
                liveChatSessionId={liveChatSessionId}
                liveChatMessages={liveChatMessages}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
