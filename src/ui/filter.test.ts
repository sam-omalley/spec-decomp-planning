import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Priority, Status, WorkNode } from '../model/types.ts';
import { EMPTY_FILTER, isFilterActive, matchesFilter } from './filter.ts';

function node(partial: Partial<WorkNode>): WorkNode {
  return {
    id: 'n',
    title: '',
    description: '',
    type: 'task',
    status: 'not_started',
    priority: 'medium',
    effort: null,
    durationEstimate: null,
    durationOptimistic: null,
    durationPessimistic: null,
    actualStart: null,
    actualFinish: null,
    resourceId: null,
    externalRefs: [],
    parkingLot: false,
    tags: [],
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('isFilterActive', () => {
  it('is false for the empty filter and whitespace-only text', () => {
    assert.equal(isFilterActive(EMPTY_FILTER), false);
    assert.equal(isFilterActive({ text: '   ' }), false);
  });

  it('is true when text or any facet is set', () => {
    assert.equal(isFilterActive({ text: 'auth' }), true);
    assert.equal(isFilterActive({ text: '', priorities: ['high'] }), true);
    assert.equal(isFilterActive({ text: '', statuses: ['done'] }), true);
    assert.equal(isFilterActive({ text: '', tags: ['api'] }), true);
  });

  it('treats empty facet arrays as inactive', () => {
    assert.equal(
      isFilterActive({ text: '', priorities: [], statuses: [], tags: [] }),
      false,
    );
  });
});

describe('matchesFilter text', () => {
  it('matches everything when empty', () => {
    assert.equal(matchesFilter(node({ title: 'anything' }), EMPTY_FILTER), true);
  });

  it('is case-insensitive over title', () => {
    assert.equal(matchesFilter(node({ title: 'Auth flow' }), { text: 'auth' }), true);
    assert.equal(matchesFilter(node({ title: 'Auth flow' }), { text: 'AUTH' }), true);
    assert.equal(matchesFilter(node({ title: 'Billing' }), { text: 'auth' }), false);
  });

  it('searches description and tags too', () => {
    assert.equal(
      matchesFilter(node({ description: 'uses OAuth tokens' }), { text: 'oauth' }),
      true,
    );
    assert.equal(matchesFilter(node({ tags: ['api', 'security'] }), { text: 'secur' }), true);
  });

  it('matches an external-ref (Jira) key', () => {
    const n = node({ externalRefs: [{ system: 'jira', key: 'PROJ-123' }] });
    assert.equal(matchesFilter(n, { text: 'proj-123' }), true);
    assert.equal(matchesFilter(n, { text: 'PROJ-123' }), true);
    assert.equal(matchesFilter(n, { text: 'proj-999' }), false);
  });

  it('ignores surrounding whitespace in the query', () => {
    assert.equal(matchesFilter(node({ title: 'Login' }), { text: '  log ' }), true);
  });

  it('does not run adjacent fields together (joined with a space)', () => {
    const n = node({ title: 'Auth', description: 'Billing' });
    assert.equal(matchesFilter(n, { text: 'authbilling' }), false);
    assert.equal(matchesFilter(n, { text: 'auth billing' }), true);
  });
});

describe('matchesFilter facets', () => {
  it('filters by priority (conjunctive with text)', () => {
    const n = node({ title: 'Auth', priority: 'high' as Priority });
    assert.equal(matchesFilter(n, { text: 'auth', priorities: ['high'] }), true);
    assert.equal(matchesFilter(n, { text: 'auth', priorities: ['low'] }), false);
    assert.equal(matchesFilter(n, { text: 'other', priorities: ['high'] }), false);
  });

  it('filters by status', () => {
    const n = node({ status: 'done' as Status });
    assert.equal(matchesFilter(n, { text: '', statuses: ['done'] }), true);
    assert.equal(matchesFilter(n, { text: '', statuses: ['in_progress'] }), false);
  });

  it('matches a node carrying any of the requested tags', () => {
    const n = node({ tags: ['api', 'ui'] });
    assert.equal(matchesFilter(n, { text: '', tags: ['ui'] }), true);
    assert.equal(matchesFilter(n, { text: '', tags: ['db', 'ui'] }), true);
    assert.equal(matchesFilter(n, { text: '', tags: ['db'] }), false);
  });
});
