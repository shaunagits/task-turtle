// Optional cloud sync. Without Supabase keys the app runs fully on-device.
import { createClient } from '@supabase/supabase-js';
import * as store from './store.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const OWNER_KEY = 'tt.owner.v1';

export const enabled = Boolean(url && key);
const sb = enabled ? createClient(url, key) : null;

let user = null;
let channel = null;
let status = 'local'; // local | syncing | synced | offline | error
let flushing = false;
const listeners = new Set();

export const getUser = () => user;
export const getStatus = () => status;
export const onChange = (fn) => listeners.add(fn);
function setStatus(s) {
  status = s;
  listeners.forEach((fn) => fn());
}

export async function init() {
  if (!sb) return;
  store.setSyncHook(() => flush());
  window.addEventListener('online', () => { pull(); flush(); });
  window.addEventListener('offline', () => user && setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull();
  });
  sb.auth.onAuthStateChange((_event, session) => {
    const next = session?.user ?? null;
    if ((next?.id ?? null) !== (user?.id ?? null)) setUser(next);
  });
  const { data } = await sb.auth.getSession();
  await setUser(data.session?.user ?? null);
}

async function setUser(next) {
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
  user = next;
  if (!user) {
    setStatus('local');
    return;
  }
  // First sign-in on this device: carry the guest's tasks into the account.
  let owner = null;
  try { owner = localStorage.getItem(OWNER_KEY); } catch {}
  if (owner !== user.id) {
    store.queueAll();
    try { localStorage.setItem(OWNER_KEY, user.id); } catch {}
  }
  await pull();
  await flush();
  channel = sb
    .channel(`tasks-${user.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${user.id}` },
      (payload) => payload.new?.id && store.mergeRemote([payload.new]),
    )
    .subscribe();
}

export async function pull() {
  if (!sb || !user || !navigator.onLine) return;
  const { data, error } = await sb.from('tasks').select('*');
  if (!error && data) store.mergeRemote(data);
}

export async function flush() {
  if (!sb || !user) return;
  if (!navigator.onLine) return setStatus('offline');
  if (flushing) return;
  const ids = store.queuedIds();
  if (!ids.length) return setStatus('synced');
  flushing = true;
  setStatus('syncing');
  const rows = store
    .getTasks()
    .filter((t) => ids.includes(t.id))
    .map((t) => store.toRow(t, user.id));
  const { error } = await sb.from('tasks').upsert(rows);
  flushing = false;
  if (error) {
    setStatus(navigator.onLine ? 'error' : 'offline');
    return;
  }
  store.clearQueued(ids);
  if (store.queuedIds().length) flush();
  else setStatus('synced');
}

export async function signIn(email) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  return error;
}

export async function signOut() {
  await flush();
  await sb.auth.signOut();
  try { localStorage.removeItem(OWNER_KEY); } catch {}
  // Keep a shared device clean: the account's tasks leave with the person.
  store.clearLocal();
}
