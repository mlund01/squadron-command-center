import type { HumanInputRequest } from '@/api/types';
import { MarkdownContent } from '@/components/MarkdownContent';

export function HumanInputOutcome({ request }: { request: HumanInputRequest }) {
  const outcome = request.state === 'canceled' ? 'Canceled' : request.state === 'expired' ? 'Expired' : 'Answered';
  const happenedAt = request.resolvedAt ?? request.expiredAt ?? request.canceledAt;

  return <div className="space-y-3 text-xs">
    <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Question</p><MarkdownContent className="mt-1" content={request.question} /></div>
    {request.additionalContext && <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Context</p><MarkdownContent className="mt-1" content={request.additionalContext} /></div>}
    {request.choices?.length ? <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Choices</p><p className="mt-1 text-muted-foreground">{request.choices.join(' · ')}</p></div> : null}
    <p className="text-muted-foreground">{outcome}{happenedAt ? ` at ${formatTime(happenedAt)}` : ''}{request.responderUserId ? ` · responder ${request.responderUserId}` : ''}</p>
    {request.state === 'canceled' && request.cancelReason && <p className="text-muted-foreground">{request.cancelReason}</p>}
    {request.response && request.state === 'resolved' && <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Response</p><MarkdownContent className="mt-1" content={request.response} /></div>}
  </div>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'an unknown time' : date.toLocaleString();
}
