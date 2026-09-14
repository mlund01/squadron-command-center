import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createWorkspaceModelConnection,
  deleteWorkspaceModelConnection,
  listWorkspaceModelConnections,
  revealWorkspaceModelConnectionKey,
  updateWorkspaceModelConnection,
} from '@/api/client';
import type { ModelProviderKind, WorkspaceModelConnection } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function WorkspaceModelProvidersCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<WorkspaceModelConnection | null | undefined>(undefined);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const connections = useQuery({
    queryKey: ['workspace-model-connections', workspaceId],
    queryFn: () => listWorkspaceModelConnections(workspaceId),
    retry: false,
  });
  const remove = useMutation({
    mutationFn: (name: string) => deleteWorkspaceModelConnection(workspaceId, name),
    onSuccess: (_result, name) => {
      setRevealed((current) => { const next = { ...current }; delete next[name]; return next; });
      queryClient.invalidateQueries({ queryKey: ['workspace-model-connections', workspaceId] });
    },
  });
  const reveal = useMutation({
    mutationFn: (name: string) => revealWorkspaceModelConnectionKey(workspaceId, name),
    onSuccess: (result, name) => setRevealed((current) => ({ ...current, [name]: result.value })),
  });

  return <>
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle>Model providers</CardTitle><CardDescription className="mt-2">Credentials and endpoints available to this workspace. HCL controls which models each named connection may use.</CardDescription></div>
          <div className="flex items-center gap-2"><BrainCircuit className="size-5 text-muted-foreground" /><Button onClick={() => setEditing(null)} size="sm"><Plus />Add provider</Button></div>
        </div>
      </CardHeader>
      <CardContent>
        {connections.isLoading && <p className="text-sm text-muted-foreground">Loading model providers…</p>}
        {connections.isError && <p className="text-sm text-destructive">You do not have permission to manage model providers.</p>}
        {connections.data?.length === 0 && <p className="text-sm text-muted-foreground">No model providers configured.</p>}
        {!!connections.data?.length && <div className="overflow-hidden rounded-md border">
          {connections.data.map((connection) => <div className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0" key={connection.name}>
            <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted"><BrainCircuit className="size-4 text-muted-foreground" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm text-foreground">{connection.name}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{providerLabel(connection.provider)}{connection.baseUrl ? ` · ${connection.baseUrl}` : ''}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{connection.hasApiKey ? (revealed[connection.name] ?? 'Credential protected') : 'No credential required'}</p>
            </div>
            {connection.hasApiKey && <Button aria-label={`${revealed[connection.name] ? 'Hide' : 'Reveal'} ${connection.name}`} disabled={reveal.isPending && reveal.variables === connection.name} onClick={() => revealed[connection.name] ? setRevealed((current) => { const next = { ...current }; delete next[connection.name]; return next; }) : reveal.mutate(connection.name)} size="sm" variant="ghost">{revealed[connection.name] ? <EyeOff /> : <Eye />}{revealed[connection.name] ? 'Hide' : 'Reveal'}</Button>}
            <Button aria-label={`Edit ${connection.name}`} onClick={() => { setRevealed((current) => { const next = { ...current }; delete next[connection.name]; return next; }); setEditing(connection); }} size="sm" variant="ghost"><Pencil />Edit</Button>
            <Button aria-label={`Delete ${connection.name}`} disabled={remove.isPending} onClick={() => remove.mutate(connection.name)} size="icon-sm" variant="ghost"><Trash2 /></Button>
          </div>)}
        </div>}
        {reveal.isError && <p className="mt-3 text-sm text-destructive">Unable to reveal this credential.</p>}
        {remove.isError && <p className="mt-3 text-sm text-destructive">Unable to delete this model provider.</p>}
      </CardContent>
    </Card>
    {editing !== undefined && <ModelProviderDialog connection={editing} key={editing?.name ?? 'new'} onOpenChange={(open) => { if (!open) setEditing(undefined); }} workspaceId={workspaceId} />}
  </>;
}

function ModelProviderDialog({ connection, onOpenChange, workspaceId }: { connection: WorkspaceModelConnection | null; onOpenChange: (open: boolean) => void; workspaceId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(connection?.name ?? '');
  const [provider, setProvider] = useState<ModelProviderKind>(connection?.provider ?? 'anthropic');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [promptCaching, setPromptCaching] = useState(connection?.promptCaching ?? true);
  const save = useMutation({
    mutationFn: () => connection
      ? updateWorkspaceModelConnection(workspaceId, connection.name, { provider, baseUrl, apiKey: apiKey || undefined, promptCaching })
      : createWorkspaceModelConnection(workspaceId, { name, provider, baseUrl, apiKey: apiKey || undefined, promptCaching }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workspace-model-connections', workspaceId] }); onOpenChange(false); },
  });
  const needsKey = provider !== 'openai_compatible';

  return <Dialog onOpenChange={onOpenChange} open>
    <DialogContent>
      <DialogHeader><DialogTitle>{connection ? `Edit ${connection.name}` : 'Add model provider'}</DialogTitle><DialogDescription>Use a distinct connection name when the same provider has multiple accounts or endpoints. Match that name in the HCL model_provider block.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <label className="block space-y-1.5 text-sm"><span>Connection name</span><Input autoComplete="off" disabled={Boolean(connection)} onChange={(event) => setName(event.target.value)} placeholder="anthropic" value={name} /></label>
        <label className="block space-y-1.5 text-sm"><span>Provider</span><Select onValueChange={(value) => setProvider(value as ModelProviderKind)} value={provider}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="gemini">Google Gemini</SelectItem><SelectItem value="openai_compatible">OpenAI-compatible</SelectItem></SelectContent></Select></label>
        <label className="block space-y-1.5 text-sm"><span>Base URL {provider === 'openai_compatible' ? '' : '(optional)'}</span><Input autoComplete="off" onChange={(event) => setBaseUrl(event.target.value)} placeholder={provider === 'openai_compatible' ? 'http://localhost:11434/v1' : 'Use provider default'} value={baseUrl} /></label>
        <label className="block space-y-1.5 text-sm"><span>{connection?.hasApiKey ? 'Replace API key (optional)' : needsKey ? 'API key' : 'API key (optional)'}</span><Input autoComplete="off" onChange={(event) => setApiKey(event.target.value)} type="password" value={apiKey} /></label>
        <label className="flex items-center gap-2 text-sm"><input checked={promptCaching} className="size-4 rounded border-input accent-primary" onChange={(event) => setPromptCaching(event.target.checked)} type="checkbox" /><span>Enable prompt caching when supported</span></label>
        {save.isError && <p className="text-sm text-destructive">{save.error.message}</p>}
      </div>
      <DialogFooter><Button disabled={!name || (provider === 'openai_compatible' && !baseUrl) || (needsKey && !connection?.hasApiKey && !apiKey) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save provider'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function providerLabel(provider: ModelProviderKind) {
  return provider === 'openai_compatible' ? 'OpenAI-compatible' : provider === 'gemini' ? 'Google Gemini' : provider[0].toUpperCase() + provider.slice(1);
}
