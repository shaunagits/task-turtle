import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, partialTagAt, formatDue, isOverdue } from '../src/parse.js';

// Friday, Oct 2 2026, 10:00 local
const NOW = new Date(2026, 9, 2, 10, 0);

test('plain text stays plain', () => {
  const p = parseInput('Call the dentist', NOW);
  assert.deepEqual(p, { text: 'Call the dentist', tags: [], due: null, allDay: false, priority: false });
});

test('tags anywhere, deduped, lowercased, punctuation trimmed', () => {
  const p = parseInput('Swap hero @Website and @urgent, @website', NOW);
  assert.equal(p.text, 'Swap hero and');
  assert.deepEqual(p.tags, ['website', 'urgent']);
});

test('weekday + time + priority', () => {
  const p = parseInput('Send invoice @clients fri 3pm !', NOW);
  assert.equal(p.text, 'Send invoice');
  assert.equal(p.priority, true);
  assert.equal(p.allDay, false);
  const d = new Date(p.due);
  assert.equal(d.getDate(), 2);
  assert.equal(d.getHours(), 15);
});

test('prepositions before dates are dropped', () => {
  const p = parseInput('Pay rent by tomorrow', NOW);
  assert.equal(p.text, 'Pay rent');
  assert.equal(p.allDay, true);
  assert.equal(new Date(p.due).getDate(), 3);
});

test('a time already passed today rolls to tomorrow', () => {
  const p = parseInput('Stretch at 9am', NOW);
  assert.equal(p.text, 'Stretch');
  assert.equal(new Date(p.due).getDate(), 3);
});

test('next weekday and numeric dates', () => {
  assert.equal(new Date(parseInput('x mon', NOW).due).getDate(), 5);
  const p = parseInput('Renew passport 1/15', NOW);
  assert.equal(new Date(p.due).getFullYear(), 2027);
});

test('multi-line keeps lines and limits to three', () => {
  const p = parseInput('a\nb @x\nc\nd', NOW);
  assert.equal(p.text, 'a\nb\nc');
});

test('words that only look like dates are kept', () => {
  assert.equal(parseInput("Draft today's post", NOW).text, "Draft today's post");
  assert.equal(parseInput('Wow!', NOW).priority, false);
});

test('partial tag detection at caret', () => {
  assert.equal(partialTagAt('Fix @we', 7), 'we');
  assert.equal(partialTagAt('Fix @', 5), '');
  assert.equal(partialTagAt('Fix it', 6), null);
  assert.equal(partialTagAt('email@test', 10), null);
});

test('due labels and overdue', () => {
  const today3 = { due: new Date(2026, 9, 2, 15).toISOString(), allDay: false };
  assert.equal(formatDue(today3, NOW), 'Today 3 PM');
  assert.equal(formatDue({ due: new Date(2026, 9, 3).toISOString(), allDay: true }, NOW), 'Tomorrow');
  assert.equal(isOverdue({ due: new Date(2026, 9, 2, 9).toISOString(), allDay: false }, NOW), true);
  assert.equal(isOverdue({ due: new Date(2026, 9, 2).toISOString(), allDay: true }, NOW), false);
});
