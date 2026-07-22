import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosaver, looksLikeLegacyProjectFile, sortByRecency, upsertIndexEntry } from './persistence.ts';
import type { ProjectIndexEntry } from './persistence.ts';

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

function entry(partial: Partial<ProjectIndexEntry> & { id: string }): ProjectIndexEntry {
  return { name: 'Untitled', savedAt: '2024-01-01T00:00:00Z', ...partial };
}

describe('looksLikeLegacyProjectFile', () => {
  it('is true for a serialized ProjectFile envelope', () => {
    assert.equal(
      looksLikeLegacyProjectFile('{"version":9,"savedAt":"2024-01-01T00:00:00Z","graph":{}}'),
      true,
    );
  });

  it('is false for a project id (this migration\'s own output — prevents a double-migration race)', () => {
    assert.equal(looksLikeLegacyProjectFile('9f4e9955-e3b9-42b9-9360-62159f4c23e2'), false);
  });

  it('is false for malformed JSON or JSON without a numeric version', () => {
    assert.equal(looksLikeLegacyProjectFile('not json'), false);
    assert.equal(looksLikeLegacyProjectFile('{"foo":"bar"}'), false);
    assert.equal(looksLikeLegacyProjectFile('{}'), false);
  });
});

describe('sortByRecency', () => {
  it('orders most-recently-saved first, without mutating the input', () => {
    const entries = [
      entry({ id: 'a', savedAt: '2024-01-01T00:00:00Z' }),
      entry({ id: 'b', savedAt: '2024-01-03T00:00:00Z' }),
      entry({ id: 'c', savedAt: '2024-01-02T00:00:00Z' }),
    ];
    const original = [...entries];
    assert.deepEqual(
      sortByRecency(entries).map((e) => e.id),
      ['b', 'c', 'a'],
    );
    assert.deepEqual(entries, original);
  });
});

describe('upsertIndexEntry', () => {
  it('appends a new entry defaulting name to Untitled', () => {
    const result = upsertIndexEntry([], { id: 'a', savedAt: '2024-01-01T00:00:00Z' });
    assert.deepEqual(result, [{ id: 'a', name: 'Untitled', savedAt: '2024-01-01T00:00:00Z' }]);
  });

  it('appends a new entry with an explicit name', () => {
    const result = upsertIndexEntry([], { id: 'a', name: 'Q4 plan', savedAt: '2024-01-01T00:00:00Z' });
    assert.deepEqual(result[0]!.name, 'Q4 plan');
  });

  it('updates savedAt in place for an existing id, keeping its name', () => {
    const entries = [entry({ id: 'a', name: 'Q4 plan', savedAt: '2024-01-01T00:00:00Z' })];
    const result = upsertIndexEntry(entries, { id: 'a', savedAt: '2024-01-02T00:00:00Z' });
    assert.deepEqual(result, [{ id: 'a', name: 'Q4 plan', savedAt: '2024-01-02T00:00:00Z' }]);
  });

  it('updates the name only when one is given, leaving other entries untouched', () => {
    const entries = [
      entry({ id: 'a', name: 'Old name', savedAt: '2024-01-01T00:00:00Z' }),
      entry({ id: 'b', name: 'Other', savedAt: '2024-01-01T00:00:00Z' }),
    ];
    const result = upsertIndexEntry(entries, { id: 'a', name: 'New name', savedAt: '2024-01-02T00:00:00Z' });
    assert.deepEqual(result[0], { id: 'a', name: 'New name', savedAt: '2024-01-02T00:00:00Z' });
    assert.deepEqual(result[1], entries[1]);
  });
});
