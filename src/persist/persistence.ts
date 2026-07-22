/**
 * Persistence: IndexedDB autosave plus the generic autosaver behind it.
 *
 * The stored value is the same versioned JSON envelope as .json files
 * (`serializeProject`), so loading from IndexedDB goes through the same
 * validation and migration path as opening a file.
 *
 * The autosaver is browser-free (save function injected) so its
 * debounce/dedupe behaviour is unit-testable under the Node runner.
 *
 * Local storage holds any number of projects (#134), each keyed by id
 * rather than the single fixed slot earlier versions used:
 * - `project:<id>` — that project's content (same JSON envelope as before).
 * - `index` — a `ProjectIndexEntry[]` of every known project (id/name/
 *   savedAt), maintained alongside content saves/renames/deletes.
 * - `current` — the id of the last-open project, so startup stays one
 *   lookup (`resolveStartupProject`) instead of scanning the index.
 */

const DB_NAME = 'planning-tool';
const STORE_NAME = 'project';
const CURRENT_KEY = 'current';
const INDEX_KEY = 'index';
/** A slot for an autosave that failed to load (corrupt, or from an
 *  unsupported version) — separate from `current` so it survives once the
 *  app falls back to an empty project and the next edit's autosave
 *  overwrites `current`; see `saveUnrecoveredText` below. */
const UNRECOVERED_KEY = 'unrecovered';

function projectKey(id: string): string {
  return `project:${id}`;
}

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

export function createProjectId(): string {
  return crypto.randomUUID();
}

export interface ProjectIndexEntry {
  id: string;
  name: string;
  /** ISO timestamp of the last content save. */
  savedAt: string;
}

/** Most-recently-saved first — the order the switcher lists projects in. */
export function sortByRecency(entries: readonly ProjectIndexEntry[]): ProjectIndexEntry[] {
  return [...entries].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Upserts `patch` into `entries` by id: updates `savedAt` (and `name` when
 *  given) in place if the id is already present, else appends a new entry
 *  defaulting `name` to 'Untitled'. Pure, so the merge logic is
 *  unit-testable without a real IndexedDB. */
export function upsertIndexEntry(
  entries: readonly ProjectIndexEntry[],
  patch: { id: string; name?: string; savedAt: string },
): ProjectIndexEntry[] {
  const i = entries.findIndex((e) => e.id === patch.id);
  if (i === -1) {
    return [...entries, { id: patch.id, name: patch.name ?? 'Untitled', savedAt: patch.savedAt }];
  }
  const next = [...entries];
  next[i] = { ...next[i]!, savedAt: patch.savedAt, ...(patch.name !== undefined ? { name: patch.name } : {}) };
  return next;
}

function readIndex(): Promise<ProjectIndexEntry[]> {
  return withStore<ProjectIndexEntry[] | undefined>('readonly', (store) => store.get(INDEX_KEY)).then(
    (raw) => (Array.isArray(raw) ? raw : []),
  );
}

function writeIndex(entries: ProjectIndexEntry[]): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(entries, INDEX_KEY));
}

/** Every known project, most-recently-saved first. */
export async function listProjects(): Promise<ProjectIndexEntry[]> {
  return sortByRecency(await readIndex());
}

export function loadCurrentProjectId(): Promise<string | undefined> {
  return withStore<string | undefined>('readonly', (store) => store.get(CURRENT_KEY));
}

export function setCurrentProjectId(id: string): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(id, CURRENT_KEY));
}

export function loadProjectText(id: string): Promise<string | undefined> {
  return withStore<string | undefined>('readonly', (store) => store.get(projectKey(id)));
}

/** Saves a project's content and keeps its index entry's `savedAt` current
 *  — creating the entry (named 'Untitled') the first time a given id is
 *  saved. */
export async function saveProjectText(id: string, text: string): Promise<void> {
  await withStore('readwrite', (store) => store.put(text, projectKey(id)));
  const entries = upsertIndexEntry(await readIndex(), { id, savedAt: new Date().toISOString() });
  await writeIndex(entries);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const entries = await readIndex();
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) return;
  entries[i] = { ...entries[i]!, name };
  await writeIndex(entries);
}

/** Drops a project's content and its index entry. Does not touch `current`
 *  — a caller deleting the active project must repoint it itself. */
export async function deleteProject(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(projectKey(id)));
  await writeIndex((await readIndex()).filter((e) => e.id !== id));
}

/**
 * One-time migration from the pre-#134 single-project format, where
 * `current` held the raw project JSON directly rather than an id. Only
 * ever does something on the first load after upgrading: once any project
 * exists in the index, every future call is a no-op (by construction,
 * `current` only ever holds a real id from that point on).
 */
/** True for a legacy pre-#134 `current` value (a serialized `ProjectFile`
 *  envelope) — false for a project id (this migration's own output), so a
 *  second, racing run (e.g. two tabs open on the first load after
 *  upgrading) can't mistake an already-migrated `current` for content and
 *  wrap it in a second, corrupt "project" whose content is just an id. */
export function looksLikeLegacyProjectFile(value: string): boolean {
  if (!value.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { version?: unknown }).version === 'number'
    );
  } catch {
    return false;
  }
}

async function migrateLegacyIfNeeded(): Promise<void> {
  if ((await readIndex()).length > 0) return;
  const legacyValue = await withStore<string | undefined>('readonly', (store) => store.get(CURRENT_KEY));
  if (legacyValue === undefined || !looksLikeLegacyProjectFile(legacyValue)) return;
  const id = createProjectId();
  await withStore('readwrite', (store) => store.put(legacyValue, projectKey(id)));
  await writeIndex([{ id, name: 'My project', savedAt: new Date().toISOString() }]);
  await withStore('readwrite', (store) => store.put(id, CURRENT_KEY));
}

/**
 * Resolves what to load at startup: runs the legacy migration if needed,
 * then reads `current` and its content. Null means "start from an empty
 * project" — either a genuinely fresh install, or (defensively) a `current`
 * pointer with no matching content.
 */
export async function resolveStartupProject(): Promise<{ id: string; text: string } | null> {
  await migrateLegacyIfNeeded();
  const id = await loadCurrentProjectId();
  if (id === undefined) return null;
  const text = await loadProjectText(id);
  if (text === undefined) return null;
  return { id, text };
}

/**
 * Backs up an autosave that failed to load, so a deserialize failure never
 * silently discards the user's data — the app falls back to an empty
 * project, but the raw text lives on here until explicitly recovered or
 * discarded (`loadUnrecoveredText` / `clearUnrecoveredText`).
 */
export function saveUnrecoveredText(text: string): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(text, UNRECOVERED_KEY));
}

export function loadUnrecoveredText(): Promise<string | undefined> {
  return withStore<string | undefined>('readonly', (store) => store.get(UNRECOVERED_KEY));
}

export function clearUnrecoveredText(): Promise<unknown> {
  return withStore('readwrite', (store) => store.delete(UNRECOVERED_KEY));
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
