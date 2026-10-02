import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommanderSnapshot } from '../src/lib/commander-snapshot.ts';

test('reads the current bounded commander state projection', () => {
  const snapshot = parseCommanderSnapshot({ role: 'user', parts: [{ type: 'text', text: JSON.stringify({
    run_id: 'run-1', ready_tasks: ['review'], task_state_counts: { completed: 2, ready: 1 },
    results: { draft: { Status: 'success', Summary: 'Draft is complete.' } },
  }) }] });
  assert.deepEqual(snapshot, {
    ready: ['review'], completed: [], stateCounts: { completed: 2, ready: 1 },
    results: { draft: { Summary: 'Draft is complete.' } },
  });
});

test('keeps historical full-state snapshots readable', () => {
  const snapshot = parseCommanderSnapshot({ role: 'user', parts: [{ type: 'text', text: JSON.stringify({
    run_id: 'old-run', ready_tasks: [], tasks: { draft: { State: 'completed' } },
    results: { draft: { summary: 'Draft is complete.' } },
  }) }] });
  assert.deepEqual(snapshot, {
    ready: [], completed: ['draft'], stateCounts: {},
    results: { draft: { Summary: 'Draft is complete.' } },
  });
});

test('does not mistake other messages for commander state', () => {
  assert.equal(parseCommanderSnapshot({ role: 'assistant', parts: [{ type: 'text', text: '{}' }] }), null);
  assert.equal(parseCommanderSnapshot({ role: 'user', parts: [{ type: 'text', text: '{invalid' }] }), null);
  assert.equal(parseCommanderSnapshot({ role: 'user', parts: [{ type: 'text', text: '{"run_id":"run"}' }] }), null);
});
