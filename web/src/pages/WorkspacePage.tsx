import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Server } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { listWorkspaces, provisionWorker } from '@/api/client';
import type { WorkerEnrollment } from '@/api/client';
import type { Workspace } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { RunnerConnectionDialog } from '@/components/RunnerConnectionDialog';
import { WorkspaceModelProvidersCard } from '@/components/WorkspaceModelProvidersCard';
import { WorkspaceVariablesCard } from '@/components/WorkspaceVariablesCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function WorkspacePage() {
  const { workspaceId } = useParams();
  const queryClient = useQueryClient();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [freshConnection, setFreshConnection] = useState<WorkerEnrollment | null>(null);
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId) ?? null;
  const provision = useMutation({
    mutationFn: (target: Workspace) => provisionWorker(target.id),
    onSuccess: (result) => {
      setFreshConnection(result);
      setConnectionOpen(true);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  if (workspaces.isLoading) return <p className="text-sm text-muted-foreground">Loading workspace…</p>;
  if (!workspace) return <p className="text-sm text-destructive">Workspace not found.</p>;

  const status = workspace.worker?.status ?? 'not connected';

  return (
    <div>
      <PageHeader description="Manage the repository and Squadron runner connected to this workspace." eyebrow={workspace.name} title="Workspace" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div><CardTitle>Runner health</CardTitle><CardDescription className="mt-2">The single Squadron runner assigned to this workspace.</CardDescription></div>
              <Server className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className={cn('size-2 rounded-full', status === 'connected' ? 'bg-emerald-500' : status === 'pending' ? 'bg-amber-500' : 'bg-muted-foreground')} />
              <span className="capitalize text-foreground">{status}</span>
            </div>
            {workspace.worker?.lastSeenAt && <p className="text-xs text-muted-foreground">Last seen {new Date(workspace.worker.lastSeenAt).toLocaleString()}</p>}
            {workspace.worker ? (
              <Button onClick={() => setConnectionOpen(true)} size="sm" variant="outline">Connection details</Button>
            ) : (
              <Button disabled={provision.isPending} onClick={() => provision.mutate(workspace)} size="sm">{provision.isPending ? 'Provisioning…' : 'Connect runner'}</Button>
            )}
            {provision.isError && <p className="text-xs text-destructive">Unable to provision runner.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div><CardTitle>Repository</CardTitle><CardDescription className="mt-2">The source repository and branch used by this workspace.</CardDescription></div>
              <GitBranch className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="break-all text-foreground">{workspace.repositoryUrl || 'Repository not connected'}</p>
            <p className="text-muted-foreground">Default branch: <span className="text-foreground">{workspace.defaultBranch}</span></p>
          </CardContent>
        </Card>
        <WorkspaceModelProvidersCard workspaceId={workspace.id} />
        <WorkspaceVariablesCard workspaceId={workspace.id} />
      </div>
      <RunnerConnectionDialog
        freshConnection={freshConnection}
        onOpenChange={(open) => { setConnectionOpen(open); if (!open) setFreshConnection(null); }}
        open={connectionOpen}
        workspace={workspace}
      />
    </div>
  );
}
