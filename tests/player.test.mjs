import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../public/js/player.js';

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
