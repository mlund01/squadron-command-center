import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Cable, ChevronRight, CircleCheck, CircleDashed, Plug, Server, Wrench } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getWorkspaceConfig, listWorkspaces } from '@/api/client';
import type { PluginInfo } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function WorkspaceConnectionsPage() {
  const { workspaceId } = useParams();
  const [selected, setSelected] = useState<PluginInfo | null>(null);
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
      description="Manage the plugins and MCP servers that extend this workspace."
    />
    <div className="space-y-8">
    {snapshot.isLoading ? <ConnectionsState text="Loading workspace extensions…" />
      : snapshot.isError ? <ConnectionsState text="Connect the workspace runner to inspect its connections." />
      : <>
        <ConnectionSection description="Native Squadron extensions loaded by the workspace runner." items={connections.plugins} kind="Plugins" onSelect={setSelected} />
        <ConnectionSection description="Model Context Protocol servers available to workspace agents." items={connections.mcps} kind="MCP servers" onSelect={setSelected} />
      </>}
    </div>
    <ConnectionDialog connection={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} workspaceId={workspaceId ?? ''} />
  </div>;
}

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
