import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player, sandboxFor, referrerPolicyFor } from '../public/js/player.js';

test('only players that still play sandboxed get the no-popups sandbox', () => {
  for (const src of ['https://vidnext.pro/movie/1', 'https://vidcore.org/embed/movie/1', 'https://aniembed.se/e/1/1', 'https://vipserver.liiivideo.com/embed-abc123.html']) {
    const sandbox = sandboxFor(src);
    assert.match(sandbox, /allow-scripts/);
    assert.doesNotMatch(sandbox, /allow-popups|allow-top-navigation/);
  }
  for (const src of ['https://vidfast.vc/movie/1', 'https://vidlink.pro/movie/1', 'https://megaplay.buzz/x', 'https://evil.vidnext.pro.example/x', 'not a url']) {
    assert.equal(sandboxFor(src), '', src);
  }
});

test('Altair (Vipserver) frames send no referrer, others keep the default', () => {
  assert.equal(referrerPolicyFor('https://vipserver.liiivideo.com/embed-abc123.html'), 'no-referrer');
  for (const src of ['https://vidnext.pro/movie/1', 'https://vipserver.liiivideo.com.evil.example/x', 'not a url']) assert.equal(referrerPolicyFor(src), '', src);
});

function fakePlayer() {
  const progress = [];
  const state = {
    embedOrigin: 'https://tryembed.us.cc',
    iframe: { contentWindow: {} },
    embedTime: 0,
    embedLastSave: 0,
    meta: { ep: 3 },
    nextBtn: { hidden: true },
    opts: { onProgress: value => progress.push(value), hasNext: () => true, onEnded: () => { state.ended = true; } },
    started: false,
    ended: false,
    markStarted() { this.started = true; },
    fail(message) { this.failure = message; },
    progress,
  };
  Object.setPrototypeOf(state, Player.prototype);
  return state;
}

test('TryEmbed PLAYER_EVENT updates progress through the existing player callbacks', () => {
  const player = fakePlayer();
  player.handleEmbedMessage({
    origin: 'https://tryembed.us.cc',
    source: player.iframe.contentWindow,
    data: { type: 'PLAYER_EVENT', event: 'timeupdate', data: { currentTime: 42, duration: 120 } },
  });
  assert.equal(player.started, true);
  assert.equal(player.embedTime, 42);
  assert.equal(player.progress.length, 1);
  assert.deepEqual(player.progress[0], { time: 42, duration: 120, ep: 3 });
});

test('TryEmbed completion triggers Animee next-episode handling', () => {
  const player = fakePlayer();
  player.handleEmbedMessage({
    origin: 'https://tryembed.us.cc',
    source: player.iframe.contentWindow,
    data: { type: 'PLAYER_EVENT', event: 'ended', data: { currentTime: 120, duration: 120 } },
  });
  assert.equal(player.ended, true);
  assert.equal(player.nextBtn.hidden, false);
  assert.equal(player.embedTime, 120);
});

test('embedded progress messages are rejected from other origins or iframe windows', () => {
  const player = fakePlayer();
  const message = { type: 'PLAYER_EVENT', event: 'timeupdate', data: { currentTime: 50, duration: 120 } };
  player.handleEmbedMessage({ origin: 'https://evil.example', source: player.iframe.contentWindow, data: message });
  player.handleEmbedMessage({ origin: 'https://tryembed.us.cc', source: {}, data: message });
  assert.equal(player.embedTime, 0);
  assert.equal(player.progress.length, 0);
});

test('vidnext-style messages (source: vidnest-player) update progress and end the episode', () => {
  const player = fakePlayer();
  player.embedOrigin = 'https://vidnext.pro';
  player.handleEmbedMessage({
    origin: 'https://vidnext.pro',
    source: player.iframe.contentWindow,
    data: { source: 'vidnest-player', event: 'timeupdate', currentTime: 75, duration: 2700, percentage: 2.7 },
  });
  assert.equal(player.started, true);
  assert.equal(player.embedTime, 75);
  assert.deepEqual(player.progress[0], { time: 75, duration: 2700, ep: 3 });
  player.handleEmbedMessage({
    origin: 'https://vidnext.pro',
    source: player.iframe.contentWindow,
    data: { source: 'vidnest-player', event: 'ended', currentTime: 2700, duration: 2700 },
  });
  assert.equal(player.ended, true);
});

test('watch party: a host pause pauses guests whose server can be paused, and reports when it can not', () => {
  // cinemee's 3ellwa (vidnext): told to pause once it reports playing, then not told again.
  const player = fakePlayer();
  const sent = [];
  player.embedOrigin = 'https://vidnext.pro';
  player.iframe = { hidden: false, contentWindow: { postMessage: (m) => sent.push(m) } };
  player.handleEmbedMessage({ origin: 'https://vidnext.pro', source: player.iframe.contentWindow, data: { source: 'vidnest-player', event: 'timeupdate', currentTime: 30, duration: 2700 } });
  assert.equal(player.isPausedHere(), false);
  assert.equal(player.partyPause(true), true);
  assert.deepEqual(sent, [{ action: 'pause' }]);
  player.handleEmbedMessage({ origin: 'https://vidnext.pro', source: player.iframe.contentWindow, data: { source: 'vidnest-player', event: 'pause', currentTime: 30, duration: 2700 } });
  assert.equal(player.partyPause(true), true);
  assert.equal(sent.length, 1, 'already paused: nothing more is sent');

  // TryEmbed takes no commands: the caller must not keep seeking the guest back.
  const other = fakePlayer();
  other.iframe = { hidden: false, contentWindow: { postMessage: () => assert.fail('nothing to send') } };
  assert.equal(other.partyPause(true), false);
});
