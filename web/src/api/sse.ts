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
