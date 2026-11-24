import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserLabel, detectTv, keyKind, pickNext } from '../public/js/tv.js';

test('Settings names the TV browser engine', () => {
  assert.equal(browserLabel('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager'), 'LG webOS · Chrome 87');
  assert.equal(browserLabel('Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36'), 'Samsung Tizen 6.5 · Chrome 85');
});

test('remote buttons: LG has separate Play, Pause and Stop; others one play/pause button; Back on every brand', () => {
  const k = (keyCode, key = '') => keyKind({ keyCode, key });
  assert.equal(k(415), 'play', 'LG Play');
  assert.equal(k(19), 'pause', 'LG Pause');
  assert.equal(k(413), 'pause', 'LG Stop pauses');
  assert.equal(k(10252), 'playpause', 'Samsung play/pause');
  assert.equal(k(179, 'MediaPlayPause'), 'playpause');
  assert.equal(k(0, 'MediaPlay'), 'play');
  assert.equal(k(461), 'back', 'LG Back');
  assert.equal(k(10009), 'back', 'Samsung Return');
  assert.equal(k(0, 'GoBack'), 'back');
  assert.equal(k(417), 'forward');
  assert.equal(k(412), 'rewind');
  assert.equal(k(427), 'chup');
  assert.equal(k(37, 'ArrowLeft'), 'left');
  assert.equal(k(13, 'Enter'), 'ok');
  assert.equal(k(65, 'a'), '');
});

test('TV browsers switch TV mode on; phones and PCs do not; ?tv= and the saved choice win', () => {
  const tvs = [
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36',
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager',
    'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/STT1.211025.001.Z4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.3.1 like Chrome/120.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; Chromecast HD Build/RVC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 CrKey/1.56',
    'Mozilla/5.0 (Linux; VIDAA 7.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0 Safari/537.36',
  ];
  for (const ua of tvs) assert.equal(detectTv(ua, '', null), true, ua);
  const others = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  ];
  for (const ua of others) assert.equal(detectTv(ua, '', null), false, ua);
  assert.equal(detectTv(others[0], '?tv=1', null), true);
  assert.equal(detectTv(tvs[0], '?x=1&tv=0', '1'), false);
  assert.equal(detectTv(others[0], '', '1'), true, 'remembered from Settings or ?tv=1');
  assert.equal(detectTv(tvs[0], '', '0'), false, 'switched off on this TV');
});

const box = (left, top, width = 100, height = 50) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('the remote moves to the nearest thing in the pressed direction, straight ahead first', () => {
  // A row of cards with a button row underneath.
  const items = {
    a: box(0, 0), b: box(120, 0), c: box(240, 0),
    under: box(110, 100), farRight: box(400, 60),
  };
  const rects = Object.entries(items).map(([el, r]) => ({ el, r }));
  const others = (name) => rects.filter((x) => x.el !== name);
  assert.equal(pickNext(items.a, 'right', others('a')), 'b');
  assert.equal(pickNext(items.b, 'left', others('b')), 'a');
  assert.equal(pickNext(items.b, 'down', others('b')), 'under', 'straight below beats the diagonal');
  assert.equal(pickNext(items.under, 'up', others('under')), 'b');
  assert.equal(pickNext(items.a, 'up', others('a')), null, 'nothing above the top row');
  assert.equal(pickNext(items.c, 'right', others('c')), null, 'left/right never jump to another row');
  assert.equal(pickNext(box(300, 20), 'right', rects), 'farRight', 'but a taller neighbour on the same line counts');
  // A wide player with a row of small buttons right under it and a centred button further down.
  const player = box(0, 0, 800, 450);
  const below = [{ el: 'wide', r: box(500, 470, 120, 40) }, { el: 'servers', r: box(380, 600, 80, 40) }];
  assert.equal(pickNext(player, 'down', below), 'wide', 'the nearest row wins over a better-centred one further away');
});
