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

  it('handles an empty graph and a one-sided graph', () => {
    assert.deepEqual(layoutGraph(emptyGraph()), []);
    let g = emptyGraph();
    g = createNode(g, { id: 'solo', title: 'Solo' });
    const placed = layoutGraph(g);
    assert.equal(placed.length, 1);
    assert.deepEqual(placed[0], { id: 'solo', side: 'work', x: 0, y: 0 });
  });
});
