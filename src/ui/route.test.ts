import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashFor, parseHash, subOf, type RouteState } from './route.ts';

const base: RouteState = {
  section: 'spec',
  planMode: 'outline',
  graphMode: 'map',
  reportMode: 'timeline',
};

describe('hashFor', () => {
  it('omits the sub for a section without one (Spec)', () => {
    assert.equal(hashFor(base), '#/spec');
  });
  it('encodes the active section-specific sub-view', () => {
    assert.equal(hashFor({ ...base, section: 'planning', planMode: 'markdown' }), '#/planning/markdown');
    assert.equal(hashFor({ ...base, section: 'graph', graphMode: 'dep' }), '#/graph/dep');
    assert.equal(hashFor({ ...base, section: 'reporting', reportMode: 'assignees' }), '#/reporting/assignees');
  });
  it('only reflects the sub for the *current* section', () => {
    // planMode is table but we're on graph → hash shows graph's sub, not table.
    assert.equal(hashFor({ ...base, section: 'graph', planMode: 'table', graphMode: 'map' }), '#/graph/map');
  });
});

describe('subOf', () => {
  it('returns null for Spec and the mode otherwise', () => {
    assert.equal(subOf(base), null);
    assert.equal(subOf({ ...base, section: 'reporting', reportMode: 'concerns' }), 'concerns');
  });
});

describe('parseHash', () => {
  it('round-trips with hashFor', () => {
    const states: RouteState[] = [
      base,
      { ...base, section: 'planning', planMode: 'table' },
      { ...base, section: 'graph', graphMode: 'dep' },
      { ...base, section: 'reporting', reportMode: 'metrics' },
    ];
    for (const s of states) {
      const p = parseHash(hashFor(s));
      assert.ok(p);
      assert.equal(p!.section, s.section);
    }
  });
  it('accepts hashes with or without a leading slash', () => {
    assert.deepEqual(parseHash('#/planning/table'), { section: 'planning', planMode: 'table' });
    assert.deepEqual(parseHash('#planning/table'), { section: 'planning', planMode: 'table' });
  });
  it('returns just the section when no sub is present', () => {
    assert.deepEqual(parseHash('#/reporting'), { section: 'reporting' });
  });
  it('ignores an unknown sub-view (leaves the section, drops the sub)', () => {
    assert.deepEqual(parseHash('#/graph/bogus'), { section: 'graph' });
    // a planning sub is not valid under graph → dropped
    assert.deepEqual(parseHash('#/graph/table'), { section: 'graph' });
  });
  it('returns null for an unknown or empty section', () => {
    assert.equal(parseHash(''), null);
    assert.equal(parseHash('#/'), null);
    assert.equal(parseHash('#/nope'), null);
  });
});
