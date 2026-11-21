// Provider playback supports native HLS/MP4 sources and third-party iframe players.

// hls.js is only needed for HLS sources, so it is fetched on first use instead of on every page.
// Keep the URL and hash in sync with the CSP in worker.js.
const HLS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.min.js';
const HLS_SRI = 'sha384-p9vgU/7IYJWd3I4STrtqxqR/2cAQlhIX7D/HrTnIMEjjcUox165b7se7sxmm3zDg';
let hlsLoading = null;
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoading) {
    hlsLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HLS_SRC;
      script.integrity = HLS_SRI;
      script.crossOrigin = 'anonymous';
      script.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js did not load')));
      script.onerror = () => reject(new Error('hls.js could not be downloaded'));
      document.head.appendChild(script);
    }).catch((error) => { hlsLoading = null; throw error; });
  }
  return hlsLoading;
}

const IFRAME_HTML = '<iframe class="embed-frame" title="Anime episode player" ' +
  'allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen webkitallowfullscreen mozallowfullscreen ' +
  'referrerpolicy="strict-origin-when-cross-origin" hidden></iframe>';

export class Player {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.hls = null;
    this.data = null;
    this.lastSave = 0;
    this.embedTime = 0;
    this.embedLastSave = 0;
    this.embedOrigin = null;

    root.innerHTML = '<div class="player">' +
      '<video playsinline controls preload="metadata"></video>' +
      IFRAME_HTML +
      '<button class="pl-btn next" type="button" hidden>Next episode ▶</button>' +
      '<div class="pl-msg" hidden></div>' +
      '<div class="pl-upnext" hidden role="status" aria-live="polite"></div>' +
      '</div><div class="player-tools"><button class="btn sm fullscreen" type="button" hidden>Fullscreen ⛶</button></div>';
    this.video = root.querySelector('video');
    this.iframe = root.querySelector('iframe');
    this.fullscreenBtn = root.querySelector('.fullscreen');
    this.nextBtn = root.querySelector('.next');
    this.msgEl = root.querySelector('.pl-msg');
    this.upNextEl = root.querySelector('.pl-upnext');

    this.fullscreenBtn.onclick = () => this.enterFullscreen();
    this.nextBtn.onclick = () => this.opts.onNext?.();
    this.onMessage = event => this.handleEmbedMessage(event);
    window.addEventListener('message', this.onMessage);
    this.onEnd = () => {
      this.save(true);
      this.opts.onEnded?.();
    };
    this.onTime = () => this.tick();
    this.video.addEventListener('timeupdate', this.onTime);
    this.video.addEventListener('ended', this.onEnd);
    this.video.addEventListener('pause', () => { this.save(true); this.opts.onPause?.(); });
    const started = () => { if (this.busyShown) this.msg(''); };
    this.video.addEventListener('playing', () => this.markStarted());
    this.video.addEventListener('loadeddata', started);
    this.video.addEventListener('playing', started);
  }

  // Changing an existing iframe's src adds an entry to the tab's history, so Back would step
  // through old players instead of leaving the page. A newly inserted iframe's first load
  // does not, so every source gets a brand-new frame.
  freshIframe(src) {
    const template = document.createElement('template');
    template.innerHTML = IFRAME_HTML;
    const frame = template.content.firstElementChild;
    if (src) {
      frame.src = src;
      frame.hidden = false;
      frame.onload = () => this.msg('');
      // A frame that never finishes loading counts as a failed server.
      const token = this.loadToken;
      clearTimeout(this.frameTimer);
      this.frameTimer = setTimeout(() => {
        if (token === this.loadToken && this.busyShown) this.fail('The player did not load.');
      }, 20000);
    }
    this.iframe.replaceWith(frame);
    this.iframe = frame;
  }

  msg(message) {
    this.busyShown = false;
    this.msgEl.classList.remove('busy');
    this.msgEl.textContent = message;
    this.msgEl.hidden = !message;
  }

  // Spinner over the player while a server is found and the video starts.
  busy(text = 'Loading episode…') {
    this.msgEl.innerHTML = '<span class="pl-spin" aria-hidden="true"></span><span></span>';
    this.msgEl.lastElementChild.textContent = text;
    this.msgEl.classList.add('busy');
    this.msgEl.hidden = false;
    this.busyShown = true;
  }

  // Called once per source when the video really starts playing.
  markStarted() {
    if (this.startedToken === this.loadToken) return;
    this.startedToken = this.loadToken;
    this.opts.onStarted?.();
  }

  // "Up next" card with a countdown when an episode ends. Play now / Cancel; the countdown
  // pauses while the tab is hidden so nobody comes back three episodes later.
  upNext({ title, label, seconds = 5, onGo }) {
    if (!this.upNextEl.hidden) return; // the embed can report "complete" more than once
    const el = this.upNextEl;
    el.innerHTML = '<div class="un-card"><span class="un-kicker">Up next</span><b class="un-title"></b>' +
      '<span class="un-label"></span><div class="un-bar"><i></i></div>' +
      '<div class="un-actions"><button class="btn sm primary un-go" type="button"></button>' +
      '<button class="btn sm un-cancel" type="button">Cancel</button></div></div>';
    el.querySelector('.un-title').textContent = title;
    el.querySelector('.un-label').textContent = label || '';
    const go = el.querySelector('.un-go');
    const bar = el.querySelector('.un-bar i');
    el.hidden = false;
    let left = seconds * 10; // tenths of a second
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      left--;
      go.textContent = `▶ Play now (${Math.ceil(left / 10)})`;
      bar.style.width = `${100 - (left / (seconds * 10)) * 100}%`;
      if (left <= 0) { this.cancelUpNext(); onGo(); }
    };
    go.textContent = `▶ Play now (${seconds})`;
    this.upNextTimer = setInterval(tick, 100);
    go.onclick = () => { this.cancelUpNext(); onGo(); };
    el.querySelector('.un-cancel').onclick = () => {
      this.cancelUpNext();
      this.nextBtn.hidden = !this.opts.hasNext?.();
    };
    go.focus({ preventScroll: true });
  }

  cancelUpNext() {
    clearInterval(this.upNextTimer);
    this.upNextTimer = null;
    if (this.upNextEl) { this.upNextEl.hidden = true; this.upNextEl.innerHTML = ''; }
  }

  // Playback failed: let the page try another server; show the message only if it can't.
  fail(message) {
    clearTimeout(this.frameTimer);
    if (this.opts.onFail?.(message)) return;
    this.msg(message);
  }

  reset() {
    this.save(true);
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.video.pause();
    this.video.querySelectorAll('track').forEach(track => track.remove());
    this.video.removeAttribute('src');
    this.video.load();
    this.fullscreenBtn.hidden = true;
    this.nextBtn.hidden = true;
    this.msg('');
    this.cancelUpNext();
    clearTimeout(this.frameTimer);
    this.loadToken = (this.loadToken || 0) + 1;
    this.freshIframe();
    this.video.hidden = false;
    this.embedTime = 0;
    this.embedLastSave = 0;
    this.embedOrigin = null;
  }

  load(data, { startAt = 0, meta = {} } = {}) {
    this.reset();
    this.data = data;
    this.meta = meta;
    if (data.embedUrl) {
      this.video.hidden = true;
      this.iframe.hidden = false;
      this.fullscreenBtn.hidden = false;
      this.embedOrigin = data.embedOrigin || new URL(data.embedUrl).origin;
      let embedUrl = data.embedUrl;
      if (['vidnest', 'tryembed'].includes(data.provider) && Number.isFinite(Number(startAt)) && startAt > 5) {
        const target = new URL(embedUrl);
        target.searchParams.set('startAt', String(Math.floor(startAt)));
        if (data.provider === 'tryembed') target.searchParams.set('autoNext', 'false');
        embedUrl = target.toString();
      } else if (data.provider === 'tryembed') {
        const target = new URL(embedUrl);
        target.searchParams.set('autoNext', 'false');
        embedUrl = target.toString();
      }
      this.busy();
      this.freshIframe(embedUrl);
      return;
    }
    const source = (data.sources || [])[0];
    if (!source) return this.fail('No video source for this episode.');
    const video = this.video;
    for (const track of data.tracks || []) {
      const element = document.createElement('track');
      element.kind = 'subtitles';
      element.label = track.label || track.lang;
      element.srclang = track.lang || 'und';
      element.src = track.url;
      if (track.default) element.default = true;
      video.appendChild(element);
    }
    const start = () => {
      if (startAt > 5 && (!video.duration || startAt < video.duration - 15)) video.currentTime = startAt;
      video.play().catch(() => {});
    };
    if (source.type === 'hls' && !window.Hls) {
      const token = this.loadToken;
      this.busy();
      loadHls()
        .catch(() => null)
        .then(() => { if (token === this.loadToken) this.attachSource(source, start); });
      return;
    }
    this.busy();
    this.attachSource(source, start);
  }

  attachSource(source, start) {
    const video = this.video;
    const Hls = window.Hls;
    if (source.type === 'hls' && Hls && Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30 });
      this.hls = hls;
      hls.loadSource(source.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, start);
      hls.on(Hls.Events.ERROR, (_event, detail) => {
        if (!detail.fatal) return;
        if (detail.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (detail.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else this.fail('Playback error. Try another server.');
      });
    } else if (source.type !== 'hls' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source.url;
      video.addEventListener('loadedmetadata', start, { once: true });
      video.addEventListener('error', () => this.fail('This stream failed to load. Try another server.'), { once: true });
    } else {
      this.fail('Your browser can’t play this stream.');
    }
  }

  async enterFullscreen() {
    const target = this.root.querySelector('.player');
    try {
      if (target?.requestFullscreen) await target.requestFullscreen();
      else if (this.iframe.requestFullscreen) await this.iframe.requestFullscreen();
      else this.msg('Use the fullscreen control inside the embedded player.');
    } catch {
      this.msg('Fullscreen was blocked. Use the embedded player controls if available.');
    }
  }

  handleEmbedMessage(event) {
    if (!this.embedOrigin || event.origin !== this.embedOrigin || event.source !== this.iframe.contentWindow) return;
    let data = event.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return; }
    }
    if (!data || typeof data !== 'object') return;
    if (data.channel && data.channel !== 'megacloud') return;

    // TryEmbed documents PLAYER_EVENT messages with playback state nested in `data`.
    // Keep the strict origin + iframe-window checks above before accepting any message.
    if (data.type === 'PLAYER_EVENT') {
      const state = data.data && typeof data.data === 'object' ? data.data : data;
      const eventName = String(data.event || state.event || data.name || '').toLowerCase();
      const currentTime = Number(state.currentTime ?? state.current_time ?? state.time);
      const duration = Number(state.duration);
      if (eventName === 'play' || eventName === 'timeupdate' || eventName === 'seeked' || currentTime > 0) this.markStarted();
      if (Number.isFinite(currentTime) && currentTime >= 0) {
        this.embedTime = currentTime;
        if (eventName === 'timeupdate' || eventName === 'seeked' || eventName === 'pause') this.saveEmbed(false, Number.isFinite(duration) ? duration : 0);
      }
      if (eventName === 'ended' || eventName === 'complete') {
        this.embedTime = Number.isFinite(duration) && duration > 0 ? duration : this.embedTime;
        this.saveEmbed(true, Number.isFinite(duration) ? duration : 0);
        this.nextBtn.hidden = !this.opts.hasNext?.();
        this.opts.onEnded?.();
      }
      if (eventName === 'error') this.fail('The embedded player reported a playback error. Try another server.');
      return;
    }

    if ((data.event === 'time' && Number(data.time) > 0) || (data.type === 'watching-log' && Number(data.currentTime) > 0)) this.markStarted();
    if (data.event === 'time' && Number.isFinite(Number(data.time))) {
      this.embedTime = Math.max(0, Number(data.time));
      this.saveEmbed(false, Number(data.duration) || 0);
    }
    if (data.type === 'watching-log' && Number.isFinite(Number(data.currentTime))) {
      this.embedTime = Math.max(0, Number(data.currentTime));
      this.saveEmbed(false, Number(data.duration) || 0);
    }
    if (data.event === 'complete') {
      this.embedTime = Number(data.duration) || this.embedTime;
      this.saveEmbed(true, Number(data.duration) || 0);
      this.nextBtn.hidden = !this.opts.hasNext?.();
      this.opts.onEnded?.();
    }
    if (data.event === 'error') this.fail('The embedded player reported a playback error. Try another server.');
  }

  saveEmbed(force, duration = 0) {
    const now = Date.now();
    if (!force && now - this.embedLastSave < 5000) return;
    this.embedLastSave = now;
    this.opts.onProgress?.({ time: this.embedTime, duration, ...this.meta });
  }

  getCurrentTime() {
    return this.iframe.hidden ? (this.video.currentTime || 0) : this.embedTime;
  }

  tick() {
    this.save(false);
  }

  save(force) {
    const video = this.video;
    if (!this.data || !video || !video.duration || !Number.isFinite(video.duration)) return;
    const now = Date.now();
    if (!force && now - this.lastSave < 5000) return;
    this.lastSave = now;
    this.opts.onProgress?.({ time: video.currentTime, duration: video.duration, ...this.meta });
  }

  destroy() {
    this.reset();
    this.video.removeEventListener('timeupdate', this.onTime);
    this.video.removeEventListener('ended', this.onEnd);
    window.removeEventListener('message', this.onMessage);
    this.data = null;
  }
}
