import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRegistry } from './projectRegistry.ts';
import type { ProjectIndexEntry } from '../persist/persistence.ts';

function entry(id: string): ProjectIndexEntry {
  return { id, name: id, savedAt: '2024-01-01T00:00:00Z' };
}

describe('ProjectRegistry', () => {
  it('starts with the constructor values', () => {
    const r = new ProjectRegistry('a', [entry('a')]);
    assert.equal(r.getActiveId(), 'a');
    assert.deepEqual(r.getProjects(), [entry('a')]);
  });

  it('setActive updates getActiveId and notifies subscribers', () => {
    const r = new ProjectRegistry('a', [entry('a'), entry('b')]);
    let notified = 0;
    r.subscribe(() => notified++);
    r.setActive('b');
    assert.equal(r.getActiveId(), 'b');
    assert.equal(notified, 1);
  });

  it('setProjects replaces the list and notifies subscribers', () => {
    const r = new ProjectRegistry('a', [entry('a')]);
    let notified = 0;
    r.subscribe(() => notified++);
    const next = [entry('a'), entry('b')];
    r.setProjects(next);
    assert.equal(r.getProjects(), next); // same reference — stable snapshot
    assert.equal(notified, 1);
  });

  it('unsubscribe stops further notifications', () => {
    const r = new ProjectRegistry('a', [entry('a')]);
    let notified = 0;
    const unsubscribe = r.subscribe(() => notified++);
    unsubscribe();
    r.setActive('b');
    assert.equal(notified, 0);
  });
});
