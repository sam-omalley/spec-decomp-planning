import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from './projectStore.ts';
import {
  GraphError,
  addEdge,
  assignToEpic,
  createEpic,
  createNode,
  createPlan,
  deleteNode,
  membersOfEpic,
  parentOf,
  removeFromEpic,
  updateNode,
} from '../model/graph.ts';

function seeded(): ProjectStore {
  const store = new ProjectStore();
  store.commit((g) => {
    g = createNode(g, { id: 'cart', title: 'Shopping cart', type: 'feature' });
    g = createNode(g, { id: 'pricing', title: 'Pricing' }, 'cart');
    g = createNode(g, { id: 'coupons', title: 'Coupons' }, 'pricing');
    return g;
  });
  return store;
}

describe('commits', () => {
  it('composed mutations form one atomic undo step', () => {
    const store = seeded();
    assert.equal(Object.keys(store.getState().nodes).length, 3);
    store.undo();
    assert.equal(Object.keys(store.getState().nodes).length, 0);
  });

  it('a throwing mutation leaves state and history untouched', () => {
    const store = seeded();
    const before = store.getState();
    assert.throws(
      () =>
        store.commit((g) => {
          g = updateNode(g, 'coupons', { status: 'done' });
          g = deleteNode(g, 'ghost');
          return g;
        }),
      GraphError,
    );
    assert.equal(store.getState(), before, 'state unchanged');
    store.undo();
    assert.equal(Object.keys(store.getState().nodes).length, 0, 'no partial undo step');
  });

  it('identity mutations do not pollute history', () => {
    const store = seeded();
    store.commit((g) => g);
    store.undo();
    assert.equal(Object.keys(store.getState().nodes).length, 0);
  });

  it('notifies subscribers once per commit and supports unsubscribe', () => {
    const store = seeded();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.commit((g) => createNode(g, { id: 'tax', title: 'Tax' }, 'pricing'));
    assert.equal(calls, 1);
    unsubscribe();
    store.commit((g) => createNode(g, { id: 'ship', title: 'Shipping' }, 'pricing'));
    assert.equal(calls, 1);
  });
});

describe('undo and redo', () => {
  it('round-trips a delete', () => {
    const store = seeded();
    store.commit((g) => deleteNode(g, 'pricing'));
    assert.equal(store.getState().nodes['coupons'], undefined);
    store.undo();
    assert.equal(store.getState().nodes['coupons']!.title, 'Coupons');
    assert.equal(parentOf(store.getState(), 'coupons'), 'pricing');
    store.redo();
    assert.equal(store.getState().nodes['coupons'], undefined);
  });

  it('a new commit clears the redo stack', () => {
    const store = seeded();
    store.commit((g) => updateNode(g, 'coupons', { status: 'done' }));
    store.undo();
    assert.ok(store.canRedo);
    store.commit((g) => updateNode(g, 'coupons', { status: 'blocked' }));
    assert.ok(!store.canRedo);
    assert.equal(store.getState().nodes['coupons']!.status, 'blocked');
  });

  it('undo/redo restore planning data atomically', () => {
    const store = seeded();
    store.commit((g) => {
      g = createPlan(g, { id: 'p1', name: 'MVP' });
      g = createEpic(g, 'p1', { id: 'e1', title: 'Checkout MVP' });
      g = createEpic(g, 'p1', { id: 'e2', title: 'Later' });
      g = assignToEpic(g, 'coupons', 'e1');
      return g;
    });
    store.commit((g) => {
      g = removeFromEpic(g, 'coupons', 'e1');
      g = assignToEpic(g, 'coupons', 'e2');
      return g;
    });
    assert.deepEqual(membersOfEpic(store.getState(), 'e2'), ['coupons']);
    store.undo();
    assert.deepEqual(membersOfEpic(store.getState(), 'e1'), ['coupons']);
    assert.deepEqual(membersOfEpic(store.getState(), 'e2'), []);
    assert.equal(parentOf(store.getState(), 'coupons'), 'pricing', 'tree untouched throughout');
  });

  it('undo is bounded and returns false when exhausted', () => {
    const store = new ProjectStore();
    assert.equal(store.undo(), false);
    assert.equal(store.redo(), false);
  });
});

describe('reset', () => {
  it('replaces state and clears history', () => {
    const store = seeded();
    let g = store.getState();
    g = addEdge(g, { type: 'depends_on', from: 'coupons', to: 'pricing' });
    store.reset(g);
    assert.ok(!store.canUndo);
    assert.ok(!store.canRedo);
    assert.equal(Object.values(store.getState().edges).filter((e) => e.type === 'depends_on').length, 1);
  });
});
