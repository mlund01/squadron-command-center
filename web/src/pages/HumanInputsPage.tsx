import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, CircleHelp, Clock3 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getWorkspaceConfig, listHumanInputs, listWorkspaces } from '@/api/client';
import type { HumanInputRequest } from '@/api/types';
import { HumanInputOutcome } from '@/components/HumanInputOutcome';
import { HumanInputPrompt } from '@/components/HumanInputPrompt';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { humanInputEmptyMessage, humanInputRequestedAge } from '@/lib/human-input-display';

type InboxState = HumanInputRequest['state'];
const pageSize = 25;
const views: Array<{ state: InboxState; label: string }> = [
  { state: 'open', label: 'Waiting' },
  { state: 'resolved', label: 'Answered' },
  { state: 'expired', label: 'Expired' },
  { state: 'canceled', label: 'Canceled' },
];

export function HumanInputsPage() {
  const { workspaceId = '' } = useParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState<InboxState>('open');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspaceName = workspaces.data?.find((candidate) => candidate.id === workspaceId)?.name;
  const workspace = useQuery({ queryKey: ['workspace-config', workspaceId], queryFn: () => getWorkspaceConfig(workspaceId), enabled: Boolean(workspaceId), refetchInterval: 5_000, retry: false });
  const instanceId = workspace.data?.instanceId ?? '';
  const connected = Boolean(workspace.data?.connected && instanceId);
  const requests = useQuery({
    queryKey: ['human-inputs', instanceId, 'inbox', view, offset],
    queryFn: () => listHumanInputs(instanceId, '', view, { offset, limit: pageSize }),
    enabled: connected,
    refetchInterval: connected ? 2_000 : false,
    retry: false,
  });
  const rows = requests.data?.humanInputs ?? [];
  const selected = rows.find((request) => request.toolCallId === selectedId);
  const chooseView = (next: InboxState) => { setView(next); setOffset(0); setSelectedId(''); setNotice(''); };

  return <div>
    <PageHeader
      description="Questions from mission runs that need a person to respond."
      eyebrow={workspaceName ?? 'Workspace'}
      title="Human input"
    />
    <div className="mb-5 flex flex-wrap items-center gap-3 border-b pb-4" role="group" aria-label="Request status">
      <div className="flex items-center gap-1">
        {views.map(({ state, label }) => <Button aria-pressed={view === state} key={state} onClick={() => chooseView(state)} size="xs" variant={view === state ? 'secondary' : 'ghost'}>{label}</Button>)}
      </div>
    </div>
    {notice && <p className="mb-5 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-xs" role="status">{notice}</p>}
    {workspace.isLoading && <p className="text-sm text-muted-foreground">Loading workspace…</p>}
    {workspace.isError && <p className="text-sm text-destructive" role="alert">The workspace could not be loaded.</p>}
    {!workspace.isLoading && !workspace.isError && !connected && <p className="rounded-md border bg-card px-4 py-6 text-sm text-muted-foreground">Connect the workspace runner to inspect human-input requests.</p>}
    {connected && requests.isLoading && <p className="text-sm text-muted-foreground">Loading requests…</p>}
    {connected && requests.isError && <p className="rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive" role="alert">{requests.error instanceof Error ? requests.error.message : 'Requests could not be loaded.'}</p>}
    {connected && requests.isSuccess && <>
      <p className="mb-4 text-xs text-muted-foreground"><strong className="mr-1.5 font-medium text-foreground">{requests.data.total}</strong>{views.find((item) => item.state === view)?.label.toLowerCase()} requests <span className="ml-2">· {view === 'open' ? 'oldest first' : 'newest first'}</span></p>
      <section className="overflow-x-auto rounded-md border bg-card" aria-label={`${views.find((item) => item.state === view)?.label} requests`}>
        <div className="min-w-[660px]">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_8rem_5rem] gap-4 border-b bg-muted/50 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Request</span><span>Mission</span><span>Requested</span><span className="text-right">Details</span>
          </div>
          {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{humanInputEmptyMessage(view)}</p>}
          {rows.map((request) => <div key={request.id} className="border-b last:border-b-0">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_8rem_5rem] items-center gap-4 px-4 py-3 text-xs">
              <div className="flex min-w-0 items-center gap-2.5">{request.state === 'open' ? <CircleHelp className="size-3.5 shrink-0 text-amber-600" /> : request.state === 'resolved' ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /> : <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />}<p className="truncate font-medium text-foreground" title={request.shortSummary || request.question}>{request.shortSummary || request.question}</p></div>
              <div className="min-w-0"><p className="truncate text-foreground">{request.missionName || 'Mission'}</p>{request.taskName && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{request.taskName}</p>}</div>
              <span className="text-muted-foreground">{humanInputRequestedAge(request.requestedAt)}</span>
              <Button aria-expanded={selectedId === request.toolCallId} className="justify-self-end" onClick={() => setSelectedId((current) => current === request.toolCallId ? '' : request.toolCallId)} size="xs" variant="ghost">{selectedId === request.toolCallId ? 'Hide' : 'Review'}</Button>
            </div>
            {selected?.toolCallId === request.toolCallId && <div className="space-y-4 border-t bg-muted/15 px-4 py-4">
              <div className="flex flex-wrap items-center gap-4">
                <Link className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" to={`/w/${workspaceId}/human-input/${encodeURIComponent(request.toolCallId)}`}>Open request<ArrowUpRight className="size-3" /></Link>
                {request.missionId && request.missionName && <Link className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" to={`/w/${workspaceId}/missions/${encodeURIComponent(request.missionName)}/runs/${encodeURIComponent(request.missionId)}`}>View mission run<ArrowUpRight className="size-3" /></Link>}
              </div>
              {request.state === 'open' ? <HumanInputPrompt instanceId={instanceId} onResolved={() => { setNotice('Response sent. The mission can continue.'); setSelectedId(''); void queryClient.invalidateQueries({ queryKey: ['human-inputs', instanceId] }); if (request.missionId) void queryClient.invalidateQueries({ queryKey: ['mission-run', instanceId, request.missionId] }); }} request={request} /> : <HumanInputOutcome request={request} />}
            </div>}
          </div>)}
          {(offset > 0 || offset + rows.length < requests.data.total) && <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><Button disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - pageSize)); setSelectedId(''); }} size="xs" variant="outline">Previous</Button><span className="text-[10px] text-muted-foreground">{offset + 1}–{offset + rows.length} of {requests.data.total}</span><Button disabled={offset + rows.length >= requests.data.total} onClick={() => { setOffset(offset + pageSize); setSelectedId(''); }} size="xs" variant="outline">Next</Button></div>}
        </div>
      </section>
    </>}
  </div>;
}
