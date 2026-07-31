import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableResources,
  isAvailableEverAfter,
  isAvailableOn,
  standingLabel,
  standingOn,
} from './resources.ts';
import { emptyGraph, updateSettings } from './graph.ts';
import type { Resource } from './types.ts';

function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 'r0',
    name: 'Ada',
    fte: 1,
    leave: [],
    availableFrom: null,
    availableUntil: null,
    ...overrides,
  };
}

describe('standingOn', () => {
  it('treats a resource with no window as always on the team', () => {
    assert.equal(standingOn(resource(), '1999-01-01'), 'active');
    assert.equal(standingOn(resource(), '2099-01-01'), 'active');
  });

  it('is inclusive at both ends of the window', () => {
    const r = resource({ availableFrom: '2024-01-01', availableUntil: '2024-06-30' });
    assert.equal(standingOn(r, '2024-01-01'), 'active');
    assert.equal(standingOn(r, '2024-06-30'), 'active');
    assert.equal(standingOn(r, '2023-12-31'), 'upcoming');
    assert.equal(standingOn(r, '2024-07-01'), 'former');
  });

  it('reads an open start or open end as unbounded on that side', () => {
    const leaver = resource({ availableUntil: '2024-06-30' });
    assert.equal(standingOn(leaver, '1999-01-01'), 'active');
    assert.equal(standingOn(leaver, '2024-07-01'), 'former');
    const joiner = resource({ availableFrom: '2024-06-30' });
    assert.equal(standingOn(joiner, '2024-06-29'), 'upcoming');
    assert.equal(standingOn(joiner, '2099-01-01'), 'active');
  });
});

describe('isAvailableEverAfter', () => {
  it('keeps someone who has left in the future, and drops one who already has', () => {
    assert.equal(isAvailableEverAfter(resource({ availableUntil: '2024-06-30' }), '2024-06-01'), true);
    assert.equal(isAvailableEverAfter(resource({ availableUntil: '2024-06-30' }), '2024-07-01'), false);
  });

  it('keeps a future joiner — they are still someone work can be given to', () => {
    assert.equal(isAvailableEverAfter(resource({ availableFrom: '2025-01-01' }), '2024-01-01'), true);
  });
});

describe('availableResources', () => {
  it('narrows the roster to the people on the team that day, in settings order', () => {
    const settings = updateSettings(emptyGraph(), {
      resources: [
        resource({ id: 'gone', availableUntil: '2024-03-31' }),
        resource({ id: 'here' }),
        resource({ id: 'soon', availableFrom: '2024-09-01' }),
      ],
    }).settings;
    assert.deepEqual(
      availableResources(settings, '2024-06-01').map((r) => r.id),
      ['here'],
    );
    assert.deepEqual(
      availableResources(settings, '2024-01-01').map((r) => r.id),
      ['gone', 'here'],
    );
    assert.deepEqual(
      availableResources(settings, '2024-09-02').map((r) => r.id),
      ['here', 'soon'],
    );
  });
});

describe('standingLabel', () => {
  it('phrases only the non-active standings', () => {
    assert.equal(standingLabel(resource(), '2024-06-01'), null);
    assert.equal(
      standingLabel(resource({ availableUntil: '2024-03-31' }), '2024-06-01'),
      'left 2024-03-31',
    );
    assert.equal(
      standingLabel(resource({ availableFrom: '2024-09-01' }), '2024-06-01'),
      'joins 2024-09-01',
    );
  });
});
