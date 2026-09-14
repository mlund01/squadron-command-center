import { useState } from 'react';
import { Bell, CheckCircle2, XCircle, StopCircle, Maximize2, X } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useNotifications } from '@/hooks/use-notifications';
import type { NotificationItem } from '@/api/types';
import { cn } from '@/lib/utils';

// NotificationsBell renders a bell with an unread badge and a dropdown of the
// most recent mission-lifecycle notifications. The dropdown can be expanded
// into a roomier modal.
export function NotificationsBell({ instanceId }: { instanceId: string | undefined }) {
  const { notifications, unreadCount, markAllRead, dismiss } = useNotifications(instanceId);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
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
          <div className="flex items-center justify-between pr-1">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Notifications
            </DropdownMenuLabel>
            {notifications.length > 0 && (
              <button
                type="button"
                aria-label="Expand notifications"
                title="Expand"
                onClick={() => setModalOpen(true)}
                className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Maximize2 className="size-3" />
              </button>
            )}
          </div>
          <DropdownMenuSeparator />
          {notifications.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">No notifications yet</div>
          ) : (
            notifications.map((n, i) => (
              <NotificationRow
                key={n.id || `${n.missionId}-${n.occurredAt}-${i}`}
                item={n}
                onDismiss={() => dismiss(n.id)}
              />
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>Recent mission-lifecycle notifications for this instance.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No notifications yet</div>
            ) : (
              notifications.map((n, i) => (
                <NotificationRow
                  key={`m-${n.id || `${n.missionId}-${n.occurredAt}-${i}`}`}
                  item={n}
                  roomy
                  onDismiss={() => dismiss(n.id)}
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NotificationRow({
  item,
  roomy = false,
  onDismiss,
}: {
  item: NotificationItem;
  roomy?: boolean;
  onDismiss?: () => void;
}) {
  const detail = item.error || item.message;

  return (
    <div className={cn('group rounded-sm hover:bg-sidebar-accent/25', roomy ? 'px-3 py-2' : 'px-2 py-1.5')}>
      <div className="flex items-start gap-2">
        <EventIcon event={item.event} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('truncate font-medium', roomy ? 'text-sm' : 'text-[12.5px]')}>
              {item.title || item.missionName}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
              {timeAgo(item.occurredAt)}
            </span>
            {onDismiss && (
              <button
                type="button"
                aria-label="Dismiss notification"
                title="Dismiss"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDismiss();
                }}
                className="shrink-0 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground hover:bg-accent group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          {detail && (
            <p
              className={cn(
                'mt-0.5 text-muted-foreground leading-snug',
                roomy ? 'text-xs' : 'text-[11px] line-clamp-2',
              )}
            >
              {detail}
            </p>
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
