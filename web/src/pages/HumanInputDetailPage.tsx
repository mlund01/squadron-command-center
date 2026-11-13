import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getHumanInput, getWorkspaceConfig, listWorkspaces } from '@/api/client';
import { HumanInputOutcome } from '@/components/HumanInputOutcome';
import { HumanInputPrompt } from '@/components/HumanInputPrompt';
import { PageHeader } from '@/components/PageHeader';
import { humanInputRequestedAge } from '@/lib/human-input-display';

export function HumanInputDetailPage() {
  const { workspaceId = '', callId = '' } = useParams();
  const queryClient = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspaceName = workspaces.data?.find((candidate) => candidate.id === workspaceId)?.name;
  const workspace = useQuery({ queryKey: ['workspace-config', workspaceId], queryFn: () => getWorkspaceConfig(workspaceId), enabled: Boolean(workspaceId), refetchInterval: 5_000, retry: false });
  const instanceId = workspace.data?.instanceId ?? '';
  const connected = Boolean(workspace.data?.connected && instanceId);
  const detail = useQuery({
    queryKey: ['human-input', instanceId, callId],
    queryFn: () => getHumanInput(instanceId, callId),
    enabled: connected && Boolean(callId),
    refetchInterval: (query) => query.state.data?.humanInput.state === 'open' ? 2_000 : false,
    retry: false,
  });
  const request = detail.data?.humanInput;
  const runHref = request?.missionId && request.missionName
    ? `/w/${workspaceId}/missions/${encodeURIComponent(request.missionName)}/runs/${encodeURIComponent(request.missionId)}`
    : '';

  return <div>
    <Link className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" to={`/w/${workspaceId}/human-input`}><ArrowLeft className="size-3.5" />Human input</Link>
    <PageHeader description="Review the request, its mission context, and the recorded outcome." eyebrow={workspaceName ?? 'Workspace'} title="Human input request" />
    {workspace.isLoading && <PageState title="Loading workspace…" />}
    {workspace.isError && <PageState title="The workspace could not be loaded." />}
    {!workspace.isLoading && !workspace.isError && !connected && <PageState title="Runner disconnected" description="Reconnect the workspace runner to inspect this request." />}
    {connected && detail.isLoading && <PageState title="Loading request…" />}
    {connected && detail.isError && <PageState title="Request unavailable" description="The request was not found or could not be loaded. It may belong to another runner." />}
    {request && <div className="space-y-5">
      <section className="overflow-hidden rounded-md border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
          <div><h2 className="text-sm font-semibold">{request.shortSummary || 'Human input request'}</h2><p className="mt-1 text-xs text-muted-foreground">Requested {humanInputRequestedAge(request.requestedAt)}</p></div>
          <span className="rounded-md border px-2 py-1 text-[10px] font-medium capitalize">{request.state === 'open' ? 'Waiting' : request.state === 'resolved' ? 'Answered' : request.state}</span>
        </div>
        <dl className="grid gap-4 px-4 py-4 text-xs sm:grid-cols-3">
          <div><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Mission</dt><dd className="mt-1 font-medium">{request.missionName || 'Unknown mission'}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Task</dt><dd className="mt-1 font-medium">{request.taskName || '—'}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Deadline</dt><dd className="mt-1 font-medium">{request.deadlineAt ? formatTime(request.deadlineAt) : 'None'}</dd></div>
        </dl>
        {runHref && <div className="border-t px-4 py-3"><Link className="inline-flex items-center gap-1 text-xs text-primary hover:underline" to={runHref}>View mission run<ArrowUpRight className="size-3.5" /></Link></div>}
      </section>
      {request.state === 'open'
        ? <HumanInputPrompt instanceId={instanceId} onResolved={() => { void queryClient.invalidateQueries({ queryKey: ['human-input', instanceId, callId] }); void queryClient.invalidateQueries({ queryKey: ['human-inputs', instanceId] }); if (request.missionId) void queryClient.invalidateQueries({ queryKey: ['mission-run', instanceId, request.missionId] }); }} request={request} />
        : <section className="rounded-md border bg-card p-4"><HumanInputOutcome request={request} /></section>}
    </div>}
  </div>;
}

function PageState({ description, title }: { description?: string; title: string }) {
  return <div className="grid min-h-64 place-items-center rounded-md border bg-card px-6 text-center"><div><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}</div></div>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
