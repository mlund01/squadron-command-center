import type { ChatEvent } from './types';

export interface ChatEventSource {
  close: () => void;
}

export function subscribeChatEvents(
  instanceId: string,
  sessionId: string,
  onEvent: (event: ChatEvent) => void,
  onComplete: () => void,
  onError: (error: string) => void,
): ChatEventSource {
  const url = `/api/instances/${instanceId}/chat/${sessionId}/events`;
  const es = new EventSource(url);

  const handleEvent = (e: MessageEvent) => {
    try {
      const event: ChatEvent = JSON.parse(e.data);
      onEvent(event);

      if (event.eventType === 'turn_complete' || event.eventType === 'error') {
        es.close();
        onComplete();
      }
    } catch {
      // Skip malformed events
    }
  };

  const eventTypes = [
    'thinking', 'reasoning_chunk', 'reasoning_done',
    'answer_chunk', 'answer_done',
    'calling_tool', 'tool_complete',
    'turn_complete', 'error',
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
