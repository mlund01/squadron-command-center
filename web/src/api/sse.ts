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
    'commander_reasoning', 'commander_answer', 'commander_calling_tool', 'commander_tool_complete',
    'agent_started', 'agent_completed', 'agent_thinking', 'agent_calling_tool', 'agent_tool_complete', 'agent_answer',
    'compaction',
    'session_turn',
    'route_chosen',
  ];

  for (const type of eventTypes) {
    es.addEventListener(type, handleEvent);
  }

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      onComplete();
    } else {
      onError('Connection lost');
      es.close();
    }
  };

  return { close: () => es.close() };
}
