import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSchedule } from '../src/lib/schedule-display.ts';

test('describes common schedules without exposing cron syntax', () => {
  assert.match(describeSchedule('0 9 * * 1-5'), /^Weekdays at /);
  assert.match(describeSchedule('0 9 * * *'), /^Daily at /);
  assert.equal(describeSchedule('15 * * * *'), 'Every hour at :15');
  assert.match(describeSchedule('0 9 * * 1'), /^Mondays at /);
});

test('uses a neutral label for custom schedules', () => {
  assert.equal(describeSchedule('*/5 * * * *'), 'Custom timing');
});
