type TextMessage = { role: string; parts: Array<{ type: string; text?: string }> };

export type CommanderSnapshot = {
  ready: string[];
  completed: string[];
  stateCounts: Record<string, number>;
  results: Record<string, { Summary?: string }>;
};

export function parseCommanderSnapshot(message: TextMessage): CommanderSnapshot | null {
  if (message.role !== 'user' || message.parts.length !== 1 || message.parts[0].type !== 'text') return null;
  try {
    const value = asObject(JSON.parse(message.parts[0].text || ''));
    if (typeof value.run_id !== 'string' || !Array.isArray(value.ready_tasks)) return null;
    const tasks = asObject(value.tasks);
    const stateCounts: Record<string, number> = {};
    for (const [state, count] of Object.entries(asObject(value.task_state_counts))) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) stateCounts[state] = count;
    }
    const results: CommanderSnapshot['results'] = {};
    for (const [task, result] of Object.entries(asObject(value.results))) {
      const summary = asObject(result).Summary ?? asObject(result).summary;
      if (typeof summary === 'string') results[task] = { Summary: summary };
    }
    return {
      ready: value.ready_tasks.filter((name): name is string => typeof name === 'string'),
      completed: Object.entries(tasks).filter(([, task]) => {
        const state = asObject(task);
        return (state.State ?? state.state) === 'completed';
      }).map(([name]) => name),
      stateCounts,
      results,
    };
  } catch { return null; }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
