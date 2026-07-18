import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  combineDateAndTime,
  elapsedWorkingDays,
  toDateInputValue,
  toDateOnly,
  toTimeInputValue,
} from './time.ts';

describe('toDateOnly', () => {
  it('strips a time-of-day, leaves a bare date unchanged', () => {
    assert.equal(toDateOnly('2026-07-08T14:30'), '2026-07-08');
    assert.equal(toDateOnly('2026-07-08'), '2026-07-08');
  });
});

describe('toDateInputValue', () => {
  it('strips a time-of-day, passes a bare date through, null → empty', () => {
    assert.equal(toDateInputValue('2026-07-08T14:30'), '2026-07-08');
    assert.equal(toDateInputValue('2026-07-08'), '2026-07-08');
    assert.equal(toDateInputValue(null), '');
  });
});

describe('toTimeInputValue', () => {
  it('extracts the time-of-day, empty for a bare date or unset', () => {
    assert.equal(toTimeInputValue('2026-07-08T14:30'), '14:30');
    assert.equal(toTimeInputValue('2026-07-08'), '');
    assert.equal(toTimeInputValue(null), '');
  });
});

describe('combineDateAndTime', () => {
  it('combines into a datetime-local string when time is set', () => {
    assert.equal(combineDateAndTime('2026-07-08', '14:30'), '2026-07-08T14:30');
  });

  it('stays a bare date when time is empty', () => {
    assert.equal(combineDateAndTime('2026-07-08', ''), '2026-07-08');
  });

  it('is null when date is empty, regardless of time', () => {
    assert.equal(combineDateAndTime('', ''), null);
    assert.equal(combineDateAndTime('', '14:30'), null);
  });
});

describe('elapsedWorkingDays', () => {
  it('a same-day span with no weekend is a fraction of a day', () => {
    assert.equal(elapsedWorkingDays('2026-07-08T09:00', '2026-07-08T17:00'), 8 / 24);
  });

  it('a bare-date one-day span (Wed→Thu) is exactly 1 day, not 2', () => {
    assert.equal(elapsedWorkingDays('2026-07-08', '2026-07-09'), 1);
  });

  it('a bare-date same-day span is 0 — no time entered, no elapsed time', () => {
    assert.equal(elapsedWorkingDays('2026-07-08', '2026-07-08'), 0);
  });

  it('subtracts a fully-contained weekend', () => {
    // Fri 00:00 → next Mon 00:00: 3 calendar days, Sat+Sun removed → 1 day.
    assert.equal(elapsedWorkingDays('2026-07-10', '2026-07-13'), 1);
  });

  it('subtracts only the weekend portion that overlaps the span', () => {
    // Sat 12:00 → Sun 12:00: entirely inside the weekend → 0 elapsed.
    assert.equal(elapsedWorkingDays('2026-07-11T12:00', '2026-07-12T12:00'), 0);
    // Fri 12:00 → Mon 12:00: 3 days elapsed, minus 2 full weekend days → 1 day.
    assert.equal(elapsedWorkingDays('2026-07-10T12:00', '2026-07-13T12:00'), 1);
  });

  it('is 0 when finish is at or before start', () => {
    assert.equal(elapsedWorkingDays('2026-07-09', '2026-07-08'), 0);
    assert.equal(elapsedWorkingDays('2026-07-08T09:00', '2026-07-08T09:00'), 0);
  });
});
