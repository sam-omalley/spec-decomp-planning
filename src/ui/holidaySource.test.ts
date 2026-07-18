import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newHolidays, selectHolidays, subdivisionsIn, type RemoteHoliday } from './holidaySource.ts';

const AU_2026: RemoteHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day", global: true, counties: null },
  { date: '2026-03-09', name: 'Adelaide Cup Day', global: false, counties: ['AU-SA'] },
  { date: '2026-03-10', name: 'Labour Day', global: false, counties: ['AU-VIC'] },
  { date: '2026-04-25', name: 'Anzac Day', global: false, counties: ['AU-SA', 'AU-TAS', 'AU-VIC'] },
];

describe('subdivisionsIn', () => {
  it('collects every distinct subdivision code, sorted', () => {
    assert.deepEqual(subdivisionsIn(AU_2026), ['AU-SA', 'AU-TAS', 'AU-VIC']);
  });

  it('is empty when nothing is subdivision-specific', () => {
    assert.deepEqual(subdivisionsIn([AU_2026[0]!]), []);
  });
});

describe('selectHolidays', () => {
  it('includes only global holidays when no subdivision is selected', () => {
    assert.deepEqual(selectHolidays(AU_2026, null), [{ start: '2026-01-01', end: '2026-01-01' }]);
  });

  it('includes global plus the selected subdivision’s own holidays', () => {
    assert.deepEqual(selectHolidays(AU_2026, 'AU-SA'), [
      { start: '2026-01-01', end: '2026-01-01' },
      { start: '2026-03-09', end: '2026-03-09' },
      { start: '2026-04-25', end: '2026-04-25' },
    ]);
  });

  it('excludes another subdivision’s holiday', () => {
    const result = selectHolidays(AU_2026, 'AU-SA');
    // Labour Day (2026-03-10, AU-VIC only) must not appear for AU-SA.
    assert.equal(result.some((r) => r.start === '2026-03-10'), false);
  });
});

describe('newHolidays', () => {
  it('drops ranges already present, keeps the rest', () => {
    const existing = [{ start: '2026-01-01', end: '2026-01-01' }];
    const fetched = [
      { start: '2026-01-01', end: '2026-01-01' },
      { start: '2026-03-09', end: '2026-03-09' },
    ];
    assert.deepEqual(newHolidays(fetched, existing), [{ start: '2026-03-09', end: '2026-03-09' }]);
  });

  it('dedupes duplicates within the incoming batch itself', () => {
    const fetched = [
      { start: '2026-03-09', end: '2026-03-09' },
      { start: '2026-03-09', end: '2026-03-09' },
    ];
    assert.deepEqual(newHolidays(fetched, []), [{ start: '2026-03-09', end: '2026-03-09' }]);
  });
});
