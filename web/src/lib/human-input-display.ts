export type HumanInputState = 'open' | 'resolved' | 'expired' | 'canceled';

export function humanInputEmptyMessage(state: HumanInputState): string {
  if (state === 'open') return 'No requests are waiting.';
  if (state === 'resolved') return 'No answered requests yet.';
  if (state === 'expired') return 'No expired requests.';
  return 'No canceled requests.';
}

export function humanInputRequestedAge(requestedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(requestedAt)) / 1000));
  if (!Number.isFinite(seconds)) return 'at an unknown time';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function humanInputSubmitErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'already resolved') return 'This request was already answered. Refresh to see the recorded response.';
  if (message === 'expired') return 'This request expired before your response was sent.';
  if (message === 'canceled') return 'This request was canceled before your response was sent.';
  if (message === 'not found') return 'This request is no longer available.';
  if (message.includes('workspace access is required') || message.includes('mission Run permission is required')) return 'You do not have permission to answer this request.';
  return message || 'The response could not be submitted.';
}
