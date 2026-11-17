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
import { ConnectMCPAuthorizationDialog } from '@/components/ConnectMCPAuthorizationDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const methodLabels: Record<MCPConnectionCredential['method'], string> = {
  authorization_code: 'OAuth',
  client_credentials: 'Client credentials',
  static_header: 'API key',
};

export function ConnectorAuthorizationsPanel({ principalId }: { principalId?: string }) {
  const queryClient = useQueryClient();
  const [disconnecting, setDisconnecting] = useState<MCPConnectionCredential | null>(null);
  const [connecting, setConnecting] = useState<{ workspaceId: string; connectionName: string } | null>(null);
  const authorizationResult = new URLSearchParams(window.location.search).get('authorization');
  const queryKey = ['connector-authorizations', principalId ?? 'me'];
  const mcpAuthorizations = useQuery({
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Cable className="size-4" />Connector authorizations</h2>
        <p className="mt-1 text-xs text-muted-foreground">Credentials authorized for this identity across workspace connectors.</p></div>
      <Button onClick={() => setConnecting({ workspaceId: '', connectionName: '' })} size="sm">Connect MCP server</Button>
    </div>
    {authorizationResult === 'connected' && <p className="border-b px-4 py-3 text-xs text-emerald-700" role="status">MCP server connected.</p>}
    {authorizationResult === 'failed' && <p className="border-b px-4 py-3 text-xs text-destructive" role="alert">MCP authorization failed. Try connecting again.</p>}
    {mcpAuthorizations.isLoading && <p className="px-4 py-10 text-center text-xs text-muted-foreground">Loading connector authorizations…</p>}
    {mcpAuthorizations.isError && <p className="px-4 py-10 text-center text-xs text-destructive">Unable to load connector authorizations.</p>}
    {mcpAuthorizations.data?.length === 0 && <p className="px-4 py-10 text-center text-xs text-muted-foreground">No connector authorizations yet.</p>}
    {mcpAuthorizations.data?.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0" key={item.id}>
      <div className="min-w-0">
        <p className="text-xs font-medium">{item.connectionName}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{workspaceNames.get(item.workspaceId) ?? item.workspaceId} · MCP · {methodLabels[item.method]} · <span className="capitalize">{item.status.replace('_', ' ')}</span></p>
        {item.lastErrorCode && <p className="mt-1 text-[11px] text-destructive">{item.lastErrorCode}</p>}
      </div>
      <div className="flex items-center gap-2"><Button onClick={() => setConnecting({ workspaceId: item.workspaceId, connectionName: item.connectionName })} size="sm" variant="outline">Reauthorize</Button><Button onClick={() => setDisconnecting(item)} size="sm" variant="outline"><Unplug />Disconnect</Button></div>
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
    {connecting && <ConnectMCPAuthorizationDialog initialConnectionName={connecting.connectionName} initialWorkspaceId={connecting.workspaceId} key={`${connecting.workspaceId}:${connecting.connectionName}`} onOpenChange={(open) => { if (!open) setConnecting(null); }} open principalId={principalId} />}
  </section>;
}
