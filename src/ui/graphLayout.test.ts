import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignToGroup,
  createGroup,
  createNode,
  emptyGraph,
} from '../model/graph.ts';
import type { ProjectGraph } from '../model/types.ts';
import {
  BRIDGE_GAP,
  COLUMN_WIDTH,
  ROW_HEIGHT,
  layoutGraph,
  type PlacedNode,
} from './graphLayout.ts';

/**
 * Spec:  app ─┬─ auth ─┬─ login
 *             │        └─ signup
 *             └─ billing
 * Delivery:  block1 ─┬─ epicA
 *                    └─ epicB
 */
function fixture(): ProjectGraph {
  let g = emptyGraph();
  g = createNode(g, { id: 'app', title: 'App' });
  g = createNode(g, { id: 'auth', title: 'Auth' }, 'app');
  g = createNode(g, { id: 'login', title: 'Login' }, 'auth');
  g = createNode(g, { id: 'signup', title: 'Signup' }, 'auth');
  g = createNode(g, { id: 'billing', title: 'Billing' }, 'app');
  g = createGroup(g, { id: 'block1', title: 'Block 1' });
  g = createGroup(g, { id: 'epicA', title: 'Epic A' }, 'block1');
  g = createGroup(g, { id: 'epicB', title: 'Epic B' }, 'block1');
  g = assignToGroup(g, 'login', 'epicA');
  return g;
}

function byId(placed: PlacedNode[]): Map<string, PlacedNode> {
  return new Map(placed.map((p) => [p.id, p]));
}

describe('layoutGraph', () => {
  it('lays the spec tree out left-to-right by depth', () => {
    const placed = byId(layoutGraph(fixture()));
    assert.equal(placed.get('app')!.x, 0);
    assert.equal(placed.get('auth')!.x, COLUMN_WIDTH);
    assert.equal(placed.get('login')!.x, 2 * COLUMN_WIDTH);
    assert.equal(placed.get('billing')!.x, COLUMN_WIDTH);
  });

  it('stacks leaves on consecutive rows and centers parents', () => {
    const placed = byId(layoutGraph(fixture()));
    assert.equal(placed.get('login')!.y, 0);
    assert.equal(placed.get('signup')!.y, ROW_HEIGHT);
    assert.equal(placed.get('billing')!.y, 2 * ROW_HEIGHT);
    assert.equal(placed.get('auth')!.y, ROW_HEIGHT / 2, 'midpoint of login/signup');
    assert.equal(placed.get('app')!.y, ((0.5 + 2) / 2) * ROW_HEIGHT, 'midpoint of auth/billing');
  });

  it('mirrors the group forest right of the bridge gap, root rightmost', () => {
    const placed = byId(layoutGraph(fixture()));
    const groupX0 = 2 * COLUMN_WIDTH + BRIDGE_GAP; // spec maxDepth = 2
    assert.equal(placed.get('epicA')!.x, groupX0, 'group leaves face the gap');
    assert.equal(placed.get('epicB')!.x, groupX0);
    assert.equal(placed.get('block1')!.x, groupX0 + COLUMN_WIDTH, 'root rightmost');
    assert.equal(placed.get('epicA')!.side, 'group');
  });

  it('vertically centers the shorter forest', () => {
    const placed = byId(layoutGraph(fixture()));
    // work rows = 3, group rows = 2 → groups shift down by half a row
    assert.equal(placed.get('epicA')!.y, 0.5 * ROW_HEIGHT);
    assert.equal(placed.get('epicB')!.y, 1.5 * ROW_HEIGHT);
    assert.equal(placed.get('block1')!.y, ROW_HEIGHT, 'midpoint of its children');
  });

  describe('visible sub-graph (hide filter reflow)', () => {
    it('re-flows survivors compactly with no gaps', () => {
      // Keep only signup and billing on the work side: they should take
      // consecutive rows from 0, not their full-graph rows (1, 2).
      const placed = byId(layoutGraph(fixture(), new Set(['signup', 'billing', 'epicB'])));
      assert.deepEqual([...placed.keys()].sort(), ['billing', 'epicB', 'signup']);
      assert.equal(placed.get('signup')!.y, 0);
      assert.equal(placed.get('billing')!.y, ROW_HEIGHT);
    });

    it('promotes a visible node whose parent is hidden to a root', () => {
      // signup stays but its parent auth is hidden → signup lays out at
      // depth 0 (a root), not depth 2.
      const placed = byId(layoutGraph(fixture(), new Set(['signup', 'epicB'])));
      assert.equal(placed.get('signup')!.x, 0, 'depth 0 despite being nested in the full tree');
      assert.equal(placed.get('signup')!.side, 'work');
      // epicB (parent block1 hidden) becomes the lone group root, rightmost.
      assert.equal(placed.get('epicB')!.side, 'group');
    });

    it('filters out edges implicitly — only listed ids are placed', () => {
      const placed = layoutGraph(fixture(), new Set(['app']));
      assert.deepEqual(placed.map((p) => p.id), ['app']);
      assert.deepEqual({ x: placed[0]!.x, y: placed[0]!.y }, { x: 0, y: 0 });
    });
  });

  it('handles an empty graph and a one-sided graph', () => {
    assert.deepEqual(layoutGraph(emptyGraph()), []);
    let g = emptyGraph();
    g = createNode(g, { id: 'solo', title: 'Solo' });
    const placed = layoutGraph(g);
    assert.equal(placed.length, 1);
    assert.deepEqual(placed[0], { id: 'solo', side: 'work', x: 0, y: 0 });
  });
});
