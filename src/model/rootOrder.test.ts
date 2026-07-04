import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge,
  createEpic,
  createNode,
  createPlan,
  deleteNode,
  emptyGraph,
  moveNode,
  parentOf,
  removeEdge,
  rootsOf,
} from './graph.ts';
import { deserializeProject, serializeProject } from './serialize.ts';
import type { ProjectGraph } from './types.ts';

function threeRoots(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'a', title: 'A' });
  g = createNode(g, { id: 'b', title: 'B' });
  g = createNode(g, { id: 'c', title: 'C' });
  return g;
}

describe('rootOrder maintenance', () => {
  it('new roots append in creation order; children never enter it', () => {
    let g = threeRoots();
    g = createNode(g, { id: 'a1', title: 'A1' }, 'a');
    assert.deepEqual(rootsOf(g), ['a', 'b', 'c']);
  });

  it('epics never enter the root order', () => {
    let g = threeRoots();
    g = createPlan(g, { id: 'p', name: 'P' });
    g = createEpic(g, 'p', { id: 'e', title: 'E' });
    assert.deepEqual(rootsOf(g), ['a', 'b', 'c']);
  });

  it('gaining a parent leaves the root order; losing it re-roots at the end', () => {
    let g = threeRoots();
    g = addEdge(g, { id: 'edge1', type: 'contains', from: 'a', to: 'b' });
    assert.deepEqual(rootsOf(g), ['a', 'c']);
    g = removeEdge(g, 'edge1');
    assert.deepEqual(rootsOf(g), ['a', 'c', 'b']);
  });

  it('moveNode to root honours the index', () => {
    let g = threeRoots();
    g = moveNode(g, 'c', null, 0);
    assert.deepEqual(rootsOf(g), ['c', 'a', 'b']);
    g = moveNode(g, 'c', 'a');
    assert.deepEqual(rootsOf(g), ['a', 'b']);
    g = moveNode(g, 'c', null, 1);
    assert.deepEqual(rootsOf(g), ['a', 'c', 'b']);
    assert.equal(parentOf(g, 'c'), null);
  });

  it('deleting a subtree removes its root from the order', () => {
    let g = threeRoots();
    g = createNode(g, { id: 'b1', title: 'B1' }, 'b');
    g = deleteNode(g, 'b');
    assert.deepEqual(rootsOf(g), ['a', 'c']);
  });
});

describe('serialization of rootOrder', () => {
  it('round-trips a reordered graph', () => {
    let g = threeRoots();
    g = moveNode(g, 'c', null, 0);
    const restored = deserializeProject(serializeProject(g));
    assert.deepEqual(rootsOf(restored), ['c', 'a', 'b']);
  });

  it('migrates v1 files (no rootOrder) using createdAt order', () => {
    const g = threeRoots();
    const v1 = JSON.parse(serializeProject(g));
    v1.version = 1;
    delete v1.graph.rootOrder;
    // make creation order differ from object-key order
    v1.graph.nodes['a'].createdAt = '2026-01-03T00:00:00Z';
    v1.graph.nodes['b'].createdAt = '2026-01-01T00:00:00Z';
    v1.graph.nodes['c'].createdAt = '2026-01-02T00:00:00Z';
    const restored = deserializeProject(JSON.stringify(v1));
    assert.deepEqual(rootsOf(restored), ['b', 'c', 'a']);
  });

  it('reconciles a corrupt rootOrder: drops stale ids, appends missing roots', () => {
    const g = threeRoots();
    const file = JSON.parse(serializeProject(g));
    file.graph.rootOrder = ['c', 'ghost', 'c'];
    const restored = deserializeProject(JSON.stringify(file));
    assert.deepEqual(rootsOf(restored), ['c', 'a', 'b']);
  });
});
