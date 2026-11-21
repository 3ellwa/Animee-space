import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanState, PartyRoom, handleParty } from '../functions/_lib/party.js';
import { digest, digestTime } from '../functions/_lib/push.js';
import { prefixesOf, rankClose, squash, containsQuery } from '../functions/_lib/fuzzy.js';
import * as tmdb from '../functions/_lib/providers/tmdb.js';

test('party state is cleaned: only sane show, episode and time numbers get through', () => {
  const s = cleanState({ show: '52991', ep: 3, t: 754.37, playing: 1 });
  assert.deepEqual({ ...s, at: 0 }, { show: '52991', ep: 3, t: 754.4, playing: true, at: 0 });
  assert.equal(cleanState({ show: 'x', ep: 3, t: 1 }), null);
  assert.equal(cleanState({ show: '1', ep: 0, t: 1 }), null);
  assert.equal(cleanState({ show: '1', ep: 1, t: -5 }), null);
});

// A tiny stand-in for the Durable Object state with hibernatable sockets.
function fakeRoom() {
  const sockets = [];
  const store = new Map();
  const state = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, setAlarm: async () => {}, deleteAll: async () => store.clear() },
    acceptWebSocket: (ws, tags) => { ws.tags = tags; sockets.push(ws); },
    getWebSockets: () => sockets,
    getTags: (ws) => ws.tags,
  };
  return { room: new PartyRoom(state), sockets, store };
}
const socket = () => ({ sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() {} });

test('the party room: the first host key becomes the host, only the host moves everyone, reactions are passed on', async () => {
  const { room, store } = fakeRoom();
  const host = socket(), guest = socket(), faker = socket();
  room.state.acceptWebSocket(host, ['host']);
  room.state.acceptWebSocket(guest, ['guest']);
  room.state.acceptWebSocket(faker, ['guest']);
  await room.webSocketMessage(host, JSON.stringify({ type: 'state', show: '5501', ep: 1, t: 100, playing: true }));
  assert.equal(guest.sent.at(-1).type, 'state');
  assert.equal(guest.sent.at(-1).state.t, 100);
  assert.equal(store.get('state').show, '5501');
  await room.webSocketMessage(faker, JSON.stringify({ type: 'state', show: '5501', ep: 9, t: 1, playing: true }));
  assert.equal(store.get('state').ep, 1, 'a guest cannot move the party');
  await room.webSocketMessage(guest, JSON.stringify({ type: 'react', emoji: '🔥' }));
  assert.deepEqual(host.sent.at(-1), { type: 'react', emoji: '🔥' });
  await room.webSocketMessage(guest, JSON.stringify({ type: 'react', emoji: '<script>' }));
  assert.deepEqual(host.sent.at(-1), { type: 'react', emoji: '🔥' }, 'only the listed reactions');
});

test('party requests need a good code, a WebSocket and the same origin', async () => {
  const env = { PARTY: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('room') }) } };
  const ws = (origin) => new Request('https://animee.space/api/party/ABC123/ws', { headers: { Upgrade: 'websocket', ...(origin ? { Origin: origin } : {}) } });
  assert.equal((await handleParty(ws(), env, 'abc', 'animee')).status, 400);
  assert.equal((await handleParty(new Request('https://animee.space/x'), env, 'ABC123', 'animee')).status, 426);
  assert.equal((await handleParty(ws('https://evil.example'), env, 'ABC123', 'animee')).status, 403);
  assert.equal(await (await handleParty(ws('https://animee.space'), env, 'ABC123', 'animee')).text(), 'room');
});

test('the weekly digest is one pop-up naming the shows, on Sunday evening UTC', () => {
  const items = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), ep: n, title: `Show ${n}` }));
  const [one] = digest(items);
  assert.equal(one.title, 'This week: 5 shows have new episodes');
  assert.match(one.body, /Show 1 \(ep 1\), Show 2 \(ep 2\), Show 3 \(ep 3\), Show 4 \(ep 4\) and 1 more/);
  assert.equal(digest(items.slice(0, 1)).length, 1);
  assert.equal(digestTime(new Date('2026-11-22T17:00:00Z')), true);
  assert.equal(digestTime(new Date('2026-11-22T17:10:00Z')), false);
  assert.equal(digestTime(new Date('2026-11-23T17:00:00Z')), false);
});

test('fuzzy helpers: punctuation is ignored and typos still find the title', () => {
  assert.equal(squash('Re:ZERO -Starting Life-'), 're zero starting life');
  assert.ok(containsQuery(['Re:Zero'], 're zero'));
  assert.deepEqual(prefixesOf('intersteller'), ['inte', 'int']);
  const pool = [{ title: 'Interstellar', popularity: 5 }, { title: 'Inception', popularity: 9 }];
  assert.deepEqual(rankClose('intersteller', pool, (t) => [t.title]).map((t) => t.title), ['Interstellar']);
});

test('cinemee search puts close matches first when the query is misspelled', async () => {
  tmdb.resetCache();
  tmdb.useToken({ TMDB_TOKEN: 't' });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const q = new URL(String(url)).searchParams.get('query');
    if (q === 'intersteller' || q === 'inte') return Response.json({ page: 1, total_pages: 1, total_results: 0, results: [] });
    return Response.json({ page: 1, total_pages: 1, total_results: 2, results: [
      { id: 157336, media_type: 'movie', title: 'Interstellar', release_date: '2014-11-05', genre_ids: [878] },
      { id: 27205, media_type: 'movie', title: 'Inception', release_date: '2010-07-15', genre_ids: [878] },
    ] });
  };
  try {
    const r = await tmdb.searchAnime({ query: 'intersteller' });
    assert.equal(r.results[0].title, 'Interstellar');
    assert.equal(r.approximate, true);
  } finally { globalThis.fetch = original; }
});
