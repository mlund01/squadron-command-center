import { useState } from 'react';
import { Bell, CheckCircle2, XCircle, StopCircle, ChevronRight } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useNotifications } from '@/hooks/use-notifications';
import type { NotificationItem } from '@/api/types';
import { cn } from '@/lib/utils';

// NotificationsBell renders a bell with an unread badge and a dropdown of the
// most recent mission-lifecycle notifications. Completed-mission entries are
// expandable to reveal their outputs.
export function NotificationsBell({ instanceId }: { instanceId: string | undefined }) {
  const { notifications, unreadCount, markAllRead } = useNotifications(instanceId);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) markAllRead();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/25 transition-colors"
        >
          <Bell className="size-3.5" strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-1 rounded-full bg-primary text-primary-foreground font-mono text-[9px] leading-[14px] text-center tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-80 max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Notifications
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">No notifications yet</div>
        ) : (
          notifications.map((n, i) => <NotificationRow key={`${n.missionId}-${n.occurredAt}-${i}`} item={n} />)
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasOutputs = item.event === 'mission_completed' && item.outputs != null;
  const detail = item.error || item.message;

  return (
    <div className="px-2 py-1.5 rounded-sm hover:bg-sidebar-accent/25">
      <div className="flex items-start gap-2">
        <EventIcon event={item.event} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium">{item.title || item.missionName}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
              {timeAgo(item.occurredAt)}
            </span>
          </div>
          {detail && <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-snug">{detail}</p>}
          {hasOutputs && (
            <>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
                Outputs
              </button>
              {expanded && (
                <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-muted/50 p-2 font-mono text-[10.5px] leading-snug whitespace-pre-wrap break-all">
                  {JSON.stringify(item.outputs, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EventIcon({ event }: { event: NotificationItem['event'] }) {
  if (event === 'mission_completed') return <CheckCircle2 className="size-3.5 shrink-0 mt-0.5 text-green-500" />;
  if (event === 'mission_failed') return <XCircle className="size-3.5 shrink-0 mt-0.5 text-destructive" />;
  return <StopCircle className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
