import { useEffect } from 'react';
import { toast } from 'sonner';
import { subscribeInstanceNotifications, type InstanceNotification } from '@/api/sse';

// useInstanceNotifications subscribes to per-instance notifications and
// surfaces them as toasts. Currently handles OAuth-proxy completion events;
// extend the switch as new notification types are added.
export function useInstanceNotifications(instanceId: string | undefined) {
  useEffect(() => {
    if (!instanceId) return;
    const sub = subscribeInstanceNotifications(instanceId, (note) => {
      handleNotification(note);
    });
    return () => sub.close();
  }, [instanceId]);
}

function handleNotification(note: InstanceNotification) {
  switch (note.type) {
    case 'oauth_completed': {
      const name = (note.data?.mcpName as string | undefined) ?? 'MCP server';
      toast.success(`${name} connected`);
      break;
    }
    case 'oauth_failed': {
      const name = (note.data?.mcpName as string | undefined) ?? 'MCP server';
      const err = (note.data?.error as string | undefined) ?? 'authorization failed';
      toast.error(`${name}: ${err}`);
      break;
    }
    default:
      // Unknown notification types are silently ignored so the backend can
      // roll out new types without a simultaneous UI release.
      break;
  }
}
