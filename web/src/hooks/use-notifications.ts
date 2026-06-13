import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { getNotifications } from '@/api/client';
import type { NotificationItem } from '@/api/types';

const MAX_ITEMS = 100;

export interface UseNotificationsResult {
  notifications: NotificationItem[];
  unreadCount: number;
  markAllRead: () => void;
}

// useNotifications seeds the recent mission-lifecycle notifications from the
// REST buffer, then keeps them live via the /notifications/stream SSE
// endpoint. Each new arrival fires a toast and bumps the unread counter.
export function useNotifications(instanceId: string | undefined): UseNotificationsResult {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Reset state when the selected instance changes, using React's
  // "adjust state during render" pattern rather than a synchronous effect.
  const [prevInstance, setPrevInstance] = useState(instanceId);
  if (instanceId !== prevInstance) {
    setPrevInstance(instanceId);
    setNotifications([]);
    setUnreadCount(0);
  }

  useEffect(() => {
    if (!instanceId) return;

    let cancelled = false;
    getNotifications(instanceId)
      .then((res) => {
        if (cancelled) return;
        // Newest first for display.
        setNotifications((res.notifications ?? []).slice().reverse());
      })
      .catch(() => {
        /* leave the list empty on error */
      });

    const url = `/api/instances/${encodeURIComponent(instanceId)}/notifications/stream`;
    const es = new EventSource(url);

    const handle = (e: MessageEvent) => {
      const item = parseNotification(e);
      if (!item) return;
      setNotifications((prev) => [item, ...prev].slice(0, MAX_ITEMS));
      setUnreadCount((n) => n + 1);
      fireToast(item);
    };

    for (const ev of ['mission_completed', 'mission_failed', 'mission_stopped'] as const) {
      es.addEventListener(ev, handle);
    }
    es.onerror = () => {
      // EventSource auto-reconnects.
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [instanceId]);

  return {
    notifications,
    unreadCount,
    markAllRead: () => setUnreadCount(0),
  };
}

function parseNotification(e: MessageEvent): NotificationItem | null {
  try {
    return JSON.parse(e.data) as NotificationItem;
  } catch {
    return null;
  }
}

function fireToast(item: NotificationItem) {
  const title = item.title || item.missionName;
  if (item.event === 'mission_completed') {
    toast.success(title, { description: item.message });
  } else if (item.event === 'mission_failed') {
    toast.error(title, { description: item.error || item.message });
  } else {
    toast(title, { description: item.message });
  }
}
