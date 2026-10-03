// Turns one line of natural typing into a structured task.
// "Send invoice @clients fri 3pm !"  ->  { text: "Send invoice", tags: ["clients"], due, allDay: false, priority: true }

const WEEKDAYS = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const PREPOSITIONS = new Set(['at', 'on', 'by', 'due']);
const TAG_RE = /^@([A-Za-z0-9_-]+)[.,;:!?]*$/;
export const MAX_LINES = 3;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function parseDateWord(w, now) {
  const today = startOfDay(now);
  if (w === 'today' || w === 'tod') return { date: today };
  if (w === 'tonight') return { date: today, tonight: true };
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') return { date: addDays(today, 1) };
  if (w in WEEKDAYS) {
    const diff = (WEEKDAYS[w] - today.getDay() + 7) % 7;
    return { date: addDays(today, diff) };
  }
  const m = w.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (m) {
    const month = +m[1] - 1, day = +m[2];
    if (month > 11 || day < 1 || day > 31) return null;
    let year = m[3] ? +m[3] : today.getFullYear();
    if (year < 100) year += 2000;
    let date = new Date(year, month, day);
    if (!m[3] && date < addDays(today, -1)) date = new Date(year + 1, month, day);
    return { date };
  }
  return null;
}

function parseTimeWord(w) {
  if (w === 'noon') return { h: 12, m: 0 };
  let m = w.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)$/);
  if (m) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    const pm = m[3].startsWith('p');
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return { h, m: min };
  }
  m = w.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m) return { h: +m[1], m: +m[2] };
  return null;
}

export function parseInput(raw, now = new Date()) {
  const tags = [];
  let priority = false;
  let date = null;
  let time = null;

  const lines = String(raw)
    .split('\n')
    .slice(0, MAX_LINES)
    .map((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      const keep = [];
      const dropPreposition = () => {
        if (keep.length && PREPOSITIONS.has(keep[keep.length - 1].toLowerCase())) keep.pop();
      };
      for (const w of words) {
        const tag = w.match(TAG_RE);
        if (tag) {
          const t = tag[1].toLowerCase();
          if (!tags.includes(t)) tags.push(t);
          continue;
        }
        if (/^!+$/.test(w)) { priority = true; continue; }
        const lw = w.toLowerCase().replace(/[.,;]$/, '');
        if (!date) {
          const d = parseDateWord(lw, now);
          if (d) { date = d; dropPreposition(); continue; }
        }
        if (!time) {
          const t = parseTimeWord(lw);
          if (t) { time = t; dropPreposition(); continue; }
        }
        keep.push(w);
      }
      return keep.join(' ');
    })
    .filter(Boolean);

  let due = null;
  let allDay = false;
  if (date || time) {
    const base = date ? new Date(date.date) : startOfDay(now);
    if (time) {
      base.setHours(time.h, time.m, 0, 0);
      // A bare time that has already passed today means tomorrow.
      if (!date && base < now) base.setDate(base.getDate() + 1);
    } else if (date.tonight) {
      base.setHours(20, 0, 0, 0);
    } else {
      allDay = true;
    }
    due = base.toISOString();
  }

  return { text: lines.join('\n'), tags, due, allDay, priority };
}

// The @word the caret is currently inside, or null.
export function partialTagAt(value, caret) {
  const m = value.slice(0, caret).match(/(^|\s)@([A-Za-z0-9_-]*)$/);
  return m ? m[2] : null;
}

const timeLabel = (d) =>
  d.getMinutes()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleTimeString('en-US', { hour: 'numeric' });

export function formatDue({ due, allDay }, now = new Date()) {
  if (!due) return '';
  const d = new Date(due);
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  let day;
  if (diff === 0) day = 'Today';
  else if (diff === 1) day = 'Tomorrow';
  else if (diff === -1) day = 'Yesterday';
  else if (diff > 1 && diff < 7) day = d.toLocaleDateString('en-US', { weekday: 'short' });
  else day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return allDay ? day : `${day} ${timeLabel(d)}`;
}

export function isOverdue({ due, allDay }, now = new Date()) {
  if (!due) return false;
  const d = new Date(due);
  return allDay ? addDays(startOfDay(d), 1) <= now : d < now;
}

export function formatStamp(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} ${date} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function nowLabel(d = new Date()) {
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return `${date} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export const sameDay = (a, b) => startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime();
