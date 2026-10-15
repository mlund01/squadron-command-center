import assert from 'node:assert/strict';
import test from 'node:test';
import { humanInputEmptyMessage, humanInputRequestedAge, humanInputSubmitErrorMessage } from '../src/lib/human-input-display.ts';

test('human input inbox distinguishes waiting, answered, and expired empty states', () => {
  assert.equal(humanInputEmptyMessage('open'), 'No requests are waiting.');
  assert.equal(humanInputEmptyMessage('resolved'), 'No answered requests yet.');
  assert.equal(humanInputEmptyMessage('expired'), 'No expired requests.');
});

test('stale or denied answers get an accurate explanation', () => {
  assert.match(humanInputSubmitErrorMessage(new Error('already resolved')), /already answered/);
  assert.match(humanInputSubmitErrorMessage(new Error('expired')), /expired/);
  assert.match(humanInputSubmitErrorMessage(new Error('not found')), /no longer available/);
  assert.match(humanInputSubmitErrorMessage(new Error('reader workspace access is required')), /do not have access/);
});

test('request age is legible, including malformed timestamps', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(humanInputRequestedAge('2026-10-14T11:59:55Z', now), '5s ago');
  assert.equal(humanInputRequestedAge('2026-10-14T11:55:00Z', now), '5m ago');
  assert.equal(humanInputRequestedAge('2026-10-14T10:00:00Z', now), '2h ago');
  assert.equal(humanInputRequestedAge('2026-10-12T12:00:00Z', now), '2d ago');
  assert.equal(humanInputRequestedAge('not-a-date', now), 'at an unknown time');
});
