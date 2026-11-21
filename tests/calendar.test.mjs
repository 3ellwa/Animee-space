import test from 'node:test';
import assert from 'node:assert/strict';
import { showEvent, buildCalendar } from '../functions/_lib/calendar.js';

const onePiece = {
  id: '21', title: 'One Piece', status: 'RELEASING', duration: 24,
  broadcast: { day: 'Sundays', time: '23:15', timezone: 'Asia/Tokyo' },
  startDate: { year: 1999, month: 10, day: 20 },
};

test('an airing show becomes a weekly event at its Tokyo broadcast time', () => {
  const now = new Date('2026-11-21T12:00:00Z'); // a Saturday
  const lines = showEvent(onePiece, 'https://animee.space', now);
  assert.ok(lines.includes('RRULE:FREQ=WEEKLY;BYDAY=SU'));
  assert.ok(lines.includes('DURATION:PT24M'));
  // Four weeks back from Tokyo "today" (21 Nov) is 24 Oct; the first Sunday after that is 25 Oct.
  assert.ok(lines.includes('DTSTART;TZID=Asia/Tokyo:20261025T231500'));
  assert.ok(lines.some((l) => l.startsWith('URL:https://animee.space/anime/21')));
});

test('finished shows and shows without a slot are left out', () => {
  assert.equal(showEvent({ ...onePiece, status: 'FINISHED' }, 'https://x'), null);
  assert.equal(showEvent({ ...onePiece, broadcast: null }, 'https://x'), null);
  assert.equal(showEvent({ ...onePiece, status: 'NOT_YET_RELEASED', startDate: null }, 'https://x'), null);
});

test('the feed is valid iCalendar text with CRLF lines and escaped titles', () => {
  const ics = buildCalendar([{ ...onePiece, title: 'Re:Zero, Season 3; Part 2' }], 'https://animee.space', new Date('2026-11-21T12:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes(String.raw`SUMMARY:Re:Zero\, Season 3\; Part 2 · new episode`));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});
