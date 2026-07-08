import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addEdge, createGroup, createNode, emptyGraph } from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import { DEP_COLUMN_WIDTH, layoutDependencies } from './depLayout.ts';

function dep(g: ProjectGraph, from: string, to: string): ProjectGraph {
  return addEdge(g, { type: 'depends_on', from, to });
}

/** block1 ─┬ epicA        block2 ─ epicC        solo (leaf root) */
/**         └ epicB                                                */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = createGroup(g, { id: 'block1', title: 'Block 1' });
  g = createGroup(g, { id: 'epicA', title: 'Epic A' }, 'block1');
  g = createGroup(g, { id: 'epicB', title: 'Epic B' }, 'block1');
  g = createGroup(g, { id: 'block2', title: 'Block 2' });
  g = createGroup(g, { id: 'epicC', title: 'Epic C' }, 'block2');
  g = createGroup(g, { id: 'solo', title: 'Solo' });
  return g;
}

const ids = (layout: { nodes: { id: string }[] }): string[] =>
  layout.nodes.map((n) => n.id).sort();

describe('layoutDependencies', () => {
  it('includes only leaf groups (containers are excluded)', () => {
    assert.deepEqual(ids(layoutDependencies(fixture())), [
      'epicA',
      'epicB',
      'epicC',
      'solo',
    ]);
  });

  it('is empty when there are no leaf groups', () => {
    let g = emptyGraph();
    g = createNode(g, { id: 'w', title: 'Work' }); // spec node, not a group
    const layout = layoutDependencies(g);
    assert.deepEqual(layout.nodes, []);
    assert.deepEqual(layout.edges, []);
  });

  it('layers prerequisites left of dependents by longest path', () => {
    let g = fixture();
    g = dep(g, 'epicB', 'epicA'); // epicB needs epicA
    const layout = layoutDependencies(g);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    assert.equal(byId.get('epicA')!.x, 0);
    assert.equal(byId.get('epicB')!.x, DEP_COLUMN_WIDTH);
    const edge = layout.edges.find((e) => e.dependent === 'epicB');
    assert.deepEqual(
      { p: edge!.prerequisite, inferred: edge!.inferred, inCycle: edge!.inCycle },
      { p: 'epicA', inferred: false, inCycle: false },
    );
  });

  it('fans a container dependency out to its descendant leaves', () => {
    let g = fixture();
    g = dep(g, 'block2', 'block1'); // container → container
    const layout = layoutDependencies(g);
    const pairs = layout.edges
      .map((e) => `${e.dependent}->${e.prerequisite}`)
      .sort();
    assert.deepEqual(pairs, ['epicC->epicA', 'epicC->epicB']);
    // epicC depends on both block1 leaves, so it sits one column right.
    const epicC = layout.nodes.find((n) => n.id === 'epicC')!;
    assert.equal(epicC.x, DEP_COLUMN_WIDTH);
  });

  it('detects and marks a real cycle', () => {
    let g = fixture();
    g = dep(g, 'epicA', 'epicB');
    g = dep(g, 'epicB', 'epicA');
    const layout = layoutDependencies(g);
    const a = layout.nodes.find((n) => n.id === 'epicA')!;
    const b = layout.nodes.find((n) => n.id === 'epicB')!;
    assert.notEqual(a.cycle, null);
    assert.equal(a.cycle, b.cycle);
    assert.ok(layout.edges.every((e) => e.inCycle));
  });

  it('infers a sequential chain across dep-free siblings only when asked', () => {
    const g = fixture(); // epicA, epicB are dep-free siblings
    // Off by default.
    assert.equal(layoutDependencies(g).edges.length, 0);
    // On: chain in sibling order, all marked inferred.
    const layout = layoutDependencies(g, { inferChains: true });
    const inferred = layout.edges.filter((e) => e.inferred);
    assert.deepEqual(
      inferred.map((e) => `${e.dependent}->${e.prerequisite}`).sort(),
      ['epicB->epicA'],
    );
    // The chain cascades the columns.
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    assert.equal(byId.get('epicA')!.x, 0);
    assert.equal(byId.get('epicB')!.x, DEP_COLUMN_WIDTH);
  });

  it('suppresses the inferred chain when siblings carry an explicit dep', () => {
    let g = fixture();
    g = dep(g, 'epicB', 'epicA'); // explicit dep between the siblings
    const layout = layoutDependencies(g, { inferChains: true });
    assert.ok(layout.edges.every((e) => !e.inferred));
  });
});
