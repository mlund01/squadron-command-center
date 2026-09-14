import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Copy, FolderGit2, Plus, Server } from 'lucide-react';
import { createWorkspace, listWorkspaces, provisionWorker, revealWorkerCredential } from '@/api/client';
import type { WorkerEnrollment } from '@/api/client';
import type { Workspace } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';

export function WorkspacesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [enrollment, setEnrollment] = useState<WorkerEnrollment | null>(null);

  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  });

  const create = useMutation({
    mutationFn: ({ name, repositoryUrl }: { name: string; repositoryUrl: string }) =>
      createWorkspace(name, repositoryUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setShowForm(false);
    },
    onError: (createError) => {
      setError(createError instanceof Error ? createError.message : 'Unable to create workspace.');
    },
  });

  const provision = useMutation({
    mutationFn: (workspace: Workspace) => provisionWorker(workspace.id),
    onSuccess: (result) => {
      setEnrollment(result);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (provisionError) => {
      setError(provisionError instanceof Error ? provisionError.message : 'Unable to provision worker.');
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    create.mutate({
      name: String(form.get('name') ?? ''),
      repositoryUrl: String(form.get('repositoryUrl') ?? ''),
    });
  }

  function connectWorker(workspace: Workspace) {
    setError('');
    provision.mutate(workspace);
  }

  if (workspaces.isLoading) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">Loading workspaces…</div>;
  }

  if (workspaces.isError) {
    return <div className="flex min-h-svh items-center justify-center text-destructive">Unable to load workspaces.</div>;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Squadron Command Center</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            A workspace is the durable home for a repository, its missions, and its Squadron runner.
          </p>
        </div>
        <Button onClick={() => setShowForm((visible) => !visible)}>
          <Plus />
          New workspace
        </Button>
      </div>

      {error && !showForm && <p className="mb-6 text-sm text-destructive">{error}</p>}

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create workspace</CardTitle>
            <CardDescription>Connect a repository now, or add one later.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              <label className="grid gap-1.5 text-sm font-medium">
                Workspace name
                <Input autoFocus name="name" placeholder="product-launch" required />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Repository URL <span className="font-normal text-muted-foreground">(optional)</span>
                <Input name="repositoryUrl" placeholder="https://github.com/org/repository" />
              </label>
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <div className="flex gap-2 sm:col-span-2">
                <Button disabled={create.isPending} type="submit">
                  {create.isPending ? 'Creating…' : 'Create workspace'}
                </Button>
                <Button onClick={() => setShowForm(false)} type="button" variant="outline">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {enrollment && (
        <Card className="mb-6 border-primary/40">
          <CardHeader>
            <CardTitle>Runner connection</CardTitle>
            <CardDescription>
              Your administrators can retrieve this credential later from the workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ConnectionDetailsAccordion defaultOpen>
              <ConnectionDetails
                commandCenterURL={enrollment.commandCenterURL}
                credential={enrollment.credential}
              />
            </ConnectionDetailsAccordion>
            <p className="text-sm text-muted-foreground">
              Run <code className="rounded bg-muted px-1.5 py-0.5">squadron engage</code> in the workspace. On first start, Squadron will prompt for the URL and credential and save them locally with restricted permissions.
            </p>
          </CardContent>
        </Card>
      )}

      {workspaces.data?.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
            <FolderGit2 className="size-7 text-muted-foreground" />
            <div>
              <p className="font-medium">No workspaces yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create one to begin organizing work in Command Center.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {workspaces.data?.map((workspace) => (
            <Card key={workspace.id}>
              <CardHeader>
                <CardTitle>{workspace.name}</CardTitle>
                <CardDescription>
                  {workspace.repositoryUrl ?? 'Repository not connected'}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Default branch: <span className="font-mono text-foreground">{workspace.defaultBranch}</span></p>
                {workspace.worker ? (
                  <>
                    <div className="mt-2 flex items-center gap-1.5">
                      <p className="flex items-center gap-1.5">
                        <Server className="size-3.5" />
                        Runner: <span className="capitalize text-foreground">{workspace.worker.status}</span>
                      </p>
                    </div>
                    <WorkspaceConnectionDetails workspaceId={workspace.id} />
                  </>
                ) : (
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span>No runner connected</span>
                    <Button
                      disabled={provision.isPending}
                      onClick={() => connectWorker(workspace)}
                      size="sm"
                    >
                      {provision.isPending ? 'Provisioning…' : 'Connect runner'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

    </main>
  );
}

function WorkspaceConnectionDetails({ workspaceId }: { workspaceId: string }) {
  const credential = useQuery({
    queryKey: ['workspaces', workspaceId, 'credential'],
    queryFn: () => revealWorkerCredential(workspaceId),
  });

  if (credential.isLoading) {
    return <p className="mt-3 text-xs text-muted-foreground">Loading credential…</p>;
  }
  if (credential.isError || !credential.data) {
    return <p className="mt-3 text-xs text-destructive">Credential unavailable.</p>;
  }
  return (
    <ConnectionDetailsAccordion>
      <ConnectionDetails
        commandCenterURL={credential.data.commandCenterURL}
        credential={credential.data.credential}
      />
    </ConnectionDetailsAccordion>
  );
}

function ConnectionDetails({
  commandCenterURL,
  credential,
}: {
  commandCenterURL: string;
  credential: string;
}) {
  return (
    <dl className="grid gap-3 bg-muted p-3 text-sm">
      <ConnectionDetail label="Command Center WebSocket URL" value={commandCenterURL} />
      <div>
        <dt className="text-xs text-muted-foreground">Runner credential</dt>
        <dd className="mt-1"><CredentialValue credential={credential} /></dd>
      </div>
      <ConnectionDetail label="Start Squadron" value="squadron engage --foreground" />
    </dl>
  );
}

function ConnectionDetailsAccordion({ children, defaultOpen = false }: { children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible className="mt-3 overflow-hidden rounded-md border bg-muted" defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-accent/50">
        Connection details
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ConnectionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-foreground">{value}</code>
        <CopyButton label={label} value={value} />
      </dd>
    </div>
  );
}

function CredentialValue({ credential }: { credential: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-xs text-foreground">
        {credential.slice(0, 5)}
        <span className="select-none" aria-hidden="true">{'•'.repeat(Math.max(credential.length - 5, 0))}</span>
      </code>
      <CopyButton label="runner credential" value={credential} />
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      aria-label={`Copy ${label}`}
      onClick={copyValue}
      size="icon-xs"
      title={copied ? 'Copied' : `Copy ${label}`}
      type="button"
      variant="ghost"
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
