import type { MissionEvent } from './types';

export interface MissionEventSource {
  close: () => void;
}

export function subscribeMissionEvents(
  instanceId: string,
  missionId: string,
  onEvent: (event: MissionEvent) => void,
  onComplete: () => void,
  onError: (error: string) => void,
): MissionEventSource {
  const url = `/api/instances/${instanceId}/missions/${missionId}/events`;
  const es = new EventSource(url);

  const handleEvent = (e: MessageEvent) => {
    try {
      const event: MissionEvent = JSON.parse(e.data);
      onEvent(event);

      if (event.eventType === 'mission_completed' || event.eventType === 'mission_failed') {
        es.close();
        onComplete();
      }
    } catch {
      // Skip malformed events
    }
  };

  // Listen for all event types we care about
  const eventTypes = [
    'mission_started', 'mission_completed', 'mission_failed', 'mission_stopped', 'mission_resumed',
    'task_started', 'task_completed', 'task_failed',
    'task_iteration_started', 'task_iteration_completed',
    'iteration_started', 'iteration_completed', 'iteration_failed', 'iteration_retrying',
    'commander_reasoning_started', 'commander_reasoning_completed', 'commander_answer', 'commander_calling_tool', 'commander_tool_complete',
    'agent_started', 'agent_completed', 'agent_reasoning_started', 'agent_reasoning_completed', 'agent_calling_tool', 'agent_tool_complete', 'agent_answer', 'agent_ask_commander', 'agent_commander_response',
    'compaction',
    'session_turn',
    'route_chosen',
  ];

  for (const type of eventTypes) {
    es.addEventListener(type, handleEvent);
  }

  es.onerror = async () => {
    if (es.readyState === EventSource.CLOSED) {
      onComplete();
    } else {
      es.close();
      // EventSource doesn't expose HTTP status — probe the session to detect 401.
      const res = await fetch('/auth/me').catch(() => null);
      if (res && res.status === 401) {
        const next = window.location.pathname + window.location.search;
        window.location.href = '/auth/login?next=' + encodeURIComponent(next);
        return;
      }
      onError('Connection lost');
    }
  };

  return { close: () => es.close() };
}

export interface InstanceNotification {
  type: string; // "oauth_completed" | "oauth_failed" | (future)
  timestamp?: string;
  data?: Record<string, unknown>;
}

export interface InstanceNotificationSource {
  close: () => void;
}

// subscribeInstanceNotifications opens an SSE stream for per-instance
// notifications (OAuth completions, future alert types). Unlike mission
// event streams, notifications are ephemeral — subscribers that aren't
// listening when an event fires will miss it.
export function subscribeInstanceNotifications(
  instanceId: string,
  onNotification: (note: InstanceNotification) => void,
): InstanceNotificationSource {
  const url = `/api/instances/${instanceId}/notifications`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    try {
      const note: InstanceNotification = JSON.parse(e.data);
      onNotification(note);
    } catch {
      // Skip malformed events
    }
  };

  es.onerror = () => {
    // Notifications are best-effort; no redirect-on-401 here.
    if (es.readyState === EventSource.CLOSED) {
      return;
    }
  };

  return { close: () => es.close() };
}
