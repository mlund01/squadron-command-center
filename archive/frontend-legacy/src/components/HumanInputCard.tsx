import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { resolveHumanInput } from '@/api/client';
import type { HumanInputRequestDTO } from '@/api/types';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/mission-utils';

// HumanInputCard renders a single pending (or resolved) ask_human request
// and offers a reply widget: quick-reply buttons for each choice plus an
// always-available "Other" text input. Used both in the Inbox list and in
// the MissionInstanceDetail inline surface.
export interface HumanInputCardProps {
  instanceId: string;
  request: HumanInputRequestDTO;
  subtitle?: React.ReactNode;
  compact?: boolean;
  onResolved?: (req: HumanInputRequestDTO) => void;
}

export function HumanInputCard({ instanceId, request, subtitle, compact, onResolved }: HumanInputCardProps) {
  const queryClient = useQueryClient();
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isResolved = request.state === 'resolved';
  const isMulti = !!request.multiSelect && (request.choices?.length ?? 0) > 0;

  // Reset selection when the underlying question changes (the same
  // card slot can be reused across questions in some surfaces).
  useEffect(() => {
    setSelected(new Set());
    setOtherOpen(false);
    setOtherText('');
  }, [request.toolCallId]);

  const submit = async (response: string) => {
    if (submitting || !response.trim()) return;
    setSubmitting(true);
    try {
      const res = await resolveHumanInput(instanceId, request.toolCallId, response);
      onResolved?.(res.humanInput);
      queryClient.invalidateQueries({ queryKey: ['humanInputs'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submit failed';
      toast.error('Could not submit response', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-md border bg-card text-card-foreground',
        compact ? 'p-3' : 'p-4',
        isResolved && 'opacity-75',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {subtitle && (
            <div className="mb-1 text-[11px] text-muted-foreground truncate">{subtitle}</div>
          )}
          <div className="text-sm">
            <MarkdownPreview content={request.question} />
          </div>
          {request.additionalContext && (
            <div className="mt-3 rounded-sm border border-border/40 bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                <Info className="h-3 w-3" />
                context
              </div>
              <div className="text-[12px] leading-relaxed text-muted-foreground italic prose-sm">
                <MarkdownPreview content={request.additionalContext} />
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={isResolved ? 'secondary' : 'default'}>{isResolved ? 'resolved' : 'open'}</Badge>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {formatTimeAgo(request.requestedAt)}
          </span>
        </div>
      </div>

      {isResolved ? (
        <ResolvedSummary request={request} />
      ) : (
        <div className="mt-3 space-y-2">
          {request.choices && request.choices.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {request.choices.map((c) => {
                const isSelected = selected.has(c);
                return (
                  <Button
                    key={c}
                    size="sm"
                    variant={isMulti && isSelected ? 'default' : 'outline'}
                    disabled={submitting}
                    onClick={() => {
                      if (isMulti) {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(c)) next.delete(c);
                          else next.add(c);
                          return next;
                        });
                      } else {
                        submit(c);
                      }
                    }}
                    aria-pressed={isMulti ? isSelected : undefined}
                    className="cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isMulti && (
                      <span aria-hidden className="mr-1 opacity-70">
                        {isSelected ? '✓' : '○'}
                      </span>
                    )}
                    {c}
                  </Button>
                );
              })}
              <Button
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => setOtherOpen((v) => !v)}
                className="cursor-pointer disabled:cursor-not-allowed"
              >
                Other…
              </Button>
              {isMulti && (
                <Button
                  size="sm"
                  disabled={submitting || selected.size === 0}
                  onClick={() => submit(JSON.stringify(Array.from(selected)))}
                  className="cursor-pointer disabled:cursor-not-allowed"
                >
                  Send {selected.size > 0 && `(${selected.size})`}
                </Button>
              )}
            </div>
          )}
          {(otherOpen || !request.choices || request.choices.length === 0) && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit(otherText);
              }}
            >
              <Input
                autoFocus
                placeholder="Type a reply…"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                disabled={submitting}
              />
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !otherText.trim()}
                className="cursor-pointer disabled:cursor-not-allowed"
              >
                Send
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function ResolvedSummary({ request }: { request: HumanInputRequestDTO }) {
  return (
    <div className="mt-2 space-y-1">
      <div className="text-xs text-muted-foreground">Response</div>
      <div className="text-sm whitespace-pre-wrap">{formatResolvedResponse(request)}</div>
      {request.responderUserId && (
        <div className="text-[11px] text-muted-foreground">
          by <span className="font-mono">{request.responderUserId}</span>
          {request.resolvedAt && <> · {formatTimeAgo(request.resolvedAt)}</>}
        </div>
      )}
    </div>
  );
}

// formatResolvedResponse renders a multi-select response as a friendly
// comma list (e.g. `A, C`) rather than raw JSON. Single-select / free-
// text responses are returned as-is. If parsing fails we fall back to
// the literal string.
export function formatResolvedResponse(request: HumanInputRequestDTO): string {
  if (!request.multiSelect || !request.response) return request.response ?? '';
  try {
    const parsed = JSON.parse(request.response);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed.join(', ');
    }
  } catch {
    // fall through to raw
  }
  return request.response;
}

