import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable, Unplug } from 'lucide-react';
import {
  disconnectMyMCPConnection,
  disconnectPrincipalMCPConnection,
  listMyMCPConnections,
  listPrincipalMCPConnections,
  listWorkspaces,
} from '@/api/client';
import type { MCPConnectionCredential } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const methodLabels: Record<MCPConnectionCredential['method'], string> = {
  authorization_code: 'OAuth',
  client_credentials: 'Client credentials',
  static_header: 'API key',
};

export function MCPConnectionsPanel({ principalId }: { principalId?: string }) {
  const queryClient = useQueryClient();
  const [disconnecting, setDisconnecting] = useState<MCPConnectionCredential | null>(null);
  const queryKey = ['mcp-connections', principalId ?? 'me'];
  const connections = useQuery({
    queryKey,
    queryFn: () => principalId ? listPrincipalMCPConnections(principalId) : listMyMCPConnections(),
    refetchInterval: 30_000,
  });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const disconnect = useMutation({
    mutationFn: (item: MCPConnectionCredential) => principalId
      ? disconnectPrincipalMCPConnection(principalId, item.workspaceId, item.connectionName)
      : disconnectMyMCPConnection(item.workspaceId, item.connectionName),
    onSuccess: () => {
      setDisconnecting(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const workspaceNames = new Map(workspaces.data?.map((workspace) => [workspace.id, workspace.name]) ?? []);

  return <section className="overflow-hidden rounded-md border bg-card">
    <div className="border-b px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Cable className="size-4" />MCP connections</h2>
      <p className="mt-1 text-xs text-muted-foreground">Credentials authorized for this identity, scoped to each workspace connection.</p>
    </div>
    {connections.isLoading && <p className="px-4 py-10 text-center text-xs text-muted-foreground">Loading MCP connections…</p>}
    {connections.isError && <p className="px-4 py-10 text-center text-xs text-destructive">Unable to load MCP connections.</p>}
    {connections.data?.length === 0 && <p className="px-4 py-10 text-center text-xs text-muted-foreground">No MCP credentials connected.</p>}
    {connections.data?.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0" key={item.id}>
      <div className="min-w-0">
        <p className="text-xs font-medium">{item.connectionName}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{workspaceNames.get(item.workspaceId) ?? item.workspaceId} · {methodLabels[item.method]} · <span className="capitalize">{item.status.replace('_', ' ')}</span></p>
        {item.lastErrorCode && <p className="mt-1 text-[11px] text-destructive">{item.lastErrorCode}</p>}
      </div>
      <Button onClick={() => setDisconnecting(item)} size="sm" variant="outline"><Unplug />Disconnect</Button>
    </div>)}
    <Dialog open={Boolean(disconnecting)} onOpenChange={(open) => { if (!open && !disconnect.isPending) setDisconnecting(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Disconnect {disconnecting?.connectionName}?</DialogTitle><DialogDescription>This identity will no longer use this credential. Its encrypted token or key will be erased.</DialogDescription></DialogHeader>
        {disconnect.isError && <p className="text-xs text-destructive">{disconnect.error instanceof Error ? disconnect.error.message : 'Unable to disconnect.'}</p>}
        <DialogFooter>
          <Button disabled={disconnect.isPending} onClick={() => setDisconnecting(null)} variant="outline">Cancel</Button>
          <Button disabled={disconnect.isPending} onClick={() => { if (disconnecting) disconnect.mutate(disconnecting); }} variant="destructive">{disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
