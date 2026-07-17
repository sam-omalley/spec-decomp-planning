import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutsFor } from './shortcuts.ts';

function headings(section: Parameters<typeof shortcutsFor>[0], planMode: Parameters<typeof shortcutsFor>[1], graphMode: Parameters<typeof shortcutsFor>[2]) {
  return shortcutsFor(section, planMode, graphMode).map((g) => g.heading);
}

describe('shortcutsFor', () => {
  it('Spec: Outliner + App', () => {
    assert.deepEqual(headings('spec', 'outline', 'map'), ['Outliner', 'App']);
  });

  it('Planning outline: Outliner + Details card + App', () => {
    assert.deepEqual(headings('planning', 'outline', 'map'), ['Outliner', 'Details card', 'App']);
  });

  it('Planning table: Table + App, no outliner shortcuts', () => {
    assert.deepEqual(headings('planning', 'table', 'map'), ['Table', 'App']);
  });

  it('Planning markdown: just App', () => {
    assert.deepEqual(headings('planning', 'markdown', 'map'), ['App']);
  });

  it('Graph: Graph + App, same for both map and dependency modes', () => {
    assert.deepEqual(headings('graph', 'outline', 'map'), ['Graph', 'App']);
    assert.deepEqual(headings('graph', 'outline', 'dep'), ['Graph', 'App']);
  });

  it('Reporting and Settings: just App', () => {
    assert.deepEqual(headings('reporting', 'outline', 'map'), ['App']);
    assert.deepEqual(headings('settings', 'outline', 'map'), ['App']);
  });

  it('App group always documents the ? / Esc / undo-redo shortcuts', () => {
    const app = shortcutsFor('spec', 'outline', 'map').find((g) => g.heading === 'App');
    const keys = app?.entries.map((e) => e.keys) ?? [];
    assert.ok(keys.includes('?'));
    assert.ok(keys.includes('Esc'));
  });
});
