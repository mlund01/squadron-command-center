import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronRight,
  Send,
  User,
  HelpCircle,
  Focus,
  Inbox,
  ChevronLeft,
  CheckCircle2,
  X,
  Info,
} from 'lucide-react';

import { resolveHumanInput } from '@/api/client';
import { useHumanInputs } from '@/hooks/use-human-inputs';
import type { HumanInputRequestDTO } from '@/api/types';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { formatResolvedResponse } from '@/components/HumanInputCard';
import { InlineStat, SearchBox } from '@/components/ui-shell';
import { formatTime, formatTimeAgo } from '@/lib/mission-utils';
import { cn, singleLine, truncate } from '@/lib/utils';

type StateFilter = 'open' | 'resolved';
type Mode = 'list' | 'focus';

// InboxPage has two modes — `list` (table triage, expand-in-place) and
// `focus` (carousel, oldest-first, auto-advance on resolve).
export function InboxPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const stateFilter: StateFilter = searchParams.get('view') === 'resolved' ? 'resolved' : 'open';
  const mode: Mode = searchParams.get('mode') === 'focus' ? 'focus' : 'list';

  const { humanInputs: rows, isLoading } = useHumanInputs({ instanceId: id, state: stateFilter });

  const setMode = (next: Mode) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'list') params.delete('mode');
    else params.set('mode', next);
    setSearchParams(params, { replace: true });
  };

  const switchView = (v: StateFilter) => {
    const next = new URLSearchParams(searchParams);
    if (v === 'open') next.delete('view');
    else next.set('view', v);
    // leaving focus mode when toggling history makes more sense
    next.delete('mode');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="px-8 py-7 w-full">
      <div className="flex items-end gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">Inbox</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            Questions from agents waiting on a human response
          </span>
        </div>

        <div className="flex-1" />

        {stateFilter === 'open' && rows.length > 0 && (
          <button
            type="button"
            onClick={() => setMode(mode === 'focus' ? 'list' : 'focus')}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-sm border font-mono text-[11px] cursor-pointer transition-colors',
              mode === 'focus'
                ? 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15'
                : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent/25',
            )}
            title={mode === 'focus' ? 'Exit focus mode' : 'Walk through each question, oldest first'}
          >
            <Focus className="h-3 w-3" />
            {mode === 'focus' ? 'exit focus' : 'focus mode'}
          </button>
        )}

        <div className="flex items-center gap-0 rounded-sm border border-border/60 overflow-hidden font-mono text-[11px]">
          <ViewTab active={stateFilter === 'open'} onClick={() => switchView('open')}>
            Open
          </ViewTab>
          <ViewTab active={stateFilter === 'resolved'} onClick={() => switchView('resolved')}>
            Resolved
          </ViewTab>
        </div>
      </div>

      {mode === 'focus' && stateFilter === 'open' ? (
        <FocusView instanceId={id!} rows={rows} onExit={() => setMode('list')} />
      ) : (
        <ListView
          instanceId={id!}
          rows={rows}
          stateFilter={stateFilter}
          isLoading={isLoading}
        />
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List view
// ─────────────────────────────────────────────────────────────────────────────

function ListView({
  instanceId,
  rows,
  stateFilter,
  isLoading,
}: {
  instanceId: string;
  rows: HumanInputRequestDTO[];
  stateFilter: StateFilter;
  isLoading: boolean;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.question.toLowerCase().includes(q) ||
        (r.shortSummary ?? '').toLowerCase().includes(q) ||
        (r.missionName ?? '').toLowerCase().includes(q) ||
        (r.taskName ?? '').toLowerCase().includes(q) ||
        (r.response ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const oldestOpen = useMemo(() => {
    const open = rows.filter((r) => r.state === 'open');
    if (open.length === 0) return null;
    return open.reduce((oldest, r) =>
      Date.parse(r.requestedAt) < Date.parse(oldest.requestedAt) ? r : oldest,
    );
  }, [rows]);

  return (
    <>
      <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
        <InlineStat
          k={stateFilter === 'open' ? 'open' : 'resolved'}
          v={rows.length}
          tone={rows.length > 0 && stateFilter === 'open' ? 'warn' : undefined}
        />
        {stateFilter === 'open' && oldestOpen && (
          <InlineStat k="oldest" v={formatTimeAgo(oldestOpen.requestedAt)} tone="warn" />
        )}

        <span className="flex-1" />

        <SearchBox value={search} onChange={setSearch} placeholder="Search questions" />
      </div>

      {isLoading && rows.length === 0 ? (
        <p className="text-muted-foreground text-sm mt-10 text-center">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState stateFilter={stateFilter} />
      ) : (
        <div className="rounded-sm border border-border/60 overflow-hidden bg-card">
          {visible.map((r, i) => (
            <InboxRow
              key={r.toolCallId}
              instanceId={instanceId}
              request={r}
              isExpanded={expanded === r.toolCallId}
              isLast={i === visible.length - 1}
              onToggle={() => setExpanded(expanded === r.toolCallId ? null : r.toolCallId)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus view (carousel)
// ─────────────────────────────────────────────────────────────────────────────

function FocusView({
  instanceId,
  rows,
  onExit,
}: {
  instanceId: string;
  rows: HumanInputRequestDTO[];
  onExit: () => void;
}) {
  // The list reorders / shrinks as questions resolve. We track the
  // current question by id rather than index so the focus stays on the
  // intended question even when earlier ones disappear.
  const open = useMemo(() => rows.filter((r) => r.state === 'open'), [rows]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Session-local counter of how many questions the operator answered
  // during this focus session. Resets when the session ends; doesn't
  // try to be authoritative across reloads.
  const [answeredThisSession, setAnsweredThisSession] = useState(0);

  // Initialize / re-anchor on the oldest open whenever the active id is
  // missing (first render, after a resolve, or after exiting+re-entering).
  useEffect(() => {
    if (activeId && open.some((r) => r.toolCallId === activeId)) return;
    setActiveId(open[0]?.toolCallId ?? null);
  }, [open, activeId]);

  const currentIndex = open.findIndex((r) => r.toolCallId === activeId);
  const current = currentIndex >= 0 ? open[currentIndex] : null;
  const next = currentIndex >= 0 ? open[currentIndex + 1] ?? null : null;
  const prev = currentIndex > 0 ? open[currentIndex - 1] : null;

  // Esc exits, ←/→ navigate, all without stealing focus from the reply
  // input (we ignore key events when typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inText = tag === 'input' || tag === 'textarea';
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
        return;
      }
      if (inText) return;
      if (e.key === 'ArrowLeft' && prev) {
        setActiveId(prev.toolCallId);
      } else if (e.key === 'ArrowRight' && next) {
        setActiveId(next.toolCallId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit, next, prev]);

  if (open.length === 0) {
    return (
      <div className="rounded-sm border border-border/60 bg-card py-16 text-center">
        <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500/80" />
        <p className="mt-3 text-sm">No more open questions.</p>
        <p className="font-mono text-[10.5px] text-muted-foreground/70 mt-1 tracking-[0.2px]">
          inbox zero · {answeredThisSession > 0 ? `${answeredThisSession} answered this session` : 'nice work'}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="mt-5 inline-flex items-center gap-1.5 px-3 py-[5px] rounded-sm border border-border/60 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/25 transition-colors cursor-pointer"
        >
          <Inbox className="h-3 w-3" />
          back to inbox
        </button>
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="space-y-4">
      <FocusToolbar
        remaining={open.length}
        answered={answeredThisSession}
        prev={prev}
        next={next}
        onPrev={() => prev && setActiveId(prev.toolCallId)}
        onNext={() => next && setActiveId(next.toolCallId)}
        onExit={onExit}
      />

      <FocusCard
        instanceId={instanceId}
        request={current}
        onResolved={() => {
          setAnsweredThisSession((n) => n + 1);
          // Hand off to the next open question. The list will refresh
          // via the polling hook + invalidation; the effect above
          // re-anchors if our activeId disappears.
          if (next) setActiveId(next.toolCallId);
          else setActiveId(null);
        }}
      />

      {next && <NextPeek request={next} />}

      <p className="font-mono text-[10px] text-muted-foreground/60 tracking-[0.2px] text-center">
        ← prev · → next · esc to exit
      </p>
    </div>
  );
}

function FocusToolbar({
  remaining,
  answered,
  prev,
  next,
  onPrev,
  onNext,
  onExit,
}: {
  remaining: number;
  answered: number;
  prev: HumanInputRequestDTO | null;
  next: HumanInputRequestDTO | null;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11.5px]">
      <span
        className="inline-flex items-baseline gap-1.5"
        title="Open questions remaining (live; updates as new questions arrive or get answered)"
      >
        <span className="relative inline-flex h-1.5 w-1.5 mr-1">
          <span className="absolute inset-0 rounded-full bg-amber-500" />
          <span className="absolute inset-0 rounded-full animate-ping opacity-60 bg-amber-500" />
        </span>
        <span className="tabular-nums text-[14px] font-semibold text-foreground">
          {remaining}
        </span>
        <span className="text-muted-foreground/70">remaining</span>
      </span>

      {answered > 0 && (
        <span className="text-muted-foreground/60">
          · <span className="tabular-nums">{answered}</span> answered
        </span>
      )}

      <span className="flex-1" />

      <div className="flex items-center gap-1">
        <FocusBtn onClick={onPrev} disabled={!prev} title="Previous (←)">
          <ChevronLeft className="h-3.5 w-3.5" />
        </FocusBtn>
        <FocusBtn onClick={onNext} disabled={!next} title="Next (→)">
          <ChevronRight className="h-3.5 w-3.5" />
        </FocusBtn>
        <FocusBtn onClick={onExit} title="Exit focus mode (esc)">
          <X className="h-3.5 w-3.5" />
        </FocusBtn>
      </div>
    </div>
  );
}

function FocusBtn({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center h-7 w-7 rounded-sm border border-border/60 cursor-pointer transition-colors',
        'text-muted-foreground hover:text-foreground hover:bg-accent/30',
        'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}

function FocusCard({
  instanceId,
  request,
  onResolved,
}: {
  instanceId: string;
  request: HumanInputRequestDTO;
  onResolved: () => void;
}) {
  const ageMs = Date.now() - Date.parse(request.requestedAt);

  return (
    <div className="rounded-sm border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-accent/10 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <OpenDot ageMs={ageMs} />
          {request.missionId && (
            <Link
              to={`/instances/${instanceId}/runs/${request.missionId}`}
              className="inline-flex items-center gap-1 px-2 py-[2px] rounded-sm border border-border/60 bg-background font-mono text-[11px] text-foreground/90 hover:bg-accent/40 hover:border-border transition-colors min-w-0"
              title={request.missionName ? `mission ${request.missionName}` : `mission ${request.missionId}`}
            >
              <span className="truncate max-w-[180px]">
                {request.missionName || request.missionId.slice(0, 8)}
              </span>
              {(request.taskName || request.taskId) && (
                <>
                  <span className="text-muted-foreground/40 shrink-0">›</span>
                  <span className="truncate max-w-[160px] text-muted-foreground">
                    {request.taskName || request.taskId?.slice(0, 8)}
                  </span>
                </>
              )}
            </Link>
          )}
        </div>
        <div
          className="font-mono text-[11px] text-muted-foreground tabular-nums"
          title={formatTime(request.requestedAt)}
        >
          asked {formatTimeAgo(request.requestedAt)}
        </div>
      </div>

      <div className="px-5 pt-5 pb-4">
        {request.shortSummary && (
          <h2 className="text-[17px] font-semibold tracking-tight leading-snug mb-2">
            {request.shortSummary}
          </h2>
        )}
        <div className="text-[14px] leading-relaxed max-w-3xl">
          <MarkdownPreview content={request.question} />
        </div>
        {request.additionalContext && <ContextBlock content={request.additionalContext} />}
      </div>

      <div className="px-5 pb-5">
        <ReplyForm
          instanceId={instanceId}
          request={request}
          autoFocusInput
          onResolved={onResolved}
        />
      </div>
    </div>
  );
}

function NextPeek({ request }: { request: HumanInputRequestDTO }) {
  const label = request.shortSummary || singleLine(request.question);
  return (
    <div className="rounded-sm border border-dashed border-border/50 bg-card/60 px-4 py-2.5 flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 shrink-0">
        next
      </span>
      <span className="text-[12.5px] text-muted-foreground truncate min-w-0 flex-1">
        {truncate(label, 120)}
      </span>
      {request.choices && request.choices.length > 0 && (
        <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
          {request.choices.length} choice{request.choices.length === 1 ? '' : 's'}
        </span>
      )}
      <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state for the list view
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ stateFilter }: { stateFilter: StateFilter }) {
  return (
    <div className="rounded-sm border border-dashed border-border/60 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        {stateFilter === 'open'
          ? 'No open questions.'
          : 'No resolved questions yet.'}
      </p>
      <p className="font-mono text-[10.5px] text-muted-foreground/60 mt-2 tracking-[0.2px]">
        agents reach here by calling builtins.human.ask
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

function InboxRow({
  instanceId,
  request,
  isExpanded,
  isLast,
  onToggle,
}: {
  instanceId: string;
  request: HumanInputRequestDTO;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  const isResolved = request.state === 'resolved';
  const preview = truncate(request.shortSummary || singleLine(request.question), 160);
  const ageLabel = formatTimeAgo(request.requestedAt);
  const ageMs = Date.now() - Date.parse(request.requestedAt);

  return (
    <div className={cn('border-border/40', !isLast && 'border-b')}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full grid grid-cols-[20px_minmax(0,1fr)_minmax(0,220px)_80px] items-center gap-3 px-3 py-2.5 text-left',
          'hover:bg-accent/20 transition-colors cursor-pointer',
          isResolved && 'opacity-70',
        )}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 text-muted-foreground/60 transition-transform',
            isExpanded && 'rotate-90',
          )}
        />

        <div className="min-w-0 flex items-center gap-2">
          {!isResolved && <OpenDot ageMs={ageMs} />}
          <span className={cn('text-[13px] truncate', isResolved ? 'text-muted-foreground' : 'text-foreground')}>
            {preview}
          </span>
          {!isResolved && request.choices && request.choices.length > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
              {request.choices.length} choice{request.choices.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <MissionTaskTag instanceId={instanceId} request={request} />

        <div
          className="font-mono text-[11px] text-muted-foreground tabular-nums text-right"
          title={formatTime(request.requestedAt)}
        >
          {ageLabel}
        </div>
      </button>

      {isExpanded && <ExpandedPanel instanceId={instanceId} request={request} />}
    </div>
  );
}

function MissionTaskTag({
  instanceId,
  request,
}: {
  instanceId: string;
  request: HumanInputRequestDTO;
}) {
  if (!request.missionId) {
    return <span className="text-muted-foreground/40 font-mono text-[11px] truncate">—</span>;
  }
  const missionLabel = request.missionName || request.missionId.slice(0, 8);
  const taskLabel = request.taskName || (request.taskId ? request.taskId.slice(0, 8) : '');

  return (
    <div className="min-w-0 flex items-center justify-end gap-1.5 font-mono text-[11px] tabular-nums">
      <Link
        to={`/instances/${instanceId}/runs/${request.missionId}`}
        onClick={(e) => e.stopPropagation()}
        title={request.missionName ? `mission ${request.missionName}` : `mission ${request.missionId}`}
        className={cn(
          'min-w-0 max-w-full truncate px-1.5 py-[1px] rounded-sm',
          'border border-border/60 bg-accent/15 text-foreground/90',
          'hover:bg-accent/30 hover:border-border transition-colors',
        )}
      >
        {missionLabel}
      </Link>
      {taskLabel && (
        <>
          <span className="text-muted-foreground/40 shrink-0">›</span>
          <span
            className="min-w-0 max-w-[60%] truncate text-muted-foreground"
            title={request.taskName ? `task ${request.taskName}` : `task ${request.taskId}`}
          >
            {taskLabel}
          </span>
        </>
      )}
    </div>
  );
}

// OpenDot fades from blue to amber once a question has been waiting a
// while — a soft visual nudge without using a full "stale" badge.
function OpenDot({ ageMs }: { ageMs: number }) {
  const stale = ageMs > 5 * 60 * 1000;
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span className={cn('absolute inset-0 rounded-full', stale ? 'bg-amber-500' : 'bg-blue-500')} />
      <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', stale ? 'bg-amber-500' : 'bg-blue-500')} />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Expanded panel (full question + reply widget / resolved summary)
// ─────────────────────────────────────────────────────────────────────────────

function ExpandedPanel({
  instanceId,
  request,
}: {
  instanceId: string;
  request: HumanInputRequestDTO;
}) {
  const isResolved = request.state === 'resolved';

  return (
    <div className="px-9 pb-4 pt-1 bg-accent/5 border-t border-border/30">
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div className="min-w-0 max-w-3xl">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
            <HelpCircle className="h-3 w-3" />
            question
          </div>
          <div className="text-[13px] leading-relaxed">
            <MarkdownPreview content={request.question} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 font-mono text-[10px] text-muted-foreground/70 tracking-[0.2px] min-w-[160px]">
          {request.missionId && (
            <Link
              to={`/instances/${instanceId}/runs/${request.missionId}`}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-[2px] rounded-sm',
                'border border-border/60 bg-accent/20 text-foreground/90 text-[11px]',
                'hover:bg-accent/40 hover:border-border transition-colors',
              )}
            >
              {request.missionName || request.missionId.slice(0, 8)}
              {(request.taskName || request.taskId) && (
                <>
                  <span className="text-muted-foreground/40">›</span>
                  <span className="text-muted-foreground">
                    {request.taskName || request.taskId?.slice(0, 8)}
                  </span>
                </>
              )}
            </Link>
          )}
          <div>
            <span className="text-muted-foreground/50">asked</span>{' '}
            <span className="text-muted-foreground">{formatTime(request.requestedAt)}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">id</span>{' '}
            <span className="text-muted-foreground">{request.toolCallId.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {request.additionalContext && (
        <div className="mt-3 max-w-3xl">
          <ContextBlock content={request.additionalContext} />
        </div>
      )}

      {isResolved ? (
        <ResolvedSummary request={request} />
      ) : (
        <div className="mt-4 max-w-3xl">
          <ReplyForm instanceId={instanceId} request={request} />
        </div>
      )}
    </div>
  );
}

// ContextBlock renders the agent-supplied background that explains why
// the operator is being asked. Visually subdued vs. the question — a
// muted left border + Info caption — so the question stays the focal
// point of the surface.
function ContextBlock({ content }: { content: string }) {
  return (
    <div className="mt-3 rounded-sm border border-border/40 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
        <Info className="h-3 w-3" />
        context
      </div>
      <div className="text-[12px] leading-relaxed text-muted-foreground italic prose-sm">
        <MarkdownPreview content={content} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReplyForm — shared between list-expanded and focus-card surfaces
// ─────────────────────────────────────────────────────────────────────────────

function ReplyForm({
  instanceId,
  request,
  autoFocusInput,
  onResolved,
}: {
  instanceId: string;
  request: HumanInputRequestDTO;
  autoFocusInput?: boolean;
  onResolved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Selected choices for multi-select questions. The Set is rebuilt
  // when the underlying question changes so two questions in a row
  // don't share state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isMulti = !!request.multiSelect && (request.choices?.length ?? 0) > 0;

  // Reset local state when the underlying question changes (carousel
  // mode advances by remounting the form? — actually it keeps the same
  // ReplyForm because parent uses key=toolCallId via FocusCard's chain;
  // we still defensively clear on id change here).
  useEffect(() => {
    setOtherOpen(false);
    setOtherText('');
    setSubmitting(false);
    setSelected(new Set());
  }, [request.toolCallId]);

  // In carousel mode we get autofocus on mount. Auto-focus the input
  // only when the form is already showing free-text (no choices, or
  // the user toggled "other").
  useEffect(() => {
    if (!autoFocusInput) return;
    if ((request.choices?.length ?? 0) > 0 && !otherOpen) return;
    inputRef.current?.focus();
  }, [autoFocusInput, otherOpen, request.choices]);

  const submit = async (response: string) => {
    if (submitting || !response.trim()) return;
    setSubmitting(true);
    try {
      await resolveHumanInput(instanceId, request.toolCallId, response);
      queryClient.invalidateQueries({ queryKey: ['humanInputs'] });
      onResolved?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submit failed';
      toast.error('Could not submit response', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-sm border border-primary/25 bg-primary/[0.04] overflow-hidden">
      <div className="px-3 py-1.5 bg-primary/5 border-b border-primary/20 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-primary/80">
        <Send className="h-3 w-3" />
        your reply
      </div>

      <div className="p-3 space-y-2.5">
        {request.choices && request.choices.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {request.choices.map((c) => {
              const isSelected = selected.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    if (isMulti) {
                      // Toggle membership; submit happens via the
                      // explicit Send button so the operator can pick
                      // multiple before committing.
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
                  className={cn(
                    'font-mono text-[11.5px] px-3 py-[6px] rounded-sm border bg-background',
                    'transition-colors cursor-pointer',
                    'hover:bg-primary/10 hover:border-primary/50 hover:text-primary',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    isMulti && isSelected
                      ? 'border-primary/70 bg-primary/15 text-primary'
                      : 'border-border/60',
                  )}
                >
                  {isMulti && (
                    <span
                      aria-hidden
                      className={cn(
                        'inline-block w-3 mr-1 text-center',
                        isSelected ? 'text-primary' : 'text-muted-foreground/50',
                      )}
                    >
                      {isSelected ? '✓' : '○'}
                    </span>
                  )}
                  {c}
                </button>
              );
            })}
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOtherOpen((v) => !v)}
              className={cn(
                'font-mono text-[11.5px] px-3 py-[6px] rounded-sm',
                'text-muted-foreground hover:text-foreground transition-colors cursor-pointer',
                otherOpen && 'text-foreground underline decoration-dotted underline-offset-[3px]',
              )}
            >
              other…
            </button>
            {isMulti && (
              <button
                type="button"
                disabled={submitting || selected.size === 0}
                onClick={() => submit(JSON.stringify(Array.from(selected)))}
                className={cn(
                  'font-mono text-[11px] uppercase tracking-wider px-3 py-[6px] rounded-sm',
                  'flex items-center gap-1.5 transition-colors cursor-pointer',
                  'bg-primary/15 text-primary hover:bg-primary/25 border border-primary/40',
                  'disabled:bg-transparent disabled:text-muted-foreground/50 disabled:border-border/50 disabled:cursor-not-allowed',
                )}
              >
                <Send className="h-3 w-3" />
                send {selected.size > 0 && `(${selected.size})`}
              </button>
            )}
          </div>
        )}

        {(otherOpen || !request.choices || request.choices.length === 0) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(otherText);
            }}
            className={cn(
              'flex items-stretch rounded-sm border border-border/60 bg-background overflow-hidden',
              'transition-colors',
              'focus-within:border-primary/60',
            )}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder="Type a reply…"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              disabled={submitting}
              className={cn(
                'flex-1 min-w-0 px-3 py-2 bg-transparent outline-none',
                'text-[13px] placeholder:text-muted-foreground/60',
              )}
            />
            <button
              type="submit"
              disabled={submitting || !otherText.trim()}
              className={cn(
                'px-3.5 border-l border-border/60 cursor-pointer',
                'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary',
                'disabled:bg-transparent disabled:text-muted-foreground/50 disabled:cursor-not-allowed',
                'transition-colors flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider',
              )}
            >
              <Send className="h-3 w-3" />
              send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ResolvedSummary({ request }: { request: HumanInputRequestDTO }) {
  return (
    <div className="mt-4 max-w-3xl">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
        <Send className="h-3 w-3" />
        response
      </div>
      <div className="text-[13px] whitespace-pre-wrap">{formatResolvedResponse(request)}</div>
      {(request.responderUserId || request.resolvedAt) && (
        <div className="flex items-center gap-2 mt-2 font-mono text-[10.5px] text-muted-foreground/80 tracking-[0.2px]">
          {request.responderUserId && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {request.responderUserId}
            </span>
          )}
          {request.resolvedAt && (
            <span className="text-muted-foreground/60">
              · {formatTimeAgo(request.resolvedAt)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-[5px] transition-colors cursor-pointer',
        active
          ? 'bg-accent text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/25',
      )}
    >
      {children}
    </button>
  );
}


