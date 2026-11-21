import test from 'node:test';
import assert from 'node:assert/strict';
import * as tmdb from '../functions/_lib/providers/tmdb.js';
import * as tvmaze from '../functions/_lib/providers/tvmaze.js';
import { buildCalendar } from '../functions/_lib/calendar.js';

const HOUR = 3600e3;

test('an episode dated today that airs tonight is not out yet, and gets its exact time', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const raw = { last_episode_to_air: { season_number: 2, episode_number: 5 } };
  const title = { availableEpisodes: 15, nextAiring: { airDate: '2026-11-29', season: 2, episode: 6 } };
  const times = { next: { season: 2, episode: 5, at: now + 9 * HOUR }, previous: null };
  tmdb.applyAirtimes(title, raw, times, now);
  assert.equal(title.availableEpisodes, 14);
  assert.deepEqual(title.nextAiring, { airDate: '2026-11-22', season: 2, episode: 5, airingAt: now + 9 * HOUR });
  // After it airs, nothing changes.
  const later = { availableEpisodes: 15, nextAiring: null };
  tmdb.applyAirtimes(later, raw, times, now + 10 * HOUR);
  assert.equal(later.availableEpisodes, 15);
  assert.equal(later.nextAiring, null);
});

test('TVmaze is asked by TVDB id once, then the show with its next episode; failures mean no time', async () => {
  tvmaze.resetCache();
  const asked = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    asked.push(u.pathname + u.search);
    if (u.pathname === '/lookup/shows') return Response.json({ id: 82 });
    if (u.pathname === '/shows/82') return Response.json({ id: 82, _embedded: { nextepisode: { season: 3, number: 1, airtime: '21:00', airstamp: '2999-01-01T02:00:00+00:00' } } });
    return new Response('', { status: 500 });
  };
  try {
    const raw = { id: 1399, external_ids: { tvdb_id: 121361, imdb_id: 'tt0944947' } };
    const first = await tvmaze.airtimes(raw);
    assert.deepEqual(first.next, { season: 3, episode: 1, at: Date.parse('2999-01-01T02:00:00Z') });
    await tvmaze.airtimes(raw);
    assert.deepEqual(asked, ['/lookup/shows?thetvdb=121361', '/shows/82?embed[]=nextepisode&embed[]=previousepisode']);
    tvmaze.resetCache();
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await tvmaze.airtimes(raw), null);
  } finally { globalThis.fetch = original; }
});

test('the day schedule matches shows by title and keeps the earliest time', async () => {
  tvmaze.resetCache();
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/schedule' && u.searchParams.get('country') === 'US') return Response.json([{ airtime: '21:00', airstamp: '2026-11-22T02:00:00+00:00', show: { name: 'The Last of Us' } }, { airtime: '', airstamp: '2026-11-21T00:00:00+00:00', show: { name: '名探偵コナン' } }]);
    return Response.json([{ airtime: '03:00', airstamp: '2026-11-22T08:00:00+00:00', _embedded: { show: { name: 'Andor' } } }]);
  };
  try {
    const times = await tvmaze.daySchedule('2026-11-21', ['US']);
    assert.equal(times.get(tvmaze.titleKey('The Last of Us')), Date.parse('2026-11-22T02:00:00Z'));
    assert.equal(times.get(tvmaze.titleKey('ANDOR')), Date.parse('2026-11-22T08:00:00Z'));
    assert.equal(times.has(''), false, 'titles without Latin letters never match everything');
  } finally { globalThis.fetch = original; }
});

test('the cinemee calendar gets one event per show at the next episode\'s real time', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const show = { id: '13992', title: 'Game of Thrones', status: 'RELEASING', duration: 60, nextAiring: { season: 3, episode: 1, airingAt: Date.parse('2026-11-23T02:00:00Z') } };
  const ics = buildCalendar([show], 'https://cinemee.animee.space', now);
  assert.match(ics, /X-WR-CALNAME:cinemee: my airing shows/);
  assert.match(ics, /DTSTART:20261123T020000Z/);
  assert.match(ics, /SUMMARY:Game of Thrones · S3 E1/);
  assert.match(ics, /UID:cinemee-13992-s3e1@animee\.space/);
});

test('OMDb scores come back clean, and nothing is asked without a key', async () => {
  const omdb = await import('../functions/_lib/providers/omdb.js');
  omdb.resetCache();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ Response: 'True', imdbRating: '8.8', imdbVotes: '2,400,000', Metascore: '67', Ratings: [{ Source: 'Rotten Tomatoes', Value: '79%' }] });
  };
  try {
    assert.equal(await omdb.ratings('tt0137523', ''), null);
    assert.equal(calls, 0);
    assert.deepEqual(await omdb.ratings('tt0137523', 'k'), { imdb: { score: 8.8, votes: 2400000 }, rottenTomatoes: '79%', metacritic: 67 });
    await omdb.ratings('tt0137523', 'k');
    assert.equal(calls, 1, 'kept for a day');
  } finally { globalThis.fetch = original; }
});
