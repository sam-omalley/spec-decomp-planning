/**
 * Persistence: IndexedDB autosave plus the generic autosaver behind it.
 *
 * The stored value is the same versioned JSON envelope as .json files
 * (`serializeProject`), so loading from IndexedDB goes through the same
 * validation and migration path as opening a file.
 *
 * The autosaver is browser-free (save function injected) so its
 * debounce/dedupe behaviour is unit-testable under the Node runner.
 */

const DB_NAME = 'planning-tool';
const STORE_NAME = 'project';
const KEY = 'current';

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    };
  });
}

export function saveProjectText(text: string): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(text, KEY));
}

export function loadProjectText(): Promise<string | undefined> {
  return withStore<string | undefined>('readonly', (store) => store.get(KEY));
}

export interface AutosaverOptions<S> {
  subscribe: (listener: () => void) => () => void;
  getState: () => S;
  serialize: (state: S) => string;
  save: (text: string) => Promise<unknown>;
  delayMs?: number;
  onError?: (error: unknown) => void;
}

export interface AutosaveHandle {
  /** Saves now if the state changed since the last save. */
  flush: () => void;
  stop: () => void;
}

/**
 * Debounced autosave: every store notification arms a timer; the state
 * is serialized and saved once things settle. Dedupes by state
 * reference — immutable updates mean an unchanged reference is an
 * unchanged project.
 */
export function createAutosaver<S>(options: AutosaverOptions<S>): AutosaveHandle {
  const delay = options.delayMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved: S | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const state = options.getState();
    if (state === lastSaved) return;
    lastSaved = state;
    options.save(options.serialize(state)).catch(options.onError ?? (() => {}));
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };

  const unsubscribe = options.subscribe(schedule);
  return {
    flush,
    stop() {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    },
  };
}
