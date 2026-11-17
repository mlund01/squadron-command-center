import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getAdminAccess, getWorkspaceConfig, listWorkspaces, startMCPAuthorization } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ConnectMCPAuthorizationDialog({ open, onOpenChange, principalId, initialWorkspaceId = '', initialConnectionName = '' }: { open: boolean; onOpenChange: (open: boolean) => void; principalId?: string; initialWorkspaceId?: string; initialConnectionName?: string }) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [connectionName, setConnectionName] = useState(initialConnectionName);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [useRegisteredClient, setUseRegisteredClient] = useState(false);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces, enabled: open });
  const grants = useQuery({ queryKey: ['admin-access'], queryFn: getAdminAccess, enabled: open && Boolean(principalId) });
  const eligibleWorkspaces = (workspaces.data ?? []).filter((workspace) => !principalId || grants.data?.servicePrincipals.some((grant) => grant.workspaceId === workspace.id && grant.servicePrincipalId === principalId));
  const selectedWorkspace = eligibleWorkspaces.some((workspace) => workspace.id === workspaceId) ? workspaceId : eligibleWorkspaces[0]?.id || '';
  const snapshot = useQuery({ queryKey: ['workspace-config', selectedWorkspace], queryFn: () => getWorkspaceConfig(selectedWorkspace), enabled: open && Boolean(selectedWorkspace), retry: false });
  const connections = (snapshot.data?.config.plugins ?? []).filter((item) => item.kind === 'mcp' && item.path.startsWith('https://'));
  const selectedConnection = connections.find((item) => item.name === connectionName)?.name ?? connections[0]?.name ?? '';
  const start = useMutation({
    mutationFn: () => startMCPAuthorization(selectedWorkspace, selectedConnection, { clientId: useRegisteredClient ? clientId.trim() : '', clientSecret: useRegisteredClient ? clientSecret : '' }, principalId),
    onSuccess: ({ authorizationUrl }) => { window.location.assign(authorizationUrl); },
  });

  return <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{initialConnectionName ? 'Reauthorize MCP server' : 'Connect MCP server'}</DialogTitle>
        <DialogDescription>Authorize this identity to use a workspace MCP server. Command Center registers an OAuth client automatically when the server supports it.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor="mcp-workspace">Workspace</label>
          <Select onValueChange={(value) => { setWorkspaceId(value); setConnectionName(''); }} value={selectedWorkspace}>
            <SelectTrigger id="mcp-workspace"><SelectValue placeholder="Select workspace" /></SelectTrigger>
            <SelectContent>{eligibleWorkspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor="mcp-connection">MCP server</label>
          <Select onValueChange={setConnectionName} value={selectedConnection}>
            <SelectTrigger id="mcp-connection"><SelectValue placeholder="Select server" /></SelectTrigger>
            <SelectContent>{connections.map((connection) => <SelectItem key={connection.name} value={connection.name}>{connection.name}</SelectItem>)}</SelectContent>
          </Select>
          {!snapshot.isLoading && selectedWorkspace && connections.length === 0 && <p className="text-xs text-muted-foreground">No HTTPS MCP servers are reported for this workspace.</p>}
        </div>
        <Button onClick={() => { start.reset(); setUseRegisteredClient((current) => !current); }} size="sm" type="button" variant="link">{useRegisteredClient ? 'Use automatic registration' : 'Use a registered client instead'}</Button>
        {useRegisteredClient && <>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs"><p className="text-muted-foreground">Register this callback URL with your OAuth provider:</p><p className="mt-1 break-all font-mono">{window.location.origin}/api/mcp/oauth/callback</p></div>
          <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor="mcp-client-id">OAuth client ID</label><Input autoComplete="off" id="mcp-client-id" onChange={(event) => setClientId(event.target.value)} value={clientId} /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor="mcp-client-secret">Client secret <span className="font-normal text-muted-foreground">(if required)</span></label><Input autoComplete="off" id="mcp-client-secret" onChange={(event) => setClientSecret(event.target.value)} type="password" value={clientSecret} /></div>
        </>}
        {start.isError && <p className="text-xs text-destructive" role="alert">{start.error instanceof Error ? start.error.message : 'Unable to start authorization.'}</p>}
      </div>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} variant="outline">Cancel</Button>
        <Button disabled={!selectedConnection || (useRegisteredClient && !clientId.trim()) || start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Connecting…' : 'Continue to provider'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
