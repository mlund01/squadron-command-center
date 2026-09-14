import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { createWorkspaceVariable, deleteWorkspaceVariable, listWorkspaceVariables, revealWorkspaceVariable, updateWorkspaceVariable } from '@/api/client';
import type { WorkspaceVariable } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function WorkspaceVariablesCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<WorkspaceVariable | null | undefined>(undefined);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const variables = useQuery({ queryKey: ['workspace-variables', workspaceId], queryFn: () => listWorkspaceVariables(workspaceId) });
  const remove = useMutation({
    mutationFn: (name: string) => deleteWorkspaceVariable(workspaceId, name),
    onSuccess: (_result, name) => {
      setRevealed((current) => { const next = { ...current }; delete next[name]; return next; });
      queryClient.invalidateQueries({ queryKey: ['workspace-variables', workspaceId] });
    },
  });
  const reveal = useMutation({
    mutationFn: (name: string) => revealWorkspaceVariable(workspaceId, name),
    onSuccess: (result, name) => setRevealed((current) => ({ ...current, [name]: result.value })),
  });

  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div><CardTitle>Variables</CardTitle><CardDescription className="mt-2">Runtime values and secrets stored by Command Center for this workspace.</CardDescription></div>
            <div className="flex items-center gap-2"><KeyRound className="size-5 text-muted-foreground" /><Button onClick={() => setEditing(null)} size="sm"><Plus />Add variable</Button></div>
          </div>
        </CardHeader>
        <CardContent>
          {variables.isLoading && <p className="text-sm text-muted-foreground">Loading variables…</p>}
          {variables.isError && <p className="text-sm text-destructive">You do not have permission to manage workspace variables.</p>}
          {variables.data?.length === 0 && <p className="text-sm text-muted-foreground">No variables have been stored.</p>}
          {!!variables.data?.length && <div className="overflow-hidden rounded-md border">
            {variables.data.map((variable) => <div className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0" key={variable.name}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="font-mono text-sm text-foreground">{variable.name}</span>{variable.secret && <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Secret</span>}</div>
                <p className="mt-1 break-all text-xs text-muted-foreground">{variable.hasValue ? (variable.secret ? (revealed[variable.name] ?? 'Value protected') : variable.value) : 'No value set'}</p>
              </div>
              {variable.secret && variable.hasValue && <Button aria-label={`${revealed[variable.name] ? 'Hide' : 'Reveal'} ${variable.name}`} disabled={reveal.isPending && reveal.variables === variable.name} onClick={() => revealed[variable.name] ? setRevealed((current) => { const next = { ...current }; delete next[variable.name]; return next; }) : reveal.mutate(variable.name)} size="sm" variant="ghost">{revealed[variable.name] ? <EyeOff /> : <Eye />}{revealed[variable.name] ? 'Hide' : 'Reveal'}</Button>}
              <Button aria-label={`Edit ${variable.name}`} onClick={() => { setRevealed((current) => { const next = { ...current }; delete next[variable.name]; return next; }); setEditing(variable); }} size="sm" variant="ghost"><Pencil />Edit</Button>
              <Button aria-label={`Delete ${variable.name}`} disabled={remove.isPending} onClick={() => remove.mutate(variable.name)} size="icon-sm" variant="ghost"><Trash2 /></Button>
            </div>)}
          </div>}
          {reveal.isError && <p className="mt-3 text-sm text-destructive">Unable to reveal this value.</p>}
        </CardContent>
      </Card>
      {editing !== undefined && <VariableDialog editing={editing} key={editing?.name ?? 'new'} onOpenChange={(open) => { if (!open) setEditing(undefined); }} workspaceId={workspaceId} />}
    </>
  );
}

function VariableDialog({ editing, onOpenChange, workspaceId }: { editing: WorkspaceVariable | null; onOpenChange: (open: boolean) => void; workspaceId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(editing?.name ?? '');
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(editing?.secret ?? false);
  const save = useMutation({
    mutationFn: () => editing
      ? updateWorkspaceVariable(workspaceId, editing.name, { value, secret })
      : createWorkspaceVariable(workspaceId, { name, value, secret }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workspace-variables', workspaceId] }); onOpenChange(false); },
  });
  return <Dialog onOpenChange={onOpenChange} open>
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? `Update ${editing.name}` : 'Add variable'}</DialogTitle><DialogDescription>Command Center encrypts this value before storing it. Connected runners receive it in memory.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <label className="block space-y-1.5 text-sm"><span>Name</span><Input autoComplete="off" disabled={!!editing} onChange={(event) => setName(event.target.value)} placeholder="api_key" value={name} /></label>
        <label className="block space-y-1.5 text-sm"><span>{editing ? 'New value' : 'Value'}</span><Input autoComplete="off" onChange={(event) => setValue(event.target.value)} type={secret ? 'password' : 'text'} value={value} /></label>
        <label className="flex items-center gap-2 text-sm"><input checked={secret} className="size-4 rounded border-input accent-primary" onChange={(event) => setSecret(event.target.checked)} type="checkbox" /><span>Treat as secret</span></label>
        {save.isError && <p className="text-sm text-destructive">{save.error.message}</p>}
      </div>
      <DialogFooter><Button disabled={!name || !value || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save variable'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
