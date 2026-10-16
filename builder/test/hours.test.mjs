import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, isOpen, weekRows } from '../src/lib/hours.ts';

const at = (iso) => new Date(iso);

test('parses day ranges, lists and split hours', () => {
  const week = parseHours('Mo,Tu,Th,Fr 08:30-12:30,14:30-18:30; We 08:30-12:30; Sa 08:30-13:00; Su off');
  assert.deepEqual(week[0], [[510, 750], [870, 1110]]);
  assert.deepEqual(week[2], [[510, 750]]);
  assert.deepEqual(week[6], []);
});

test('later rules override earlier ones', () => {
  const week = parseHours('Mo-Su 10:00-20:00; Mo off');
  assert.deepEqual(week[0], []);
  assert.deepEqual(week[1], [[600, 1200]]);
});

test('rejects unparseable strings', () => {
  assert.equal(parseHours('nach Vereinbarung'), null);
  assert.equal(parseHours(''), null);
});

test('open now uses Berlin time', () => {
  const week = parseHours('Mo-Fr 06:00-18:00; Sa 06:00-16:00; Su 08:00-17:00');
  // 2026-10-16 is a Friday; 15:00 UTC = 17:00 CEST (open), 16:30 UTC = 18:30 CEST (closed)
  assert.equal(isOpen(week, at('2026-10-16T15:00:00Z')), true);
  assert.equal(isOpen(week, at('2026-10-16T16:30:00Z')), false);
  // Sunday 2026-10-18 07:30 CEST closed, 08:30 open
  assert.equal(isOpen(week, at('2026-10-18T05:30:00Z')), false);
  assert.equal(isOpen(week, at('2026-10-18T06:30:00Z')), true);
});

test('spans past midnight count on the next day', () => {
  const week = parseHours('Fr 18:00-02:00');
  assert.equal(isOpen(week, at('2026-10-16T23:00:00Z')), true); // Sat 01:00 CEST
  assert.equal(isOpen(week, at('2026-10-17T01:00:00Z')), false); // Sat 03:00 CEST
});

test('groups identical consecutive days', () => {
  const rows = weekRows(parseHours('Mo-Sa 07:00-22:00; Su off'), ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], 'geschlossen');
  assert.deepEqual(rows, [
    { days: 'Mo–Sa', hours: '07:00–22:00' },
    { days: 'So', hours: 'geschlossen' },
  ]);
});
