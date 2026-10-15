import { useEffect, useState } from 'react';
import { CircleHelp, Info, Send } from 'lucide-react';
import { resolveHumanInput } from '@/api/client';
import type { HumanInputRequest } from '@/api/types';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { humanInputSubmitErrorMessage } from '@/lib/human-input-display';
import { cn } from '@/lib/utils';

export function HumanInputPrompt({ instanceId, onResolved, request }: { instanceId: string; onResolved: () => void; request: HumanInputRequest }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showOther, setShowOther] = useState(false);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingAnswer, setPendingAnswer] = useState<{ value: string; label: string } | null>(null);
  const [error, setError] = useState('');
  const hasChoices = Boolean(request.choices?.length);

  useEffect(() => { setSelected(new Set()); setShowOther(false); setResponse(''); setError(''); setPendingAnswer(null); }, [request.toolCallId]);

  const prepareAnswer = (value: string, label = value) => {
    if (!value.trim() || submitting) return;
    setError('');
    setPendingAnswer({ value, label });
  };

  const confirmAnswer = async () => {
    if (!pendingAnswer || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await resolveHumanInput(instanceId, request.toolCallId, pendingAnswer.value);
      setPendingAnswer(null);
      onResolved();
    } catch (cause) {
      setError(humanInputSubmitErrorMessage(cause));
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
        return <Button aria-pressed={request.multiSelect ? active : undefined} className={cn(request.multiSelect && active && 'border-primary bg-accent')} disabled={submitting} key={choice} onClick={() => request.multiSelect ? setSelected((current) => { const next = new Set(current); if (next.has(choice)) next.delete(choice); else next.add(choice); return next; }) : prepareAnswer(choice)} size="sm" variant="outline">{choice}</Button>;
      })}<Button disabled={submitting} onClick={() => setShowOther((current) => !current)} size="sm" variant="ghost">Other…</Button>{request.multiSelect && <Button disabled={submitting || selected.size === 0} onClick={() => prepareAnswer(JSON.stringify([...selected]), [...selected].join(', '))} size="sm"><Send className="size-3" />Review {selected.size} selected</Button>}</div>}
      {(!hasChoices || showOther) && <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); prepareAnswer(response); }}><Input aria-label="Your response" autoFocus placeholder="Type your response…" value={response} onChange={(event) => setResponse(event.target.value)} /><Button disabled={submitting || !response.trim()} type="submit"><Send className="size-3.5" />Review response</Button></form>}
      {error && <p className="mt-3 text-xs text-destructive" role="alert">{error}</p>}
    </div>
    <Dialog open={pendingAnswer !== null} onOpenChange={(open) => { if (!open && !submitting) setPendingAnswer(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Send this response?</DialogTitle><DialogDescription>This answer will be sent to the waiting mission.</DialogDescription></DialogHeader>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Your response</p><p className="whitespace-pre-wrap break-words">{pendingAnswer?.label}</p></div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button disabled={submitting} onClick={() => setPendingAnswer(null)} variant="outline">Cancel</Button><Button disabled={submitting} onClick={() => void confirmAnswer()}>{submitting ? 'Sending…' : 'Send response'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
