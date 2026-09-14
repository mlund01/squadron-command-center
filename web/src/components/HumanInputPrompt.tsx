import { useEffect, useState } from 'react';
import { CircleHelp, Info, Send } from 'lucide-react';
import { resolveHumanInput } from '@/api/client';
import type { HumanInputRequest } from '@/api/types';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function HumanInputPrompt({ instanceId, onResolved, request }: { instanceId: string; onResolved: () => void; request: HumanInputRequest }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showOther, setShowOther] = useState(false);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const hasChoices = Boolean(request.choices?.length);

  useEffect(() => { setSelected(new Set()); setShowOther(false); setResponse(''); setError(''); }, [request.toolCallId]);

  const submit = async (value: string) => {
    if (!value.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await resolveHumanInput(instanceId, request.toolCallId, value);
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The response could not be submitted.');
    } finally { setSubmitting(false); }
  };

  return <section className="overflow-hidden rounded-md border border-amber-500/40 bg-card">
    <div className="flex items-start gap-3 border-b border-amber-500/25 bg-amber-500/10 px-4 py-3">
      <CircleHelp className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">Input requested{request.taskName ? ` · ${request.taskName}` : ''}</p>{request.shortSummary && <p className="mt-1 text-xs font-medium">{request.shortSummary}</p>}</div>
    </div>
    <div className="p-4">
      <MarkdownContent className="text-sm [&_p]:leading-6" content={request.question} />
      {request.additionalContext && <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/40 p-3 text-[11px] text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" /><MarkdownContent className="min-w-0 [&_p]:leading-5" content={request.additionalContext} /></div>}
      {hasChoices && <div className="mt-4 flex flex-wrap gap-2">{request.choices?.map((choice) => {
        const active = selected.has(choice);
        return <Button aria-pressed={request.multiSelect ? active : undefined} className={cn(request.multiSelect && active && 'border-primary bg-accent')} disabled={submitting} key={choice} onClick={() => request.multiSelect ? setSelected((current) => { const next = new Set(current); if (next.has(choice)) next.delete(choice); else next.add(choice); return next; }) : submit(choice)} size="sm" variant="outline">{choice}</Button>;
      })}<Button disabled={submitting} onClick={() => setShowOther((current) => !current)} size="sm" variant="ghost">Other…</Button>{request.multiSelect && <Button disabled={submitting || selected.size === 0} onClick={() => submit(JSON.stringify([...selected]))} size="sm"><Send className="size-3" />Send {selected.size} selected</Button>}</div>}
      {(!hasChoices || showOther) && <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); submit(response); }}><Input aria-label="Your response" autoFocus placeholder="Type your response…" value={response} onChange={(event) => setResponse(event.target.value)} /><Button disabled={submitting || !response.trim()} type="submit"><Send className="size-3.5" />{submitting ? 'Sending…' : 'Send'}</Button></form>}
      {error && <p className="mt-3 text-xs text-destructive" role="alert">{error}</p>}
    </div>
  </section>;
}
