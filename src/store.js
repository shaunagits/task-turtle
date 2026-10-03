// Local-first task store. Every change lands in localStorage immediately,
// then gets queued for the server (if the person is signed in).

const KEY = 'tt.tasks.v1';
const QUEUE_KEY = 'tt.queue.v1';
const PURGE_AFTER_MS = 30 * 86400000;

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the session still works in memory */
  }
}

export const newId = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

let queue = new Set(read(QUEUE_KEY, []));
let tasks = read(KEY, []).filter(
  (t) => !(t.deleted && Date.now() - Date.parse(t.updatedAt) > PURGE_AFTER_MS && !queue.has(t.id)),
);

const listeners = new Set();
let syncHook = () => {};

export const getTasks = () => tasks;
export const subscribe = (fn) => listeners.add(fn);
export const setSyncHook = (fn) => { syncHook = fn; };

function emit() {
  write(KEY, tasks);
  listeners.forEach((fn) => fn());
}
function touch(id) {
  queue.add(id);
  write(QUEUE_KEY, [...queue]);
  syncHook();
}

export function addTask(p) {
  const now = new Date().toISOString();
  const t = {
    id: newId(),
    text: p.text,
    tags: p.tags,
    due: p.due,
    allDay: p.allDay,
    priority: p.priority,
    done: false,
    doneAt: null,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };
  tasks = [t, ...tasks];
  emit();
  touch(t.id);
  return t;
}

export function updateTask(id, patch) {
  let found = false;
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    found = true;
    return { ...t, ...patch, updatedAt: new Date().toISOString() };
  });
  if (found) {
    emit();
    touch(id);
  }
}

export function toggleDone(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  updateTask(id, { done: !t.done, doneAt: t.done ? null : new Date().toISOString() });
}
export const removeTask = (id) => updateTask(id, { deleted: true });
export const restoreTask = (id) => updateTask(id, { deleted: false });

// ---- Sync helpers ----
export const queuedIds = () => [...queue];
export function clearQueued(ids) {
  ids.forEach((id) => queue.delete(id));
  write(QUEUE_KEY, [...queue]);
}
export function queueAll() {
  tasks.forEach((t) => queue.add(t.id));
  write(QUEUE_KEY, [...queue]);
}
export function clearLocal() {
  tasks = [];
  queue = new Set();
  write(QUEUE_KEY, []);
  emit();
}

// Last write wins, by updatedAt.
export function mergeRemote(rows) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let changed = false;
  for (const row of rows) {
    const remote = fromRow(row);
    const local = byId.get(remote.id);
    if (!local || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt)) {
      byId.set(remote.id, remote);
      changed = true;
    }
  }
  if (changed) {
    tasks = [...byId.values()];
    emit();
  }
}

export const fromRow = (r) => ({
  id: r.id,
  text: r.text,
  tags: r.tags || [],
  due: r.due_at,
  allDay: r.all_day,
  priority: r.priority,
  done: r.done,
  doneAt: r.done_at,
  deleted: r.deleted,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toRow = (t, userId) => ({
  id: t.id,
  user_id: userId,
  text: t.text,
  tags: t.tags,
  due_at: t.due,
  all_day: !!t.allDay,
  priority: !!t.priority,
  done: !!t.done,
  done_at: t.doneAt,
  deleted: !!t.deleted,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
});
