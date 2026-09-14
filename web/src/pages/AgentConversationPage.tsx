import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, ArrowUpRight, Bot, Check, ChevronDown, Code2, History as HistoryIcon, MessageSquare, PanelRight, PanelRightClose, PanelRightOpen, Play, Plus, Settings2, Sparkles, Square, Target, Wrench } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getAgentConversation, getAgentDefinition, getWorkspaceConfig, listAgentConversations, sendAgentConversation, stopAgentConversation } from '@/api/client';
import type { AgentConversationContext, AgentConversationState, AgentInfo, SessionMode } from '@/api/types';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AgentSourcePanel } from '@/components/AgentSourcePanel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useWideAgentLayout } from '@/hooks/use-wide-agent-layout';
import { cn } from '@/lib/utils';

export function AgentConversationPage({ purpose }: { purpose: 'authoring' | 'session' }) {
  const { workspaceId = '', agentName = '' } = useParams();
  const [params] = useSearchParams();
  const mission = params.get('mission') || undefined;
  return <Conversation key={`${workspaceId}:${agentName}:${mission}:${purpose}:${params.get('new') ?? ''}`} workspaceId={workspaceId} name={agentName} mission={mission} purpose={purpose} />;
}

function Conversation({ workspaceId, name, mission, purpose }: { workspaceId: string; name: string; mission?: string; purpose: 'authoring' | 'session' }) {
  const authoring = purpose === 'authoring';
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('conversation') || undefined;
  const mode: SessionMode = !authoring && params.get('mode') === 'task' ? 'task' : 'interactive';
  const context: AgentConversationContext = { purpose, mode, mission };
  const [draft, setDraft] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [configView, setConfigView] = useState<'details' | 'source'>('details');
  const wideLayout = useWideAgentLayout();
  const scrollArea = useRef<HTMLDivElement>(null);
  const configurationPanel = usePanelRef();
  const followAnswer = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const queries = useQueryClient();
  const basePath = `/w/${workspaceId}/agents/${encodeURIComponent(name)}`;
  const scopeParams = new URLSearchParams(mission ? { mission } : {});
  const sessionParams = new URLSearchParams(scopeParams);
  const authoringConversation = authoring ? sessionId : params.get('authoringConversation');
  if (authoringConversation) {
    sessionParams.set('authoringConversation', authoringConversation);
  }
  const snapshot = useQuery({ queryKey: ['workspace-config', workspaceId], queryFn: () => getWorkspaceConfig(workspaceId), refetchInterval: 5_000, retry: false });
  const definition = useQuery({
    queryKey: ['agent-definition', workspaceId, name, mission],
    queryFn: () => getAgentDefinition(workspaceId, name, mission),
    enabled: snapshot.data?.connected === true,
    refetchInterval: 15_000,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['agent-conversation-history', workspaceId, name, mission, purpose],
    queryFn: () => listAgentConversations(workspaceId, name, context),
    enabled: snapshot.data?.connected === true,
    refetchInterval: 15_000,
    retry: false,
  });
  const queryKey = ['agent-conversation', workspaceId, name, mission, purpose, mode, sessionId];
  const conversation = useQuery({
    queryKey,
    queryFn: () => getAgentConversation(workspaceId, name, context, sessionId!),
    enabled: Boolean(sessionId && snapshot.data?.connected),
    refetchInterval: 1_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const send = useMutation({
    mutationFn: (content: string) => sendAgentConversation(workspaceId, name, context, content, sessionId),
    onSuccess: (response, content) => {
      setDraft('');
      followAnswer.current = true;
      queries.setQueryData<AgentConversationState>(
        ['agent-conversation', workspaceId, name, mission, purpose, mode, response.sessionId],
        (previous) => ({
          ...response,
          messages: [...(previous?.messages ?? []), { id: -Date.now(), role: 'user', content, createdAt: new Date().toISOString() }],
        }),
      );
      setParams((current) => { current.set('conversation', response.sessionId); if (!authoring) current.set('mode', mode); return current; }, { replace: true });
      void queries.invalidateQueries({ queryKey: ['agent-conversation', workspaceId, name] });
      void queries.invalidateQueries({ queryKey: ['agent-conversation-history', workspaceId, name, mission, purpose] });
    },
  });
  const stop = useMutation({
    mutationFn: () => stopAgentConversation(workspaceId, name, context, sessionId!),
    onSuccess: () => { void queries.invalidateQueries({ queryKey }); },
  });
  const messages = conversation.data?.messages ?? [];
  const working = send.isPending || conversation.data?.running === true;
  const connected = snapshot.data?.connected === true;
  const error = send.error || stop.error || conversation.error;
  const agent = definition.data ?? snapshot.data?.config.agents?.find((candidate) => candidate.name === name && (candidate.mission || undefined) === mission);

  useEffect(() => {
    if (followAnswer.current && scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [conversation.data, send.isPending]);

  useEffect(() => {
    if (!wideLayout) return;
    if (sidePanelOpen) {
      configurationPanel.current?.expand();
      configurationPanel.current?.resize(configView === 'source' ? '50%' : '33%');
    } else configurationPanel.current?.collapse();
  }, [configView, configurationPanel, sidePanelOpen, wideLayout]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.trim() && !working && connected && agent) send.mutate(draft.trim());
  }

  function setMode(value: SessionMode) {
    if (sessionId || working) return;
    setParams((current) => { current.set('mode', value); return current; }, { replace: true });
  }

  const configuration = configView === 'source' && agent?.source
    ? <AgentSourcePanel source={agent.source} onBack={() => setConfigView('details')} onCollapse={wideLayout ? () => setSidePanelOpen(false) : undefined} />
    : <div className="h-full overflow-y-auto"><AgentInspector agent={definition.data} loading={definition.isLoading} connected={connected} onCollapse={wideLayout ? () => setSidePanelOpen(false) : undefined} onViewSource={() => setConfigView('source')} /></div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3 lg:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm"><Link to={`/w/${workspaceId}/agents`} aria-label="Back to agents"><ArrowLeft /></Link></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h1 className="truncate text-sm font-semibold" title={name}>{name}</h1><span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{authoring ? 'Authoring' : 'Session'}</span></div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{mission ? `Mission · ${mission}` : 'Workspace agent'}{!authoring && ` · ${agent?.model || 'Loading model…'}`}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {authoring ? (
            <>
              <Button className="lg:hidden" size="icon-sm" variant="outline" onClick={() => setShowConfig(true)} aria-label="Show agent configuration"><PanelRight /></Button>
              <Button asChild size="sm"><Link to={`${basePath}/session?${sessionParams}`}><Play className="size-3.5" />Start session</Link></Button>
            </>
          ) : <>
            {sessionId && <span className="text-[11px] text-muted-foreground">{mode === 'task' ? 'Task mode' : 'Interactive'}</span>}
            <Button className="lg:hidden" size="icon-sm" variant="outline" onClick={() => setShowConfig(true)} aria-label="Show agent configuration"><PanelRight /></Button>
          </>}
        </div>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="flex-1" resizeTargetMinimumSize={{ fine: 12, coarse: 24 }}>
        <ResizablePanel id="agent-conversation" defaultSize={wideLayout ? (configView === 'source' ? '50%' : '67%') : '100%'} minSize={wideLayout ? '320px' : '0%'}>
        <section className="relative flex h-full min-h-0 min-w-0 flex-col" aria-label={authoring ? 'Agent authoring conversation' : 'Agent session'}>
          <div className="absolute right-5 top-4 z-20 flex items-center gap-2 sm:right-8">
            <ConversationHistoryMenu
              conversations={history.data ?? []}
              currentSessionId={sessionId}
              historyLabel={authoring ? 'Build conversation history' : 'Agent session history'}
              loading={history.isLoading}
              newLabel={authoring ? 'New conversation' : 'New session'}
              onSelect={(selected) => {
                setDraft('');
                setParams((current) => {
                  if (selected) {
                    current.set('conversation', selected.sessionId);
                    current.set('mode', selected.mode);
                  } else current.delete('conversation');
                  current.delete('new');
                  return current;
                });
              }}
            />
            {wideLayout && !sidePanelOpen && <Button size="icon-sm" variant="outline" onClick={() => setSidePanelOpen(true)} aria-label="Show agent configuration"><PanelRightOpen /></Button>}
          </div>
          <div ref={scrollArea} className="min-h-0 flex-1 overflow-y-auto" onScroll={() => { const area = scrollArea.current; if (area) followAnswer.current = area.scrollHeight - area.scrollTop - area.clientHeight < 100; }}>
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 py-8 sm:px-8">
              {!sessionId && !send.isPending ? (
                <div className="my-auto py-8">
                  <div className="mb-5 grid size-11 place-items-center rounded-xl border bg-card text-primary">{authoring ? <Settings2 className="size-5" /> : mode === 'task' ? <Target className="size-5" /> : <MessageSquare className="size-5" />}</div>
                  <p className="mb-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{authoring ? 'Agent studio' : 'New session'}</p>
                  <h2 className="text-2xl font-semibold tracking-tight">{authoring ? 'Shape how this agent works.' : mode === 'task' ? 'Define the task. Let it work.' : `Work with ${name}.`}</h2>
                  <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{authoring ? 'Refine its instructions, adjust its capabilities, or explore a change. This conversation is about the agent—not a session with it.' : mode === 'task' ? 'Give the agent a clear objective and the context it needs. It will work toward a complete result with minimal back-and-forth.' : 'Ask questions, explore an idea, or work through a task together. Request “one-shot” when you want a complete answer without the back-and-forth.'}</p>
                  {authoring ? (
                    <div className="mt-7 grid gap-2 sm:grid-cols-2">
                      {[
                        ['Refine its instructions', 'Help me refine this agent’s instructions. What would you change?'],
                        ['Review its capabilities', 'Review this agent’s configured tools and skills. What is missing or unnecessary?'],
                        ['Tune its behavior', 'Help me tune this agent’s behavior. Ask about the outcomes I want first.'],
                        ['Explain this agent', 'Explain what this agent is configured to do and any limitations.'],
                      ].map(([label, prompt]) => <button type="button" key={label} onClick={() => { setDraft(prompt); textarea.current?.focus(); }} className="flex items-center gap-2 rounded-md border bg-card px-3 py-3 text-left text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"><Sparkles className="size-3.5 shrink-0" />{label}</button>)}
                    </div>
                  ) : (
                    <fieldset className="mt-7 grid gap-3 sm:grid-cols-2">
                      <legend className="sr-only">Session mode</legend>
                      {(['interactive', 'task'] as const).map((value) => (
                        <label key={value} className={cn('cursor-pointer rounded-md border bg-card p-4 has-focus-visible:ring-2 has-focus-visible:ring-ring', mode === value && 'border-primary bg-accent/40')}>
                          <input type="radio" name="session-mode" className="sr-only" checked={mode === value} onChange={() => setMode(value)} />
                          <span className="flex items-center justify-between text-xs font-semibold">{value === 'interactive' ? 'Interactive' : 'Task'}{mode === value && <Check className="size-3.5 text-primary" />}</span>
                          <span className="mt-2 block text-[11px] leading-5 text-muted-foreground">{value === 'interactive' ? 'An ongoing conversation. Clarify, iterate, and collaborate.' : 'A clear assignment. Autonomous work, then a final result.'}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              ) : (
                <div className="space-y-6" aria-live="polite">
                  {conversation.isLoading && <p className="text-xs text-muted-foreground">Loading conversation…</p>}
                  {messages.map((message) => <ChatMessage key={message.id} user={message.role === 'user'} label={authoring ? 'Authoring assistant' : name}>{message.content}</ChatMessage>)}
                  {send.isPending && <ChatMessage user label="You">{send.variables || ''}</ChatMessage>}
                  {conversation.data?.partialAnswer && <ChatMessage label={authoring ? 'Authoring assistant' : name}>{conversation.data.partialAnswer}</ChatMessage>}
                  {working && <p className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-primary" />{stop.isPending ? 'Stopping…' : authoring ? 'Considering the configuration…' : 'Working…'}</p>}
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-5 pt-3 sm:px-8">
            {!connected && <p role="status" className="mb-3 text-xs text-muted-foreground">Connect the workspace runner to send a message.</p>}
            {error && <p role="alert" className="mb-3 text-xs text-destructive">{error.message}</p>}
            {conversation.data?.error && <p role="alert" className="mb-3 text-xs text-destructive">{conversation.data.error}</p>}
            {definition.error && !agent && <p role="alert" className="mb-3 text-xs text-destructive">{definition.error.message}</p>}
            <form onSubmit={submit} className="rounded-xl border bg-card p-3 focus-within:border-ring">
              <textarea ref={textarea} aria-label={authoring ? 'Describe an agent change' : 'Message the agent'} className="max-h-48 min-h-20 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground" maxLength={64000} rows={3} placeholder={authoring ? 'Describe what you want to change…' : mode === 'task' ? 'Describe the task, context, and expected result…' : `Message ${name}…`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{authoring ? <Settings2 className="size-3" /> : <Bot className="size-3" />}{authoring ? 'Authoring · proposals only' : mode === 'task' ? 'Task mode' : 'Interactive session'}</span>
                {conversation.data?.running ? <Button aria-label="Stop response" size="icon-sm" type="button" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}><Square className="size-3" /></Button> : <Button aria-label="Send message" type="submit" size="icon-sm" disabled={!draft.trim() || working || !connected || !agent || Boolean(sessionId && conversation.isLoading)}><ArrowUp /></Button>}
              </div>
            </form>
            <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">{authoring ? 'Proposed changes do not affect the running agent.' : 'This session uses the agent’s configured tools and may take actions.'}</p>
          </div>
        </section>
        </ResizablePanel>

        {wideLayout && <>
          <ResizableHandle aria-label="Resize chat and configuration" className={cn(!sidePanelOpen && 'hidden')} disabled={!sidePanelOpen} title="Drag or use arrow keys to resize" />
          <ResizablePanel collapsible collapsedSize="0%" id="agent-configuration" defaultSize={configView === 'source' ? '50%' : '33%'} minSize="320px" panelRef={configurationPanel} onResize={({ asPercentage }) => { const open = asPercentage > 0; setSidePanelOpen((current) => current === open ? current : open); }}>
            <aside aria-hidden={!sidePanelOpen} className={cn('h-full min-h-0 min-w-0 bg-card/40', !sidePanelOpen && 'invisible')} aria-label="Agent configuration">{configuration}</aside>
          </ResizablePanel>
        </>}
      </ResizablePanelGroup>
      {!wideLayout && <Sheet open={showConfig} onOpenChange={setShowConfig}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl" showCloseButton={false} aria-describedby={undefined}>
          <div className="flex shrink-0 items-center justify-between border-b px-5 py-3"><SheetTitle className="text-xs">Agent configuration</SheetTitle><SheetClose asChild><Button size="sm" variant="ghost">Close</Button></SheetClose></div>
          <div className="min-h-0 flex-1">{configuration}</div>
        </SheetContent>
      </Sheet>}
    </div>
  );
}

function ConversationHistoryMenu({ conversations, currentSessionId, historyLabel, loading, newLabel, onSelect }: { conversations: Array<{ sessionId: string; startedAt: string; mode: SessionMode }>; currentSessionId?: string; historyLabel: string; loading: boolean; newLabel: string; onSelect: (conversation?: { sessionId: string; mode: SessionMode }) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm" variant="outline" aria-label={historyLabel}><HistoryIcon className="size-3.5" /><span className="hidden sm:inline">History</span><ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-72">
      <DropdownMenuItem onSelect={() => onSelect()}><Plus className="size-3.5" />{newLabel}</DropdownMenuItem>
      <DropdownMenuSeparator />
      {loading ? <DropdownMenuItem disabled>Loading conversations…</DropdownMenuItem> : conversations.length === 0 ? <DropdownMenuItem disabled>No previous conversations</DropdownMenuItem> : conversations.map((item) => (
        <DropdownMenuItem key={item.sessionId} onSelect={() => onSelect(item)} className="justify-between">
          <span>{formatConversationTimestamp(item.startedAt)}</span>{item.sessionId === currentSessionId && <Check className="size-3.5" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function formatConversationTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function ChatMessage({ children, user = false, label }: { children: string; user?: boolean; label: string }) {
  return <div className={cn('text-sm', user && 'ml-auto max-w-[90%] rounded-xl bg-accent/60 px-4 py-3')}><p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{user ? 'You' : label}</p><MarkdownContent className="[overflow-wrap:anywhere] [&_p]:leading-7" content={children} /></div>;
}

function AgentInspector({ agent, loading, connected, onCollapse, onViewSource }: { agent?: AgentInfo; loading: boolean; connected: boolean; onCollapse?: () => void; onViewSource: () => void }) {
  const skills = [...new Set([...(agent?.skills ?? []).map((skill) => skill.replace(/^skills\./, '')), ...(agent?.localSkills ?? []).map((skill) => skill.name)])];
  return <div className="p-5 lg:p-6">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2"><Settings2 className="size-3.5 text-muted-foreground" /><h2 className="text-xs font-semibold">Configuration</h2></div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={onViewSource} disabled={!agent?.source} aria-label="View raw configuration" title={agent?.source ? `${agent.source.path}:${agent.source.startLine}` : 'Raw configuration unavailable'}><Code2 className="size-3.5" />View raw</Button>
        {onCollapse && <Button variant="ghost" size="icon-sm" onClick={onCollapse} aria-label="Collapse agent configuration"><PanelRightClose /></Button>}
      </div>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{connected ? 'The configuration reported by the workspace runner.' : 'Last reported configuration. The workspace runner is disconnected.'}</p>
    {loading && !agent ? <p className="mt-6 text-xs text-muted-foreground">Loading details…</p> : !agent ? <p className="mt-6 text-xs text-muted-foreground">Configuration unavailable.</p> : <>
      <InspectorSection title="Lineage"><AgentMissionLineage lineage={agent.lineage} /></InspectorSection>
      <InspectorSection title="Model"><p className="break-words text-xs">{agent.model}</p><p className="mt-1 text-[11px] text-muted-foreground">Reasoning: {agent.reasoning || 'Not explicitly enabled'}</p></InspectorSection>
      <InspectorSection title="Purpose"><MarkdownContent className="text-xs [&_p]:leading-6" content={agent.role || 'No separate role configured.'} /></InspectorSection>
      <InspectorSection title="Personality"><MarkdownContent className="text-xs text-muted-foreground [&_p]:leading-6" content={agent.description || 'Not configured.'} /></InspectorSection>
      <InspectorSection title={`Tools · ${agent.tools?.length ?? 0}`}><div className="space-y-2">{(agent.tools ?? []).map((tool) => <p key={tool} className="flex items-start gap-2 text-[11px] leading-5"><Wrench className="mt-1 size-3 shrink-0 text-muted-foreground" /><span className="break-all">{tool}</span></p>)}{!agent.tools?.length && <p className="text-xs text-muted-foreground">No explicitly configured tools.</p>}</div></InspectorSection>
      <InspectorSection title={`Skills · ${skills.length}`}><div className="space-y-2">{skills.map((skill) => <p className="flex items-start gap-2 text-[11px]" key={skill}><Sparkles className="size-3 shrink-0 text-muted-foreground" /><span className="break-all">{skill}</span></p>)}{skills.length === 0 && <p className="text-xs text-muted-foreground">No configured skills.</p>}</div></InspectorSection>
      <details className="group border-t py-5" open><summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Runtime settings<ChevronDown className="size-3 transition-transform group-open:rotate-180" /></summary><dl className="mt-4 space-y-3 text-[11px]">
        <Setting label="Context pruning" value={agent.pruning?.PruneOn ? `${agent.pruning.PruneOn} → ${agent.pruning.PruneTo} turns` : 'Disabled'} />
        <Setting label="Compaction" value={agent.compaction?.TokenLimit ? `${agent.compaction.TokenLimit.toLocaleString()} tokens` : 'Disabled'} />
        {agent.compaction && <Setting label="Retained turns" value={String(agent.compaction.TurnRetention)} />}
        <Setting label="Tool response limit" value={`${(agent.toolResponse?.MaxTokens || 16000).toLocaleString()} tokens`} />
        <Setting label="Scope" value={agent.mission || 'Workspace'} />
      </dl></details>
    </>}
  </div>;
}

function AgentMissionLineage({ lineage }: { lineage?: AgentInfo['lineage'] }) {
  const { workspaceId } = useParams();
  const [expanded, setExpanded] = useState(false);
  if (!lineage) return <p className="text-xs text-muted-foreground">Mission lineage unavailable.</p>;
  const missions = lineage.missions;
  if (missions.length === 0) return <p className="text-xs text-muted-foreground">No missions reference this agent.</p>;
  return <div>
    <p className="text-xs">Used by <span className="font-semibold">{missions.length} {missions.length === 1 ? 'mission' : 'missions'}</span></p>
    <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto" aria-label="Missions using this agent">
      {(expanded ? missions : missions.slice(0, 4)).map((mission) => (
        <li key={mission.name}>
          <Link to={`/w/${workspaceId}/missions?${new URLSearchParams({ search: mission.name })}`} className="flex items-start justify-between gap-2 rounded-sm px-2 py-1.5 text-[11px] leading-4 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View ${mission.name} in missions`}>
            <span className="min-w-0 [overflow-wrap:anywhere]">{mission.name}</span><ArrowUpRight className="mt-0.5 size-3 shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
    {missions.length > 4 && <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-[11px]" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `Show all ${missions.length} missions`}<ChevronDown className={cn('size-3', expanded && 'rotate-180')} /></Button>}
  </div>;
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-t py-5 first-of-type:mt-5"><h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>{children}</section>;
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-[60%] break-words text-right">{value}</dd></div>;
}
