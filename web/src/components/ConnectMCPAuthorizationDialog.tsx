import { useState } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { getAdminAccess, getMCPAuthorizationReadiness, getWorkspaceConfig, listWorkspaces, startMCPAuthorization } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ConnectionChoice {
  key: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  host: string;
}

function publicMCPHost(path: string): string | null {
  try {
    const url = new URL(path);
    return url.protocol === 'https:' ? url.host : null;
  } catch {
    return null;
  }
}

export function ConnectMCPAuthorizationDialog({ open, onOpenChange, principalId, identityName, initialWorkspaceId = '', initialConnectionName = '' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  principalId?: string;
  identityName: string;
  initialWorkspaceId?: string;
  initialConnectionName?: string;
}) {
  const reconnecting = Boolean(initialWorkspaceId && initialConnectionName);
  const fixedKey = reconnecting ? `${initialWorkspaceId}:${initialConnectionName}` : '';
  const [selectedKey, setSelectedKey] = useState(fixedKey);
  const [manualChoice, setManualChoice] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces, enabled: open });
  const grants = useQuery({ queryKey: ['admin-access'], queryFn: getAdminAccess, enabled: open && Boolean(principalId) });
  const eligibleWorkspaces = (workspaces.data ?? []).filter((workspace) => !principalId || grants.data?.servicePrincipals.some((grant) => grant.workspaceId === workspace.id && grant.servicePrincipalId === principalId));
  const configs = useQueries({ queries: eligibleWorkspaces.map((workspace) => ({
    queryKey: ['workspace-config', workspace.id], queryFn: () => getWorkspaceConfig(workspace.id), enabled: open, retry: false,
  })) });
  const choices: ConnectionChoice[] = eligibleWorkspaces.flatMap((workspace, index) =>
    (configs[index]?.data?.config.plugins ?? []).flatMap((connector) => {
      const host = connector.kind === 'mcp' ? publicMCPHost(connector.path) : null;
      return host ? [{ key: `${workspace.id}:${connector.name}`, workspaceId: workspace.id, workspaceName: workspace.name, name: connector.name, host }] : [];
    }),
  );
  const selected = choices.find((choice) => choice.key === (fixedKey || selectedKey)) ?? (reconnecting ? undefined : choices[0]);
  const loadingChoices = workspaces.isLoading || (Boolean(principalId) && grants.isLoading) || configs.some((query) => query.isPending);
  const readiness = useQuery({
    queryKey: ['mcp-authorization-readiness', principalId ?? 'me', selected?.workspaceId, selected?.name],
    queryFn: () => getMCPAuthorizationReadiness(selected!.workspaceId, selected!.name, principalId),
    enabled: open && Boolean(selected), retry: false, staleTime: 15_000,
  });
  const needsManualClient = readiness.data?.method === 'manual';
  const showManualClient = needsManualClient || manualChoice;
  const start = useMutation({
    mutationFn: () => startMCPAuthorization(selected!.workspaceId, selected!.name, {
      clientId: showManualClient ? clientId.trim() : '', clientSecret: showManualClient ? clientSecret : '',
    }, principalId),
    onSuccess: ({ authorizationUrl }) => { window.location.assign(authorizationUrl); },
  });
  const ready = Boolean(selected && readiness.data && !readiness.isFetching && (!showManualClient || clientId.trim()));

  return <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{reconnecting ? `Reconnect ${initialConnectionName}` : 'Authorize a connection'}</DialogTitle>
        <DialogDescription>{reconnecting ? 'Renew this connector authorization.' : 'Choose a workspace connection to authorize.'}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-1">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
          <span className="text-muted-foreground">Authorizing as</span>
          <span className="truncate font-medium">{identityName} <span className="font-normal text-muted-foreground">· {principalId ? 'Service principal' : 'Personal'}</span></span>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="mcp-connection-choice">Connection</label>
          {selected && (reconnecting || choices.length === 1) ? <div className="rounded-md border px-3 py-2.5 text-xs">
            <p className="font-medium">{selected.name} <span className="font-normal text-muted-foreground">· {selected.workspaceName}</span></p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{selected.host}</p>
          </div> : choices.length > 1 ? <Select onValueChange={(value) => { setSelectedKey(value); setManualChoice(false); start.reset(); }} value={selected?.key}>
            <SelectTrigger className="w-full" id="mcp-connection-choice"><SelectValue placeholder="Choose a connection" /></SelectTrigger>
            <SelectContent>{choices.map((choice) => <SelectItem key={choice.key} value={choice.key}>{choice.name} · {choice.workspaceName} · {choice.host}</SelectItem>)}</SelectContent>
          </Select> : <div className="rounded-md border px-3 py-3 text-xs text-muted-foreground">
            {loadingChoices ? 'Loading available connections…' : configs.some((query) => query.isError) ? 'Connection configuration is unavailable. Try again when the workspace is connected.' : 'No eligible HTTPS MCP connections are available.'}
          </div>}
        </div>

        {selected && <div className="rounded-md border bg-muted/20 px-3 py-3 text-xs" aria-live="polite">
          {readiness.isPending || readiness.isFetching ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Checking authorization options…</div>
            : readiness.isError ? <p className="text-destructive" role="alert">Authorization options are unavailable for this server. Choose another connection or try again later.</p>
              : readiness.data && <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{readiness.data.method === 'existing' ? 'Existing client registration' : needsManualClient ? 'Registered client ID needed' : 'Automatic client registration'}</p>
                  <p className="text-muted-foreground">{needsManualClient ? 'Enter a client ID registered with this provider.' : readiness.data.method === 'existing' ? 'The saved client registration for this identity will be used.' : 'This provider advertises dynamic registration.'}</p>
                  <p className="flex items-center gap-1 break-all pt-1 text-muted-foreground"><ExternalLink className="size-3 shrink-0" />Authorization provider: <span className="font-medium text-foreground">{readiness.data.providerHost}</span></p>
                </div>
              </div>}
        </div>}

        {readiness.data && !needsManualClient && <Button className="h-auto px-0 text-xs" onClick={() => { setManualChoice((current) => !current); start.reset(); }} size="sm" type="button" variant="link">
          {manualChoice ? (readiness.data.method === 'existing' ? 'Use saved client' : 'Use automatic registration') : 'Use a registered client'} <ChevronDown className={`ml-1 size-3 transition-transform ${manualChoice ? 'rotate-180' : ''}`} />
        </Button>}
        {readiness.data && showManualClient && <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor="mcp-client-id">Client ID</label><Input autoComplete="off" id="mcp-client-id" onChange={(event) => setClientId(event.target.value)} value={clientId} /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor="mcp-client-secret">Client secret <span className="font-normal text-muted-foreground">(if required)</span></label><Input autoComplete="off" id="mcp-client-secret" onChange={(event) => setClientSecret(event.target.value)} type="password" value={clientSecret} /></div>
          <p className="break-all text-[11px] text-muted-foreground">Callback URL: <span className="font-mono text-foreground">{readiness.data.callbackUrl}</span></p>
        </div>}
        {start.isError && <p className="text-xs text-destructive" role="alert">{start.error instanceof Error ? start.error.message : 'Unable to start authorization.'}</p>}
      </div>

      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} variant="outline">Cancel</Button>
        <Button disabled={!ready || start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Preparing authorization…' : `Continue to ${readiness.data?.providerHost ?? 'provider'}`}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
