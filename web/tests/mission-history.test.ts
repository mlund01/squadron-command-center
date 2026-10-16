import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMissionHistory } from '../src/lib/mission-history.ts';

test('empty Go history slices do not crash run-page polling', () => {
  assert.deepEqual(normalizeMissionHistory({ missions: null, total: 0 }), { missions: [], total: 0 });
});

test('persisted mission records are preserved', () => {
  const run = { id: 'run-1', name: 'example', status: 'running', startedAt: '2026-10-15T00:00:00Z' };
  assert.deepEqual(normalizeMissionHistory({ missions: [run], total: 1 }), { missions: [run], total: 1 });
});
