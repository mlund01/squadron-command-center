export type AttemptTimelineStatus = 'completed' | 'failed' | 'running' | 'waiting' | 'stopped' | 'incomplete';

export function isLiveRunStatus(status: string): boolean {
  return status === 'running' || status === 'waiting';
}

export function timelineTaskStateLabel(taskState: string, runStatus: string): string {
  const state = taskState.replaceAll('_', ' ');
  return !isLiveRunStatus(runStatus) && ['running', 'dispatching', 'waiting', 'retry_pending'].includes(taskState)
    ? `last checkpoint: ${state}` : state;
}

// The persisted run status is authoritative when a terminal run still has an
// active-looking checkpoint. Never animate that historical attempt as live.
export function attemptTimelineStatus(terminalEventType: string | undefined, taskState: string, runStatus: string): AttemptTimelineStatus {
  if (terminalEventType === 'task.attempt_failed' || terminalEventType === 'task.failed') return 'failed';
  if (terminalEventType === 'task.completed') return 'completed';
  if (taskState === 'completed') return 'completed';
  if (taskState === 'failed') return 'failed';
  if (runStatus === 'stopped') return 'stopped';
  if (!isLiveRunStatus(runStatus)) return 'incomplete';
  if (taskState === 'waiting') return 'waiting';
  if (taskState === 'running' || taskState === 'dispatching') return 'running';
  return 'incomplete';
}
