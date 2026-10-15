import assert from 'node:assert/strict';
import test from 'node:test';
import { attemptTimelineStatus, isLiveRunStatus, timelineTaskStateLabel } from '../src/lib/runtime-timeline.ts';

test('only live runs can advertise pending work', () => {
  assert.equal(isLiveRunStatus('running'), true);
  assert.equal(isLiveRunStatus('waiting'), true);
  assert.equal(isLiveRunStatus('stopped'), false);
  assert.equal(isLiveRunStatus('failed'), false);
  assert.equal(timelineTaskStateLabel('waiting', 'stopped'), 'last checkpoint: waiting');
  assert.equal(timelineTaskStateLabel('retry_pending', 'failed'), 'last checkpoint: retry pending');
  assert.equal(timelineTaskStateLabel('waiting', 'waiting'), 'waiting');
});

test('distinguishes a live human-input wait from completed work', () => {
  assert.equal(attemptTimelineStatus(undefined, 'waiting', 'waiting'), 'waiting');
  assert.equal(attemptTimelineStatus(undefined, 'running', 'running'), 'running');
  assert.equal(attemptTimelineStatus('task.completed', 'completed', 'completed'), 'completed');
});

test('terminal run status overrides an active-looking last checkpoint', () => {
  assert.equal(attemptTimelineStatus(undefined, 'running', 'stopped'), 'stopped');
  assert.equal(attemptTimelineStatus(undefined, 'running', 'failed'), 'incomplete');
  assert.equal(attemptTimelineStatus(undefined, 'waiting', 'completed'), 'incomplete');
});

test('persisted attempt outcomes override current task and run state', () => {
  assert.equal(attemptTimelineStatus('task.attempt_failed', 'running', 'running'), 'failed');
  assert.equal(attemptTimelineStatus('task.failed', 'waiting', 'failed'), 'failed');
  assert.equal(attemptTimelineStatus('task.completed', 'running', 'stopped'), 'completed');
});
