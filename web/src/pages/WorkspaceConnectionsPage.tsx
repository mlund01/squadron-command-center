import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Cable, ChevronRight, CircleCheck, CircleDashed, Loader2, Plug, Server, Wrench } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getWorkspaceConfig, listMCPConnectionTools, listWorkspaceConnectionIdentities, listWorkspaces } from '@/api/client';
import type { ConnectionIdentity, MCPConnectionTools, PluginInfo, ToolInfo } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type ConnectionView = { connection: PluginInfo; tools: ToolInfo[]; status: MCPConnectionTools['status'] | 'loading' };

function isRemoteMCP(connection: PluginInfo) {
  try { return connection.kind === 'mcp' && new URL(connection.path).protocol === 'https:'; }
  catch { return false; }
}

export function WorkspaceConnectionsPage() {
  const { workspaceId } = useParams();
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedIdentityKey, setSelectedIdentityKey] = useState('');
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
  const identities = useQuery({
    queryKey: ['workspace-connection-identities', workspaceId],
    queryFn: () => listWorkspaceConnectionIdentities(workspaceId!),
    enabled: Boolean(workspaceId),
    retry: false,
  });
  const selectedIdentity = identities.data?.find((identity) => `${identity.kind}:${identity.id}` === selectedIdentityKey) ?? identities.data?.[0];
  const connections = useMemo(() => {
    const external = (snapshot.data?.config.plugins ?? []).filter((connection) => connection.kind === 'plugin' || connection.kind === 'mcp');
    return {
      plugins: external.filter((connection) => connection.kind === 'plugin').sort(byName),
      mcps: external.filter((connection) => connection.kind === 'mcp').sort(byName),
    };
  }, [snapshot.data?.config.plugins]);
  const remote = connections.mcps.filter(isRemoteMCP);
  const liveTools = useQueries({ queries: remote.map((connection) => ({
    queryKey: ['mcp-connection-tools', workspaceId, connection.name, connection.path, selectedIdentity?.kind, selectedIdentity?.id],
    queryFn: () => listMCPConnectionTools(workspaceId!, connection.name, selectedIdentity!),
    enabled: Boolean(workspaceId && selectedIdentity),
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })) });
  const remoteResults = new Map(remote.map((connection, index) => [connection.name, liveTools[index]]));
  const plugins: ConnectionView[] = connections.plugins.map((connection) => ({ connection, tools: connection.tools ?? [], status: 'runner_snapshot' }));
  const mcps: ConnectionView[] = connections.mcps.map((connection) => {
    if (!isRemoteMCP(connection)) return { connection, tools: connection.tools ?? [], status: 'runner_snapshot' };
    const result = remoteResults.get(connection.name);
    return { connection, tools: result?.data?.tools ?? [], status: result?.data?.status ?? (result?.isError ? 'unavailable' : 'loading') };
  });
  const selected = [...plugins, ...mcps].find((view) => `${view.connection.kind}:${view.connection.name}` === selectedKey) ?? null;

  return <div>
    <PageHeader
      eyebrow={workspace?.name ?? 'Workspace'}
      title="Connections"
      description="Inspect the plugins and MCP servers configured for this workspace."
    />
    <div className="space-y-6">
    <section className="flex flex-wrap items-center gap-4 rounded-md border bg-card px-4 py-3">
      <div className="min-w-0 flex-1"><label className="text-xs font-semibold" htmlFor="connection-context">Connection context</label>
        <p className="mt-1 text-[11px] text-muted-foreground">MCP servers may return different tools for each authorized identity.</p></div>
      <div className="w-56 max-w-full shrink-0"><Select disabled={!selectedIdentity} onValueChange={setSelectedIdentityKey} value={selectedIdentity ? `${selectedIdentity.kind}:${selectedIdentity.id}` : ''}>
        <SelectTrigger className="w-full text-xs" id="connection-context"><SelectValue placeholder={identities.isError ? 'Contexts unavailable' : 'Loading identities…'} /></SelectTrigger>
        <SelectContent>{identities.data?.map((identity) => <SelectItem key={`${identity.kind}:${identity.id}`} value={`${identity.kind}:${identity.id}`}>{identity.kind === 'user' ? `Myself — ${identity.name}` : `${identity.name} — Service principal`}</SelectItem>)}</SelectContent>
      </Select></div>
    </section>
    {identities.isError && <p className="text-xs text-destructive" role="alert">Unable to load connection contexts.</p>}
    {snapshot.isLoading ? <ConnectionsState text="Loading workspace extensions…" />
      : snapshot.isError ? <ConnectionsState text="Connect the workspace runner to inspect its connections." />
      : <>
        <ConnectionSection description="Tools reported by the workspace runner; this list is shared across identities." items={plugins} kind="Plugins" onSelect={(view) => setSelectedKey(`${view.connection.kind}:${view.connection.name}`)} />
        <ConnectionSection description="Remote tools are inspected for the selected identity; local tools come from the runner snapshot." items={mcps} kind="MCP servers" onSelect={(view) => setSelectedKey(`${view.connection.kind}:${view.connection.name}`)} />
      </>}
    </div>
    <ConnectionDialog identity={selectedIdentity} onOpenChange={(open) => { if (!open) setSelectedKey(''); }} view={selected} workspaceId={workspaceId ?? ''} />
  </div>;
}

function ConnectionSection({ description, items, kind, onSelect }: { description: string; items: ConnectionView[]; kind: string; onSelect: (view: ConnectionView) => void }) {
  return <section>
    <div className="mb-3 flex items-end justify-between gap-4"><div><h2 className="text-sm font-semibold">{kind}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><span className="text-[10px] tabular-nums text-muted-foreground">{items.length}</span></div>
    {items.length ? <div className="grid gap-3 md:grid-cols-2">
      {items.map((view) => <ConnectionCard key={`${view.connection.kind}:${view.connection.name}`} onSelect={onSelect} view={view} />)}
    </div> : <div className="rounded-md border bg-card px-5 py-10 text-center text-xs text-muted-foreground">No {kind.toLowerCase()} configured.</div>}
  </section>;
}

function ConnectionCard({ view, onSelect }: { view: ConnectionView; onSelect: (view: ConnectionView) => void }) {
  const { connection } = view;
  const Icon = connection.kind === 'mcp' ? Server : Plug;
  return <button className="group flex min-w-0 items-center gap-3 rounded-md border bg-card p-4 text-left transition-colors hover:bg-accent/40" onClick={() => onSelect(view)} type="button">
    <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted"><Icon className="size-4 text-muted-foreground" /></span>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-semibold">{connection.name}</span><ConnectionStatus compact view={view} /></span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{connection.path || 'Internal connection'}</span><span className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">{view.status === 'loading' ? <Loader2 className="size-3 animate-spin" /> : hasToolCount(view) ? <CircleCheck className="size-3" /> : <CircleDashed className="size-3" />}{cardSummary(view)}</span></span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
  </button>;
}

function ConnectionDialog({ view, onOpenChange, workspaceId, identity }: { view: ConnectionView | null; onOpenChange: (open: boolean) => void; workspaceId: string; identity?: ConnectionIdentity }) {
  const connection = view?.connection;
  return <Dialog open={Boolean(view)} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
      {view && connection && <><DialogHeader><DialogTitle className="flex items-center gap-2"><Cable className="size-4 text-muted-foreground" />{connection.name}</DialogTitle><DialogDescription>{connection.kind === 'mcp' ? 'MCP server connection' : 'Squadron plugin connection'}</DialogDescription></DialogHeader>
        <div className="space-y-5">
          <dl className="divide-y rounded-md border">
            {connection.kind === 'mcp' && <DetailRow label="Context">{identity?.kind === 'service_principal' ? `${identity.name} · Service principal` : identity ? `Myself · ${identity.name}` : 'Loading identity…'}</DetailRow>}
            <DetailRow label="Status"><ConnectionStatus view={view} /></DetailRow>
            <DetailRow label="Origin"><span className="break-all">{connection.path || 'Internal'}</span></DetailRow>
            <DetailRow label="Version">{connection.version || 'Not specified'}</DetailRow>
            <DetailRow label="Tools">{hasToolCount(view) ? view.tools.length : 'Not available'}</DetailRow>
          </dl>
          {view.tools.length > 0 && <section><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{view.status === 'runner_snapshot' ? 'Runner-reported tools' : 'Tools for this identity'}</p><div className="divide-y rounded-md border">{view.tools.map((tool) => <div className="p-3" key={tool.name}><p className="flex items-center gap-2 text-xs font-medium"><Wrench className="size-3 text-muted-foreground" />{tool.name}</p>{tool.description && <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{tool.description}</p>}</div>)}</div></section>}
          {connection.kind === 'mcp' && (view.status === 'authorization_required' || view.status === 'needs_action') && <div className="rounded-md border px-3 py-3 text-xs">
            <p>{view.status === 'authorization_required' ? 'This identity needs to authorize the connection before its tools can be listed.' : 'This identity needs to reconnect before its tools can be listed.'}</p>
            {identity?.canManage ? <Button asChild className="mt-3" size="sm" variant="outline"><Link to={identity.kind === 'service_principal' ? `/service-principals/${identity.id}` : '/profile'}><ArrowUpRight />Manage authorization</Link></Button>
              : <p className="mt-2 text-muted-foreground">Ask an administrator to authorize this service principal.</p>}
          </div>}
          {connection.kind === 'mcp' && view.status === 'unavailable' && <p className="text-xs text-muted-foreground">The server's tools could not be inspected right now. Try again later.</p>}
          {connection.kind === 'plugin' && connection.version === 'local' && <Button asChild className="w-full" variant="outline"><Link to={`/w/${workspaceId}/plugins`}><ArrowUpRight />View local source</Link></Button>}
        </div></>}
    </DialogContent>
  </Dialog>;
}

function ConnectionStatus({ view, compact = false }: { view: ConnectionView; compact?: boolean }) {
  return <span className={compact ? 'rounded border px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground' : 'inline-flex items-center gap-1.5 text-xs'}>{!compact && (view.status === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : hasToolCount(view) ? <CircleCheck className="size-3.5" /> : <CircleDashed className="size-3.5" />)}{statusLabel(view)}</span>;
}

function hasToolCount(view: ConnectionView) { return view.status === 'available' || view.status === 'runner_snapshot'; }
function cardSummary(view: ConnectionView) {
  if (hasToolCount(view)) return `${view.tools.length} ${view.tools.length === 1 ? 'tool' : 'tools'}`;
  switch (view.status) {
    case 'authorization_required': return 'Authorize to inspect tools';
    case 'needs_action': return 'Reconnect to inspect tools';
    case 'unavailable': return 'Could not inspect tools';
    case 'loading': return 'Checking available tools…';
  }
}
function statusLabel(view: ConnectionView) {
  switch (view.status) {
    case 'available': return 'Tools inspected';
    case 'runner_snapshot': return 'Runner snapshot';
    case 'authorization_required': return 'Authorization required';
    case 'needs_action': return 'Reconnect required';
    case 'unavailable': return 'Tools unavailable';
    case 'loading': return 'Checking tools…';
  }
}

function DetailRow({ children, label }: { children: React.ReactNode; label: string }) { return <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[8rem_1fr]"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="text-xs">{children}</dd></div>; }
function ConnectionsState({ text }: { text: string }) { return <div className="grid min-h-72 place-items-center rounded-md border bg-card px-6 text-center text-sm text-muted-foreground">{text}</div>; }
function byName(a: PluginInfo, b: PluginInfo) { return a.name.localeCompare(b.name); }
