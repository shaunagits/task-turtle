import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { parseInput, partialTagAt, formatDue, isOverdue, formatStamp, nowLabel, sameDay, MAX_LINES } from './parse.js';
import * as store from './store.js';
import * as sync from './sync.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const els = {
  now: $('#now'),
  trail: $('#trail'),
  trailLabel: $('#trail-label'),
  form: $('#task-form'),
  input: $('#task-input'),
  hint: $('#hint'),
  openList: $('#open-list'),
  doneList: $('#done-list'),
  openCount: $('#open-count'),
  doneCount: $('#done-count'),
  openEmpty: $('#open-empty'),
  doneEmpty: $('#done-empty'),
  tagBar: $('#tag-bar'),
  doneMore: $('#done-more'),
  account: $('#account'),
  toast: $('#toast'),
  srStatus: $('#sr-status'),
  palette: $('#palette'),
  paletteInput: $('#palette-input'),
  paletteList: $('#palette-list'),
  help: $('#help'),
};

const ui = {
  filter: null,
  expanded: null,
  selected: null,
  justAdded: null,
  lastDeleted: null,
  toastTimer: null,
  signIn: null, // null | 'form' | 'sent' | 'error'
  installPrompt: null,
  lastPct: null,
  doneLimit: 10,
};
const DONE_PAGE = 10;

if (!isMac) document.querySelectorAll('kbd.mod').forEach((k) => (k.textContent = 'Ctrl'));

// ---------- Derived data ----------
const live = () => store.getTasks().filter((t) => !t.deleted);
const visible = () => live().filter((t) => !ui.filter || t.tags.includes(ui.filter));
const byNewest = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
const openTasks = (list) => list.filter((t) => !t.done).sort((a, b) => b.priority - a.priority || byNewest(a, b));
const doneTasks = (list) =>
  list.filter((t) => t.done).sort((a, b) => Date.parse(b.doneAt || b.updatedAt) - Date.parse(a.doneAt || a.updatedAt));
const orderedIds = () => {
  const list = visible();
  return [...openTasks(list), ...doneTasks(list)].map((t) => t.id);
};
function allTags() {
  const counts = new Map();
  live().forEach((t) => t.tags.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
const announce = (msg) => {
  els.srStatus.textContent = '';
  requestAnimationFrame(() => (els.srStatus.textContent = msg));
};

// ---------- Rendering ----------
const X_ICON =
  '<svg width="10" height="10" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14"/></svg>';

function rowHTML(t) {
  const open = ui.expanded === t.id;
  const lines = t.text.split('\n');
  const first = esc(lines[0]);
  const classes = ['row', open && 'is-open', ui.selected === t.id && 'is-selected', ui.justAdded === t.id && 'is-new']
    .filter(Boolean)
    .join(' ');
  const tags = t.tags
    .map((g) => `<button type="button" class="chip" data-tag="${esc(g)}" aria-label="Show only @${esc(g)}">@${esc(g)}</button>`)
    .join('');
  const flag = t.priority && !t.done ? '<span class="flag" title="Priority" aria-label="Priority">!</span>' : '';
  const due = t.due
    ? `<span class="due${!t.done && isOverdue(t) ? ' overdue' : ''}" title="Due">${esc(formatDue(t))}</span>`
    : '';
  const body = open
    ? lines.map((l) => `<span class="line">${esc(l)}</span>`).join('') +
      `<span class="added">Added ${esc(formatStamp(t.createdAt))}</span>`
    : esc(lines.join('  ·  '));
  return `<li class="${classes}" data-id="${t.id}">
  <label class="check"><input type="checkbox"${t.done ? ' checked' : ''} aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${first}"></label>
  <div class="tags">${tags}</div>
  <button type="button" class="text" aria-expanded="${open}">${body}</button>
  <span class="meta">${flag}${due}<span class="stamp">${esc(formatStamp(t.createdAt))}</span></span>
  <button type="button" class="x" aria-label="Delete task: ${first}">${X_ICON}</button>
</li>`;
}

function render() {
  // Keep keyboard focus on the same control across re-renders.
  const active = document.activeElement;
  const activeRow = active?.closest?.('.row');
  const focusKey = activeRow ? [activeRow.dataset.id, active.className, active.tagName] : null;

  const list = visible();
  const open = openTasks(list);
  const done = doneTasks(list);
  els.openList.innerHTML = open.map(rowHTML).join('');
  els.doneList.innerHTML = done.slice(0, ui.doneLimit).map(rowHTML).join('');
  const hiddenDone = done.length - ui.doneLimit;
  els.doneMore.hidden = hiddenDone <= 0;
  els.doneMore.textContent = hiddenDone > 0 ? `Show ${Math.min(hiddenDone, DONE_PAGE)} more of ${hiddenDone}` : '';
  els.openCount.textContent = open.length ? `(${open.length})` : '';
  els.doneCount.textContent = done.length ? `(${done.length})` : '';
  els.openEmpty.hidden = open.length > 0;
  els.doneEmpty.hidden = done.length > 0;
  els.openEmpty.textContent = ui.filter ? `No open tasks in @${ui.filter}.` : 'Nothing on the list. Add a task above.';
  renderTagBar();

  if (focusKey) {
    const row = document.querySelector(`.row[data-id="${focusKey[0]}"]`);
    const target = row && [...row.querySelectorAll(focusKey[2])].find((el) => el.className === focusKey[1]);
    (target || row?.querySelector('.text'))?.focus({ preventScroll: true });
  }
  ui.justAdded = null;
  renderTrail();
}

function renderTagBar() {
  const tags = allTags();
  // A filter whose last task is gone quietly resets.
  if (ui.filter && !tags.some(([g]) => g === ui.filter)) ui.filter = null;
  if (!tags.length) {
    els.tagBar.innerHTML = '';
    return;
  }
  const openBy = new Map();
  live().forEach((t) => !t.done && t.tags.forEach((g) => openBy.set(g, (openBy.get(g) || 0) + 1)));
  const pill = (tag, label, n) =>
    `<button type="button" class="pill" data-filter="${esc(tag)}" aria-pressed="${ui.filter === (tag || null)}">${label}${
      n ? `<span class="n">${n}</span>` : ''
    }</button>`;
  const ordered = tags
    .map(([g]) => g)
    .sort((a, b) => (openBy.get(b) || 0) - (openBy.get(a) || 0) || a.localeCompare(b));
  els.tagBar.innerHTML = pill('', 'All') + ordered.map((g) => pill(g, `@${esc(g)}`, openBy.get(g) || 0)).join('');
}

function renderTrail() {
  const all = live();
  const now = new Date();
  const openCount = all.filter((t) => !t.done).length;
  const doneToday = all.filter((t) => t.done && t.doneAt && sameDay(t.doneAt, now)).length;
  const total = openCount + doneToday;
  const pct = total ? doneToday / total : 0;
  els.trail.style.setProperty('--pct', pct.toFixed(4));
  els.trail.setAttribute('aria-valuemax', String(total));
  els.trail.setAttribute('aria-valuenow', String(doneToday));
  els.trail.classList.toggle('is-complete', total > 0 && doneToday === total);
  if (ui.lastPct !== null && pct > ui.lastPct) {
    els.trail.classList.remove('is-walking');
    void els.trail.offsetWidth;
    els.trail.classList.add('is-walking');
  }
  ui.lastPct = pct;
  els.trailLabel.textContent =
    total === 0
      ? 'Add a task to start the walk.'
      : doneToday === total
        ? `All ${total} done today. Slow and steady.`
        : `${doneToday} of ${total} done today`;
}

function renderHint() {
  const v = els.input.value;
  const partial = partialTagAt(v, els.input.selectionStart);
  if (partial !== null) {
    const p = partial.toLowerCase();
    const matches = allTags()
      .map(([g]) => g)
      .filter((g) => g.startsWith(p) && g !== p)
      .slice(0, 6);
    els.hint.innerHTML = matches.length
      ? '<span>Projects:</span>' +
        matches.map((m) => `<button type="button" class="chip" data-suggest="${esc(m)}">@${esc(m)}</button>`).join('')
      : `<span>${p ? 'New project, keep typing' : 'Type a project name'}</span>`;
    return;
  }
  if (!v.trim()) {
    els.hint.innerHTML = '<span>Try: <em>Send invoice @clients fri 3pm !</em></span>';
    return;
  }
  const p = parseInput(v);
  const bits = p.tags.map((g) => `<span class="chip">@${esc(g)}</span>`);
  if (p.due) bits.push(`<span class="due">${esc(formatDue(p))}</span>`);
  if (p.priority) bits.push('<span class="flag" aria-hidden="true">!</span><span>Priority</span>');
  els.hint.innerHTML = bits.length
    ? '<span>Saves with</span>' + bits.join('')
    : '<span>Enter to add · Shift+Enter for a new line</span>';
}

function renderAccount() {
  if (!sync.enabled) {
    els.account.innerHTML = '<span>Your tasks are saved on this device.</span>';
    return;
  }
  const user = sync.getUser();
  if (user) {
    const s = sync.getStatus();
    const label = { syncing: 'Syncing', synced: 'Synced', offline: 'Offline, will sync when back', error: 'Sync paused' }[s] || 'Signed in';
    els.account.innerHTML = `<span class="dot ${s}" aria-hidden="true"></span><span>${label} · ${esc(user.email)}</span><span aria-hidden="true">·</span><button type="button" class="link" data-act="sign-out">Sign out</button>`;
    return;
  }
  if (ui.signIn === 'form' || ui.signIn === 'error') {
    els.account.innerHTML = `<form data-act="send-link"><label for="email" class="sr">Email</label><input id="email" type="email" required placeholder="you@example.com" autocomplete="email"><button class="go" type="submit">Send link</button></form>${
      ui.signIn === 'error' ? '<span>That did not go through. Try again in a minute.</span>' : ''
    }<button type="button" class="link" data-act="cancel-sign-in">Cancel</button>`;
    els.account.querySelector('input').focus();
    return;
  }
  if (ui.signIn === 'sent') {
    els.account.innerHTML = '<span>Check your email for a sign-in link.</span>';
    return;
  }
  els.account.innerHTML =
    '<span>Saved on this device.</span><button type="button" class="link" data-act="sign-in">Sign in to sync across devices</button>';
}

// ---------- Actions ----------
function addFromInput() {
  const p = parseInput(els.input.value);
  if (!p.text) {
    els.input.focus();
    return;
  }
  const t = store.addTask(p);
  ui.justAdded = t.id;
  if (ui.filter && !t.tags.includes(ui.filter)) ui.filter = null;
  els.input.value = '';
  autosize();
  renderHint();
  announce('Task added');
}

function toggle(id) {
  const t = store.getTasks().find((x) => x.id === id);
  if (!t) return;
  ui.expanded = null;
  store.toggleDone(id);
  announce(t.done ? 'Moved back to tasks' : 'Checked off');
}

function remove(id) {
  const ids = orderedIds();
  const i = ids.indexOf(id);
  if (ui.selected === id) ui.selected = ids[i + 1] || ids[i - 1] || null;
  if (ui.expanded === id) ui.expanded = null;
  store.removeTask(id);
  ui.lastDeleted = id;
  showToast('Task deleted', 'Undo', undoDelete);
}

function undoDelete() {
  if (!ui.lastDeleted) return;
  store.restoreTask(ui.lastDeleted);
  ui.selected = ui.lastDeleted;
  ui.lastDeleted = null;
  hideToast();
  announce('Task restored');
}

function setFilter(tag) {
  ui.filter = tag;
  ui.doneLimit = DONE_PAGE;
  ui.expanded = null;
  render();
  announce(tag ? `Showing @${tag}` : 'Showing all tasks');
}

function showToast(message, actionLabel, action) {
  clearTimeout(ui.toastTimer);
  els.toast.innerHTML = `<span>${esc(message)}</span><button type="button">${esc(actionLabel)}</button>`;
  els.toast.querySelector('button').onclick = action;
  els.toast.hidden = false;
  ui.toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() {
  clearTimeout(ui.toastTimer);
  els.toast.hidden = true;
}

function autosize() {
  const lines = Math.min(MAX_LINES, Math.max(1, els.input.value.split('\n').length));
  els.input.rows = lines;
}

// ---------- Composer events ----------
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  addFromInput();
});
els.input.addEventListener('input', () => {
  const lines = els.input.value.split('\n');
  if (lines.length > MAX_LINES) els.input.value = lines.slice(0, MAX_LINES).join('\n');
  autosize();
  renderHint();
});
['click', 'keyup', 'focus'].forEach((ev) => els.input.addEventListener(ev, renderHint));
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addFromInput();
  } else if (e.key === 'Enter' && els.input.value.split('\n').length >= MAX_LINES) {
    e.preventDefault();
  } else if (e.key === 'Escape') {
    if (els.input.value) els.input.value = '';
    else els.input.blur();
    autosize();
    renderHint();
  }
});
els.hint.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-suggest]')) e.preventDefault(); // keep the caret in the textarea
});
els.hint.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-suggest]');
  if (!chip) return;
  const caret = els.input.selectionStart;
  const before = els.input.value.slice(0, caret).replace(/@([A-Za-z0-9_-]*)$/, `@${chip.dataset.suggest} `);
  els.input.value = before + els.input.value.slice(caret);
  els.input.focus();
  els.input.setSelectionRange(before.length, before.length);
  renderHint();
});

// ---------- List events ----------
document.addEventListener('change', (e) => {
  if (e.target.matches('.row .check input')) toggle(e.target.closest('.row').dataset.id);
});
document.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (row) {
    const id = row.dataset.id;
    if (e.target.closest('.x')) return remove(id);
    const tag = e.target.closest('[data-tag]');
    if (tag) return setFilter(tag.dataset.tag);
    if (e.target.closest('.text')) {
      ui.expanded = ui.expanded === id ? null : id;
      ui.selected = id;
      return render();
    }
  }
  const pill = e.target.closest('[data-filter]');
  if (pill) return setFilter(pill.dataset.filter && pill.dataset.filter !== ui.filter ? pill.dataset.filter : null);
  if (e.target === els.doneMore) {
    ui.doneLimit += DONE_PAGE;
    return render();
  }
  if (act === 'sign-in') return ((ui.signIn = 'form'), renderAccount());
  if (act === 'cancel-sign-in') return ((ui.signIn = null), renderAccount());
  if (act === 'sign-out') return sync.signOut();
  // Tap anywhere else closes an expanded task.
  if (ui.expanded && !row) {
    ui.expanded = null;
    render();
  }
});
els.account.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = e.target.querySelector('input').value.trim();
  if (!email) return;
  const error = await sync.signIn(email);
  ui.signIn = error ? 'error' : 'sent';
  renderAccount();
});

// ---------- Keyboard ----------
document.addEventListener('pointerdown', () => document.body.classList.remove('kbd-nav'));

function moveSelection(delta) {
  document.body.classList.add('kbd-nav');
  const ids = orderedIds();
  if (!ids.length) return;
  const i = ids.indexOf(ui.selected);
  ui.selected = ids[Math.max(0, Math.min(ids.length - 1, i === -1 ? 0 : i + delta))];
  render();
  document.querySelector(`.row[data-id="${ui.selected}"]`)?.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return openPalette();
  }
  const typing = e.target.closest('input, textarea, [contenteditable]');
  if (typing || mod || e.altKey || document.querySelector('dialog[open]')) return;

  const sel = ui.selected && store.getTasks().find((t) => t.id === ui.selected && !t.deleted);
  switch (e.key) {
    case '/':
    case 'n':
      e.preventDefault();
      els.input.focus();
      break;
    case 'j':
    case 'ArrowDown':
      e.preventDefault();
      moveSelection(1);
      break;
    case 'k':
    case 'ArrowUp':
      e.preventDefault();
      moveSelection(-1);
      break;
    case 'x':
    case ' ':
      if (!sel || (e.key === ' ' && e.target.closest('button, a, label'))) return;
      e.preventDefault();
      toggle(sel.id);
      break;
    case 'Enter':
    case 'e':
      if (!sel || e.target.closest('button')) return;
      e.preventDefault();
      ui.expanded = ui.expanded === sel.id ? null : sel.id;
      render();
      break;
    case 'f':
      if (sel?.tags[0]) setFilter(sel.tags[0]);
      break;
    case 'Backspace':
    case 'Delete':
      if (!sel) return;
      e.preventDefault();
      remove(sel.id);
      break;
    case 'u':
      undoDelete();
      break;
    case '?':
      els.help.showModal();
      break;
    case 'Escape':
      if (ui.expanded) ui.expanded = null;
      else if (ui.selected) ui.selected = null;
      else if (ui.filter) ui.filter = null;
      render();
      break;
  }
});

// ---------- Command menu ----------
let paletteItems = [];
let paletteIndex = 0;

function commands() {
  const items = [{ label: 'New task', hint: '/', run: () => els.input.focus() }];
  if (ui.filter) items.push({ label: 'Show all projects', run: () => setFilter(null) });
  allTags().forEach(([g, n]) =>
    items.push({ label: `Show @${g}`, hint: `${n} task${n === 1 ? '' : 's'}`, run: () => setFilter(g) }),
  );
  if (ui.lastDeleted) items.push({ label: 'Undo delete', hint: 'u', run: undoDelete });
  items.push({ label: 'Keyboard shortcuts', hint: '?', run: () => els.help.showModal() });
  if (sync.enabled && !sync.getUser())
    items.push({ label: 'Sign in to sync', run: () => ((ui.signIn = 'form'), renderAccount()) });
  if (sync.getUser()) items.push({ label: 'Sign out', run: () => sync.signOut() });
  if (ui.installPrompt)
    items.push({
      label: 'Install Task Turtle as an app',
      run: async () => {
        ui.installPrompt.prompt();
        ui.installPrompt = null;
      },
    });
  return items;
}

function renderPalette() {
  const q = els.paletteInput.value.trim().toLowerCase().replace(/^@/, '');
  paletteItems = commands().filter((c) => c.label.toLowerCase().replace('@', '').includes(q));
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  els.paletteList.innerHTML = paletteItems.length
    ? paletteItems
        .map(
          (c, i) =>
            `<li role="option" id="cmd-${i}" data-i="${i}" aria-selected="${i === paletteIndex}"><span>${esc(c.label)}</span>${
              c.hint ? `<small>${esc(c.hint)}</small>` : ''
            }</li>`,
        )
        .join('')
    : '<li class="none">No matches</li>';
  els.paletteInput.setAttribute('aria-activedescendant', paletteItems.length ? `cmd-${paletteIndex}` : '');
}
function openPalette() {
  els.paletteInput.value = '';
  paletteIndex = 0;
  renderPalette();
  els.palette.showModal();
}
function runPalette(i) {
  const cmd = paletteItems[i];
  if (!cmd) return;
  els.palette.close();
  cmd.run();
}
els.paletteInput.addEventListener('input', () => {
  paletteIndex = 0;
  renderPalette();
});
els.paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = paletteItems.length;
    if (n) paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderPalette();
    els.paletteList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runPalette(paletteIndex);
  }
});
els.paletteList.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) runPalette(+li.dataset.i);
});
[els.palette, els.help].forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close(); // click on the backdrop
  }),
);

// ---------- Boot ----------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ui.installPrompt = e;
});

function tick() {
  els.now.textContent = nowLabel();
  els.now.dateTime = new Date().toISOString();
}
tick();
setInterval(() => {
  tick();
  render(); // keeps "Today", overdue states and the trail honest as time passes
}, 30000);

store.subscribe(render);
sync.onChange(renderAccount);
render();
renderHint();
renderAccount();
sync.init().then(renderAccount);
registerSW({ immediate: true });
