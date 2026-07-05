import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosaver } from './persistence.ts';

interface FakeStore {
  state: { n: number };
  listeners: Set<() => void>;
  bump: () => void;
}

function fakeStore(): FakeStore {
  const store: FakeStore = {
    state: { n: 0 },
    listeners: new Set(),
    bump() {
      store.state = { n: store.state.n + 1 };
      for (const l of store.listeners) l();
    },
  };
  return store;
}

function saver(store: FakeStore, delayMs = 300) {
  const saved: string[] = [];
  const handle = createAutosaver({
    subscribe: (l) => {
      store.listeners.add(l);
      return () => store.listeners.delete(l);
    },
    getState: () => store.state,
    serialize: (s) => JSON.stringify(s),
    save: (text) => {
      saved.push(text);
      return Promise.resolve();
    },
    delayMs,
  });
  return { saved, handle };
}

describe('createAutosaver', () => {
  it('debounces a burst of changes into one save of the latest state', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = fakeStore();
      const { saved } = saver(store);
      store.bump();
      mock.timers.tick(200);
      store.bump();
      store.bump();
      assert.deepEqual(saved, [], 'nothing saved while typing');
      mock.timers.tick(300);
      assert.deepEqual(saved, ['{"n":3}']);
      mock.timers.tick(1000);
      assert.deepEqual(saved, ['{"n":3}'], 'no further saves without changes');
    } finally {
      mock.timers.reset();
    }
  });

  it('flush saves immediately and dedupes an unchanged state', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = fakeStore();
      const { saved, handle } = saver(store);
      store.bump();
      handle.flush();
      assert.deepEqual(saved, ['{"n":1}']);
      handle.flush();
      assert.deepEqual(saved, ['{"n":1}'], 'same reference not saved twice');
      mock.timers.tick(500);
      assert.deepEqual(saved, ['{"n":1}'], 'flush cancelled the pending timer');
    } finally {
      mock.timers.reset();
    }
  });

  it('stop unsubscribes and cancels pending saves', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = fakeStore();
      const { saved, handle } = saver(store);
      store.bump();
      handle.stop();
      mock.timers.tick(1000);
      store.bump();
      mock.timers.tick(1000);
      assert.deepEqual(saved, []);
    } finally {
      mock.timers.reset();
    }
  });

  it('reports save failures through onError', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = fakeStore();
      const errors: unknown[] = [];
      createAutosaver({
        subscribe: (l) => {
          store.listeners.add(l);
          return () => store.listeners.delete(l);
        },
        getState: () => store.state,
        serialize: (s) => JSON.stringify(s),
        save: () => Promise.reject(new Error('quota')),
        onError: (e) => errors.push(e),
        delayMs: 100,
      });
      store.bump();
      mock.timers.tick(100);
      return Promise.resolve().then(() => {
        assert.equal(errors.length, 1);
      });
    } finally {
      mock.timers.reset();
    }
  });
});
