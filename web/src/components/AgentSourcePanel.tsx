import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, Check, Copy, FileCode2, LockKeyhole, PanelRightClose } from 'lucide-react';
import type { ConfigSource } from '@/api/types';
import { Button } from '@/components/ui/button';

const ConfigSourceEditor = lazy(() => import('@/components/ConfigSourceEditor'));

export function AgentSourcePanel({ source, onBack, onCollapse, subject = 'agent' }: {
  source: ConfigSource;
  onBack: () => void;
  onCollapse?: () => void;
  subject?: 'agent' | 'mission';
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source.content);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={subject === 'mission' ? 'Close raw mission configuration' : 'Back to configuration details'}><ArrowLeft /></Button>
            <h2 className="text-xs font-semibold">Raw configuration</h2>
            {onCollapse && <Button className="ml-auto" variant="ghost" size="icon-sm" onClick={onCollapse} aria-label={`Collapse ${subject} configuration`}><PanelRightClose /></Button>}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">The exact {subject} block loaded by the runner.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-5 py-2.5">
          <p className="flex min-w-0 items-center gap-2 text-xs"><FileCode2 className="size-3.5 shrink-0 text-muted-foreground" /><span className="break-all">{source.path}</span><span className="shrink-0 text-[10px] text-muted-foreground">L{source.startLine}–{source.endLine}</span></p>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><LockKeyhole className="size-3" />Read-only · HCL</span>
            <Button variant="ghost" size="sm" onClick={() => void copySource()} aria-label="Copy raw configuration">{copyStatus === 'copied' ? <Check /> : <Copy />}{copyStatus === 'copied' ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<p role="status" className="p-5 text-xs text-muted-foreground">Loading editor…</p>}>
            <ConfigSourceEditor content={source.content} filename={source.path} startLine={source.startLine} />
          </Suspense>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-5 py-2.5 text-[10px] text-muted-foreground">
          <span>{copyStatus === 'failed' ? 'Clipboard unavailable. Select and copy the code directly.' : 'Select and copy · ⌘/Ctrl+F to find · Fold nested blocks'}</span>
          <span title={`SHA-256 of the loaded source file: ${source.fileRevision}`}>File snapshot {source.fileRevision.slice(0, 8)}</span>
        </div>
    </div>
  );
}
