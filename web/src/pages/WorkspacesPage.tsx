import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, Plus, Server } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createWorkspace, listWorkspaces, provisionWorker } from '@/api/client';
import type { WorkerEnrollment } from '@/api/client';
import type { Workspace } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { RunnerConnectionDialog } from '@/components/RunnerConnectionDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function WorkspacesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [connectionWorkspace, setConnectionWorkspace] = useState<Workspace | null>(null);
  const [freshConnection, setFreshConnection] = useState<WorkerEnrollment | null>(null);

  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });

  const provision = useMutation({
    mutationFn: (workspace: Workspace) => provisionWorker(workspace.id),
    onSuccess: (result, workspace) => {
      setConnectionWorkspace({ ...workspace, worker: result.worker });
      setFreshConnection(result);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (provisionError) => {
      setError(provisionError instanceof Error ? provisionError.message : 'Unable to provision worker.');
    },
  });

  const create = useMutation({
    mutationFn: ({ name, repositoryUrl }: { name: string; repositoryUrl: string }) =>
      createWorkspace(name, repositoryUrl),
    onSuccess: (workspace) => {
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      provision.mutate(workspace);
    },
    onError: (createError) => {
      setError(createError instanceof Error ? createError.message : 'Unable to create workspace.');
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

  function changeConnectionDialog(open: boolean) {
    if (!open && connectionWorkspace) {
      const workspaceID = connectionWorkspace.id;
      setConnectionWorkspace(null);
      setFreshConnection(null);
      navigate(`/w/${workspaceID}`);
    }
  }

  if (workspaces.isLoading) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">Loading workspaces…</div>;
  }

  if (workspaces.isError) {
    return <div className="flex min-h-svh items-center justify-center text-destructive">Unable to load workspaces.</div>;
  }

  return (
    <div>
      <PageHeader
        actions={<Button onClick={() => setShowForm((visible) => !visible)}>
          <Plus />
          New workspace
        </Button>}
        description="Create and manage the durable homes for repositories, missions, agents, and runners."
        eyebrow="Command Center"
        title="Workspaces"
      />

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
                <span>Workspace name</span>
                <Input autoFocus name="name" placeholder="product-launch" required />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                <span>
                  Repository URL{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
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
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  {workspace.worker ? (
                    <p className="flex items-center gap-1.5">
                      <Server className="size-3.5" />
                      Runner: <span className="capitalize text-foreground">{workspace.worker.status}</span>
                    </p>
                  ) : (
                    <span>No runner connected</span>
                  )}
                  <div className="flex gap-2">
                    {!workspace.worker && (
                    <Button
                      disabled={provision.isPending}
                      onClick={() => connectWorker(workspace)}
                      size="sm"
                    >
                      {provision.isPending ? 'Provisioning…' : 'Connect runner'}
                    </Button>
                    )}
                    <Button onClick={() => navigate(`/w/${workspace.id}`)} size="sm" variant="outline">
                      Open workspace
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RunnerConnectionDialog
        freshConnection={freshConnection}
        onOpenChange={changeConnectionDialog}
        open={connectionWorkspace !== null}
        workspace={connectionWorkspace}
      />
    </div>
  );
}
