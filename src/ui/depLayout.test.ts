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

  it('suppresses only the explicitly-linked pair, keeping the rest inferred', () => {
    // Three sibling leaves a, b, c under one block; explicit dep on the
    // (a,b) pair only. Per-pair suppression drops the a→b ghost but keeps
    // the b→c ghost — inference coexists with the explicit link.
    let g = emptyGraph();
    g = createGroup(g, { id: 'blk', title: 'Block' });
    g = createGroup(g, { id: 'a', title: 'A' }, 'blk');
    g = createGroup(g, { id: 'b', title: 'B' }, 'blk');
    g = createGroup(g, { id: 'c', title: 'C' }, 'blk');
    g = dep(g, 'b', 'a'); // explicit, consecutive pair (a,b)
    const layout = layoutDependencies(g, { inferChains: true });
    const inferred = layout.edges
      .filter((e) => e.inferred)
      .map((e) => `${e.dependent}->${e.prerequisite}`)
      .sort();
    assert.deepEqual(inferred, ['c->b']);
    // The explicit edge is still present and not marked inferred.
    assert.ok(
      layout.edges.some((e) => !e.inferred && e.dependent === 'b' && e.prerequisite === 'a'),
    );
  });

  it('does not infer a chain that contradicts a transitive explicit order', () => {
    // Sibling order a, b, c, d, but explicit deps order them a→d→b (a needs
    // d, d needs b). The (a,b) pair is ordered only transitively, so the
    // ghost a→b must be suppressed — inferring it would run against the flow
    // and close a cycle (the bug from the report). The undecided pairs stay.
    let g = emptyGraph();
    g = createGroup(g, { id: 'blk', title: 'Block' });
    g = createGroup(g, { id: 'a', title: 'A' }, 'blk');
    g = createGroup(g, { id: 'b', title: 'B' }, 'blk');
    g = createGroup(g, { id: 'c', title: 'C' }, 'blk');
    g = createGroup(g, { id: 'd', title: 'D' }, 'blk');
    g = dep(g, 'a', 'd'); // a needs d
    g = dep(g, 'd', 'b'); // d needs b  ⇒ a transitively needs b
    const layout = layoutDependencies(g, { inferChains: true });
    const inferred = layout.edges
      .filter((e) => e.inferred)
      .map((e) => `${e.dependent}->${e.prerequisite}`)
      .sort();
    // No ghost between a and b (already ordered); the rest are undecided.
    assert.ok(!inferred.includes('b->a'));
    assert.deepEqual(inferred, ['c->b', 'd->c']);
    // The result stays acyclic — nothing lands in a cycle.
    assert.ok(layout.nodes.every((n) => n.cycle === null));
  });

  it('does not chain siblings that share a common prerequisite (issue #17)', () => {
    // A is an explicit prerequisite of B, C, D, E (all siblings). They fan
    // out in parallel — inference must not serialise them into A→B→C→D→E.
    let g = emptyGraph();
    g = createGroup(g, { id: 'A', title: 'A' });
    g = createGroup(g, { id: 'B', title: 'B' });
    g = createGroup(g, { id: 'C', title: 'C' });
    g = createGroup(g, { id: 'D', title: 'D' });
    g = createGroup(g, { id: 'E', title: 'E' });
    for (const d of ['B', 'C', 'D', 'E']) g = dep(g, d, 'A'); // each needs A
    const layout = layoutDependencies(g, { inferChains: true });
    assert.deepEqual(
      layout.edges.filter((e) => e.inferred),
      [],
    );
    // B, C, D, E all sit one column right of A (parallel), not cascaded.
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    assert.equal(byId.get('A')!.x, 0);
    for (const d of ['B', 'C', 'D', 'E']) {
      assert.equal(byId.get(d)!.x, DEP_COLUMN_WIDTH);
    }
  });

  it('does not chain sibling prerequisites of a common dependent', () => {
    // Mirror of #17: B, C, D all feed a common dependent R — a parallel
    // fan-in that must not be chained B→C→D either.
    let g = emptyGraph();
    g = createGroup(g, { id: 'B', title: 'B' });
    g = createGroup(g, { id: 'C', title: 'C' });
    g = createGroup(g, { id: 'D', title: 'D' });
    g = createGroup(g, { id: 'R', title: 'R' });
    for (const p of ['B', 'C', 'D']) g = dep(g, 'R', p); // R needs each
    const layout = layoutDependencies(g, { inferChains: true });
    assert.deepEqual(
      layout.edges.filter((e) => e.inferred),
      [],
    );
  });

  it('aligns a single-neighbour node with its neighbour (no bent edge)', () => {
    // Two roots a, b in column 0; c depends on a alone in column 1. c should
    // sit level with a rather than being re-centred in its own column (which
    // used to bend the a→c edge).
    let g = emptyGraph();
    g = createGroup(g, { id: 'a', title: 'A' });
    g = createGroup(g, { id: 'b', title: 'B' });
    g = createGroup(g, { id: 'c', title: 'C' });
    g = dep(g, 'c', 'a'); // c needs a
    const byId = new Map(layoutDependencies(g).nodes.map((n) => [n.id, n]));
    assert.equal(byId.get('c')!.x, DEP_COLUMN_WIDTH);
    assert.equal(byId.get('c')!.y, byId.get('a')!.y);
  });

  it('orders within a layer to uncross fan edges (barycenter pass)', () => {
    // Two sources, two targets, wired crossed in pre-order: s1→t2, s2→t1.
    // The barycenter pass should place t2 above t1 (reversing pre-order)
    // so the edges run straight instead of crossing.
    let g = emptyGraph();
    g = createGroup(g, { id: 's1', title: 'S1' });
    g = createGroup(g, { id: 's2', title: 'S2' });
    g = createGroup(g, { id: 't1', title: 'T1' });
    g = createGroup(g, { id: 't2', title: 'T2' });
    g = dep(g, 't2', 's1'); // t2 needs s1
    g = dep(g, 't1', 's2'); // t1 needs s2
    const byId = new Map(layoutDependencies(g).nodes.map((n) => [n.id, n]));
    // Sources share column 0, targets column 1.
    assert.equal(byId.get('s1')!.x, 0);
    assert.equal(byId.get('t1')!.x, DEP_COLUMN_WIDTH);
    // Uncrossed: t2 (aligned with s1) sits above t1 (aligned with s2).
    assert.ok(byId.get('t2')!.y < byId.get('t1')!.y);
    assert.ok(byId.get('s1')!.y < byId.get('s2')!.y);
  });
});
