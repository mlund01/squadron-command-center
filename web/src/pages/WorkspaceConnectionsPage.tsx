import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, BrainCircuit, Cable, ChevronRight, CircleCheck, CircleDashed, Eye, EyeOff, Pencil, Plug, Plus, Server, Trash2, Wrench } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { createWorkspaceModelConnection, deleteWorkspaceModelConnection, getWorkspaceConfig, listWorkspaceModelConnections, listWorkspaces, revealWorkspaceModelConnectionKey, updateWorkspaceModelConnection } from '@/api/client';
import type { ModelProviderKind, PluginInfo, WorkspaceModelConnection } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function WorkspaceConnectionsPage() {
  const { workspaceId } = useParams();
  const [selected, setSelected] = useState<PluginInfo | null>(null);
  const [editingModel, setEditingModel] = useState<WorkspaceModelConnection | null | undefined>(undefined);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  const snapshot = useQuery({
    queryKey: ['workspace-config', workspaceId],
    queryFn: () => getWorkspaceConfig(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const modelConnections = useQuery({ queryKey: ['workspace-model-connections', workspaceId], queryFn: () => listWorkspaceModelConnections(workspaceId!), enabled: Boolean(workspaceId), retry: false });
  const connections = useMemo(() => {
    const external = (snapshot.data?.config.plugins ?? []).filter((connection) => connection.kind === 'plugin' || connection.kind === 'mcp');
    return {
      plugins: external.filter((connection) => connection.kind === 'plugin').sort(byName),
      mcps: external.filter((connection) => connection.kind === 'mcp').sort(byName),
    };
  }, [snapshot.data?.config.plugins]);

  return <div>
    <PageHeader
      eyebrow={workspace?.name ?? 'Workspace'}
      title="Connections"
      description="Manage model providers, plugins, and MCP servers for this workspace."
      actions={<Button onClick={() => setEditingModel(null)}><Plus />Add model connection</Button>}
    />
    <div className="space-y-8">
      <ModelConnectionsSection connections={modelConnections.data ?? []} loading={modelConnections.isLoading} onEdit={setEditingModel} workspaceId={workspaceId ?? ''} />
    {snapshot.isLoading ? <ConnectionsState text="Loading workspace extensions…" />
      : snapshot.isError ? <ConnectionsState text="Connect the workspace runner to inspect its connections." />
      : <>
        <ConnectionSection description="Native Squadron extensions loaded by the workspace runner." items={connections.plugins} kind="Plugins" onSelect={setSelected} />
        <ConnectionSection description="Model Context Protocol servers available to workspace agents." items={connections.mcps} kind="MCP servers" onSelect={setSelected} />
      </>}
    </div>
    <ConnectionDialog connection={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} workspaceId={workspaceId ?? ''} />
    {editingModel !== undefined && <ModelConnectionDialog connection={editingModel} key={editingModel?.name ?? 'new'} onOpenChange={(open) => { if (!open) setEditingModel(undefined); }} workspaceId={workspaceId ?? ''} />}
  </div>;
}

function ModelConnectionsSection({ connections, loading, onEdit, workspaceId }: { connections: WorkspaceModelConnection[]; loading: boolean; onEdit: (connection: WorkspaceModelConnection) => void; workspaceId: string }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const remove = useMutation({ mutationFn: (name: string) => deleteWorkspaceModelConnection(workspaceId, name), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-model-connections', workspaceId] }) });
  const reveal = useMutation({ mutationFn: (name: string) => revealWorkspaceModelConnectionKey(workspaceId, name), onSuccess: (result, name) => setRevealed((current) => ({ ...current, [name]: result.value })) });
  return <section>
    <div className="mb-3 flex items-end justify-between gap-4"><div><h2 className="text-sm font-semibold">Model providers</h2><p className="mt-1 text-xs text-muted-foreground">Credentials and endpoints stored by Command Center. HCL decides which models each connection may use.</p></div><span className="text-[10px] tabular-nums text-muted-foreground">{connections.length}</span></div>
    {loading ? <ConnectionsState text="Loading model connections…" /> : connections.length ? <div className="overflow-hidden rounded-md border bg-card">{connections.map((connection) => <div className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0" key={connection.name}>
      <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted"><BrainCircuit className="size-4 text-muted-foreground" /></span>
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold">{connection.name}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{providerLabel(connection.provider)}{connection.baseUrl ? ` · ${connection.baseUrl}` : ''}</p><p className="mt-1 break-all text-[10px] text-muted-foreground">{connection.hasApiKey ? (revealed[connection.name] ?? 'Credential protected') : 'No credential required'}</p></div>
      {connection.hasApiKey && <Button onClick={() => revealed[connection.name] ? setRevealed((current) => { const next = { ...current }; delete next[connection.name]; return next; }) : reveal.mutate(connection.name)} size="sm" variant="ghost">{revealed[connection.name] ? <EyeOff /> : <Eye />}{revealed[connection.name] ? 'Hide' : 'Reveal'}</Button>}
      <Button onClick={() => onEdit(connection)} size="sm" variant="ghost"><Pencil />Edit</Button>
      <Button aria-label={`Delete ${connection.name}`} disabled={remove.isPending} onClick={() => remove.mutate(connection.name)} size="icon-sm" variant="ghost"><Trash2 /></Button>
    </div>)}</div> : <div className="rounded-md border bg-card px-5 py-10 text-center text-xs text-muted-foreground">No model providers configured.</div>}
  </section>;
}

function ModelConnectionDialog({ connection, onOpenChange, workspaceId }: { connection: WorkspaceModelConnection | null; onOpenChange: (open: boolean) => void; workspaceId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(connection?.name ?? '');
  const [provider, setProvider] = useState<ModelProviderKind>(connection?.provider ?? 'anthropic');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [promptCaching, setPromptCaching] = useState(connection?.promptCaching ?? true);
  const save = useMutation({ mutationFn: () => connection ? updateWorkspaceModelConnection(workspaceId, connection.name, { provider, baseUrl, apiKey: apiKey || undefined, promptCaching }) : createWorkspaceModelConnection(workspaceId, { name, provider, baseUrl, apiKey: apiKey || undefined, promptCaching }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workspace-model-connections', workspaceId] }); onOpenChange(false); } });
  const needsKey = provider !== 'openai_compatible';
  return <Dialog onOpenChange={onOpenChange} open><DialogContent><DialogHeader><DialogTitle>{connection ? `Edit ${connection.name}` : 'Add model connection'}</DialogTitle><DialogDescription>The connection name is the key used by a matching model_provider block in HCL.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <label className="block space-y-1.5 text-sm"><span>Connection name</span><Input autoComplete="off" disabled={Boolean(connection)} onChange={(event) => setName(event.target.value)} placeholder="anthropic" value={name} /></label>
      <label className="block space-y-1.5 text-sm"><span>Provider</span><Select onValueChange={(value) => setProvider(value as ModelProviderKind)} value={provider}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="gemini">Google Gemini</SelectItem><SelectItem value="openai_compatible">OpenAI-compatible</SelectItem></SelectContent></Select></label>
      <label className="block space-y-1.5 text-sm"><span>Base URL {provider === 'openai_compatible' ? '' : '(optional)'}</span><Input autoComplete="off" onChange={(event) => setBaseUrl(event.target.value)} placeholder={provider === 'openai_compatible' ? 'http://localhost:11434/v1' : 'Use provider default'} value={baseUrl} /></label>
      <label className="block space-y-1.5 text-sm"><span>{connection?.hasApiKey ? 'Replace API key (optional)' : needsKey ? 'API key' : 'API key (optional)'}</span><Input autoComplete="off" onChange={(event) => setApiKey(event.target.value)} type="password" value={apiKey} /></label>
      <label className="flex items-center gap-2 text-sm"><input checked={promptCaching} className="size-4 rounded border-input accent-primary" onChange={(event) => setPromptCaching(event.target.checked)} type="checkbox" /><span>Enable prompt caching when supported</span></label>
      {save.isError && <p className="text-sm text-destructive">{save.error.message}</p>}
    </div>
    <DialogFooter><Button disabled={!name || (provider === 'openai_compatible' && !baseUrl) || (needsKey && !connection?.hasApiKey && !apiKey) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save connection'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function providerLabel(provider: ModelProviderKind) { return provider === 'openai_compatible' ? 'OpenAI-compatible' : provider === 'gemini' ? 'Google Gemini' : provider[0].toUpperCase() + provider.slice(1); }

function ConnectionSection({ description, items, kind, onSelect }: { description: string; items: PluginInfo[]; kind: string; onSelect: (connection: PluginInfo) => void }) {
  return <section>
    <div className="mb-3 flex items-end justify-between gap-4"><div><h2 className="text-sm font-semibold">{kind}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><span className="text-[10px] tabular-nums text-muted-foreground">{items.length}</span></div>
    {items.length ? <div className="grid gap-3 md:grid-cols-2">
      {items.map((connection) => <ConnectionCard connection={connection} key={`${connection.kind}:${connection.name}`} onSelect={onSelect} />)}
    </div> : <div className="rounded-md border bg-card px-5 py-10 text-center text-xs text-muted-foreground">No {kind.toLowerCase()} configured.</div>}
  </section>;
}

function ConnectionCard({ connection, onSelect }: { connection: PluginInfo; onSelect: (connection: PluginInfo) => void }) {
  const health = connectionHealth(connection);
  const Icon = connection.kind === 'mcp' ? Server : Plug;
  return <button className="group flex min-w-0 items-center gap-3 rounded-md border bg-card p-4 text-left transition-colors hover:bg-accent/40" onClick={() => onSelect(connection)} type="button">
    <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted"><Icon className="size-4 text-muted-foreground" /></span>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-semibold">{connection.name}</span><ConnectionStatus compact connection={connection} /></span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{connection.path || 'Internal connection'}</span><span className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground"><health.icon className="size-3" />{health.label}<span aria-hidden>·</span>{connection.tools?.length ?? 0} tools</span></span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
  </button>;
}

function ConnectionDialog({ connection, onOpenChange, workspaceId }: { connection: PluginInfo | null; onOpenChange: (open: boolean) => void; workspaceId: string }) {
  const authentication = connection ? connectionAuthentication(connection) : null;
  return <Dialog open={Boolean(connection)} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
      {connection && authentication && <><DialogHeader><DialogTitle className="flex items-center gap-2"><Cable className="size-4 text-muted-foreground" />{connection.name}</DialogTitle><DialogDescription>{connection.kind === 'mcp' ? 'MCP server connection' : 'Squadron plugin connection'}</DialogDescription></DialogHeader>
        <div className="space-y-5">
          <dl className="divide-y rounded-md border">
            <DetailRow label="Status"><ConnectionStatus connection={connection} /></DetailRow>
            <DetailRow label="Origin"><span className="break-all">{connection.path || 'Internal'}</span></DetailRow>
            <DetailRow label="Version">{connection.version || 'Not specified'}</DetailRow>
            <DetailRow label="Tools">{connection.tools?.length ?? 0}</DetailRow>
          </dl>
          <section><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Authentication</p><div className="rounded-md border bg-muted/30 p-4"><div className="flex items-center gap-2 text-xs font-medium"><authentication.icon className="size-3.5" />{authentication.label}</div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{authentication.description}</p></div></section>
          {connection.tools?.length ? <section><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Available tools</p><div className="divide-y rounded-md border">{connection.tools.map((tool) => <div className="p-3" key={tool.name}><p className="flex items-center gap-2 text-xs font-medium"><Wrench className="size-3 text-muted-foreground" />{tool.name}</p>{tool.description && <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{tool.description}</p>}</div>)}</div></section> : null}
          {connection.kind === 'plugin' && connection.version === 'local' && <Button asChild className="w-full" variant="outline"><Link to={`/w/${workspaceId}/plugins`}><ArrowUpRight />View local source</Link></Button>}
        </div></>}
    </DialogContent>
  </Dialog>;
}

function ConnectionStatus({ connection, compact = false }: { connection: PluginInfo; compact?: boolean }) {
  const health = connectionHealth(connection);
  return <span className={compact ? 'rounded border px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground' : 'inline-flex items-center gap-1.5 text-xs'}>{!compact && <health.icon className="size-3.5" />}{health.label}</span>;
}

function connectionHealth(connection: PluginInfo) {
  if ((connection.tools?.length ?? 0) > 0) return { label: 'Available', icon: CircleCheck };
  return { label: 'Needs attention', icon: CircleDashed };
}

function connectionAuthentication(connection: PluginInfo) {
  if (connection.kind === 'plugin') return { label: 'Plugin-managed', description: 'Credentials for this plugin are supplied through its settings and protected workspace variables.', icon: Plug };
  const remote = /^https?:\/\//i.test(connection.path);
  if (!remote) return { label: 'Process-managed', description: 'This local MCP process receives any required credentials through its configured environment.', icon: Server };
  if ((connection.tools?.length ?? 0) > 0) return { label: 'Connection available', description: 'The remote MCP is responding. It may be anonymous, use configured headers, or already have an authorization token on the runner.', icon: CircleCheck };
  return { label: 'Setup may be required', description: 'This remote MCP has not reported tools. Authentication or connectivity may need attention; Command Center credential controls will live here.', icon: CircleDashed };
}

function DetailRow({ children, label }: { children: React.ReactNode; label: string }) { return <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[8rem_1fr]"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="text-xs">{children}</dd></div>; }
function ConnectionsState({ text }: { text: string }) { return <div className="grid min-h-72 place-items-center rounded-md border bg-card px-6 text-center text-sm text-muted-foreground">{text}</div>; }
function byName(a: PluginInfo, b: PluginInfo) { return a.name.localeCompare(b.name); }
