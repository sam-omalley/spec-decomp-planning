import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleIndexOf,
  dependencyCycles,
  dependentsOf,
  prerequisitesOf,
  waitingMap,
} from './analysis.ts';
import { addEdge, createGroup, emptyGraph, updateNode } from './graph.ts';
import type { ProjectGraph } from './types.ts';

// Dependencies are group-only, so the analysis fixtures build groups.
function nodes(...ids: string[]): ProjectGraph {
  let g = emptyGraph();
  for (const id of ids) g = createGroup(g, { id, title: id.toUpperCase() });
  return g;
}

function dep(g: ProjectGraph, from: string, to: string): ProjectGraph {
  return addEdge(g, { type: 'depends_on', from, to });
}

describe('prerequisites and dependents', () => {
  it("combines depends_on with the inverse of 'blocks'", () => {
    let g = nodes('a', 'b', 'c');
    g = dep(g, 'a', 'b');
    g = addEdge(g, { type: 'blocks', from: 'c', to: 'a' }); // c blocks a → a needs c
    assert.deepEqual(prerequisitesOf(g, 'a').sort(), ['b', 'c']);
    assert.deepEqual(dependentsOf(g, 'b'), ['a']);
    assert.deepEqual(dependentsOf(g, 'c'), ['a']);
  });
});

describe('dependencyCycles (Tarjan)', () => {
  it('finds no cycles in a chain or diamond', () => {
    let g = nodes('a', 'b', 'c', 'd');
    g = dep(g, 'a', 'b');
    g = dep(g, 'b', 'c');
    g = dep(g, 'a', 'd');
    g = dep(g, 'd', 'c');
    assert.deepEqual(dependencyCycles(g), []);
  });

  it('finds a simple cycle and reports its members', () => {
    let g = nodes('a', 'b', 'c', 'x');
    g = dep(g, 'a', 'b');
    g = dep(g, 'b', 'c');
    g = dep(g, 'c', 'a');
    g = dep(g, 'x', 'a'); // dangling dependent, not in the cycle
    const cycles = dependencyCycles(g);
    assert.equal(cycles.length, 1);
    assert.deepEqual([...cycles[0]!].sort(), ['a', 'b', 'c']);
    assert.equal(cycleIndexOf(g).has('x'), false);
  });

  it('separates independent cycles', () => {
    let g = nodes('a', 'b', 'c', 'd');
    g = dep(g, 'a', 'b');
    g = dep(g, 'b', 'a');
    g = dep(g, 'c', 'd');
    g = dep(g, 'd', 'c');
    const index = cycleIndexOf(g);
    assert.equal(index.get('a'), index.get('b'));
    assert.equal(index.get('c'), index.get('d'));
    assert.notEqual(index.get('a'), index.get('c'));
  });

  it("a 'blocks' edge can close a cycle", () => {
    let g = nodes('a', 'b');
    g = dep(g, 'a', 'b'); // a needs b
    g = addEdge(g, { type: 'blocks', from: 'a', to: 'b' }); // a blocks b → b needs a
    assert.equal(dependencyCycles(g).length, 1);
  });
});

describe('waitingMap', () => {
  it('lists unfinished direct prerequisites only', () => {
    let g = nodes('a', 'b', 'c');
    g = dep(g, 'a', 'b');
    g = dep(g, 'a', 'c');
    g = updateNode(g, 'b', { status: 'done' });
    assert.deepEqual(waitingMap(g).get('a'), ['c']);
    g = updateNode(g, 'c', { status: 'done' });
    assert.equal(waitingMap(g).has('a'), false, 'all prerequisites done');
  });

  it('in_progress prerequisites still count as waiting', () => {
    let g = nodes('a', 'b');
    g = dep(g, 'a', 'b');
    g = updateNode(g, 'b', { status: 'in_progress' });
    assert.deepEqual(waitingMap(g).get('a'), ['b']);
  });
});
