import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, CircleHelp, Clock3 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getWorkspaceConfig, listHumanInputs } from '@/api/client';
import type { HumanInputRequest } from '@/api/types';
import { HumanInputPrompt } from '@/components/HumanInputPrompt';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/button';
import { humanInputEmptyMessage, humanInputRequestedAge } from '@/lib/human-input-display';

type InboxState = HumanInputRequest['state'];
const pageSize = 25;
const views: Array<{ state: InboxState; label: string }> = [
  { state: 'open', label: 'Waiting' },
  { state: 'resolved', label: 'Answered' },
  { state: 'expired', label: 'Expired' },
];

export function HumanInputsPage() {
  const { workspaceId = '' } = useParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState<InboxState>('open');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
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

  return <div className="space-y-6">
    <header><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Workspace</p><h1 className="mt-1 text-2xl font-semibold">Human input</h1><p className="mt-2 text-sm text-muted-foreground">Questions from mission runs that need a person to respond.</p></header>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Request status">
      {views.map(({ state, label }) => <Button aria-pressed={view === state} key={state} onClick={() => chooseView(state)} size="sm" variant={view === state ? 'secondary' : 'outline'}>{label}</Button>)}
    </div>
    {notice && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-xs" role="status">{notice}</p>}
    {workspace.isLoading && <p className="text-sm text-muted-foreground">Loading workspace…</p>}
    {workspace.isError && <p className="text-sm text-destructive" role="alert">The workspace could not be loaded.</p>}
    {!workspace.isLoading && !workspace.isError && !connected && <p className="rounded-md border bg-card px-4 py-6 text-sm text-muted-foreground">Connect the workspace runner to inspect human-input requests.</p>}
    {connected && requests.isLoading && <p className="text-sm text-muted-foreground">Loading requests…</p>}
    {connected && requests.isError && <p className="rounded-md border border-destructive/40 px-4 py-3 text-sm text-destructive" role="alert">{requests.error instanceof Error ? requests.error.message : 'Requests could not be loaded.'}</p>}
    {connected && requests.isSuccess && <section className="overflow-hidden rounded-md border bg-card">
      <div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">{views.find((item) => item.state === view)?.label} requests</h2><p className="mt-1 text-[10px] text-muted-foreground">{requests.data.total} total · {view === 'open' ? 'oldest first' : 'newest first'}</p></div>
      {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{humanInputEmptyMessage(view)}</p>}
      <div className="divide-y">{rows.map((request) => <div key={request.id} className="px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">{request.state === 'open' ? <CircleHelp className="mt-0.5 size-4 shrink-0 text-amber-600" /> : request.state === 'resolved' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}<div className="min-w-0"><p className="text-xs font-medium">{request.shortSummary || request.question}</p><p className="mt-1 text-[10px] text-muted-foreground">{request.missionName || 'Mission'}{request.taskName ? ` · ${request.taskName}` : ''} · requested {humanInputRequestedAge(request.requestedAt)}</p></div></div>
          <Button aria-expanded={selectedId === request.toolCallId} onClick={() => setSelectedId((current) => current === request.toolCallId ? '' : request.toolCallId)} size="xs" variant="outline">{selectedId === request.toolCallId ? 'Hide details' : 'Review'}</Button>
        </div>
        {selected?.toolCallId === request.toolCallId && <div className="mt-4 space-y-4 border-t pt-4">
          {request.missionId && request.missionName && <Link className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" to={`/w/${workspaceId}/missions/${encodeURIComponent(request.missionName)}/runs/${encodeURIComponent(request.missionId)}`}>View mission run<ArrowUpRight className="size-3" /></Link>}
          {request.state === 'open' ? <HumanInputPrompt instanceId={instanceId} onResolved={() => { setNotice('Response sent. The mission can continue.'); setSelectedId(''); void queryClient.invalidateQueries({ queryKey: ['human-inputs', instanceId] }); if (request.missionId) void queryClient.invalidateQueries({ queryKey: ['mission-run', instanceId, request.missionId] }); }} request={request} /> : <RequestOutcome request={request} />}
        </div>}
      </div>)}</div>
      {(offset > 0 || offset + rows.length < requests.data.total) && <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><Button disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - pageSize)); setSelectedId(''); }} size="xs" variant="outline">Previous</Button><span className="text-[10px] text-muted-foreground">{offset + 1}–{offset + rows.length} of {requests.data.total}</span><Button disabled={offset + rows.length >= requests.data.total} onClick={() => { setOffset(offset + pageSize); setSelectedId(''); }} size="xs" variant="outline">Next</Button></div>}
    </section>}
  </div>;
}

function RequestOutcome({ request }: { request: HumanInputRequest }) {
  return <div className="space-y-3 text-xs"><div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Question</p><MarkdownContent className="mt-1" content={request.question} /></div><p className="text-muted-foreground">{request.state === 'expired' ? 'Expired' : 'Answered'} {request.resolvedAt ? `at ${formatTime(request.resolvedAt)}` : ''}{request.responderUserId ? ` · responder ${request.responderUserId}` : ''}</p>{request.response && <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Response</p><MarkdownContent className="mt-1" content={request.response} /></div>}</div>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'an unknown time' : date.toLocaleString();
}
