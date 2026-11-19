// Video player: MegaPlay iframe embeds with validated postMessage tracking,
// plus HLS support for any future first-party source.

export class Player {
  /**
   * @param {HTMLElement} root
   * @param {{onProgress?:Function,onEnded?:Function,onNext?:Function,hasNext?:Function,autoskip?:Function}} opts
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.hls = null;
    this.data = null;
    this.lastSave = 0;
    this.retries = 0;
    this.embedTime = 0;
    this.embedLastSave = 0;
    this.embedOrigin = null;

    root.innerHTML = `
      <div class="player">
        <video playsinline controls preload="metadata"></video>
        <iframe class="embed-frame" title="Anime episode player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen webkitallowfullscreen mozallowfullscreen referrerpolicy="strict-origin-when-cross-origin" hidden></iframe>
        <button class="pl-btn skip" type="button" hidden>Skip intro ⏭</button>
        <button class="pl-btn next" type="button" hidden>Next episode ▶</button>
        <div class="pl-msg" hidden></div>
      </div>
      <button class="btn sm player-fullscreen" type="button" aria-label="Fullscreen player" hidden>⛶ Fullscreen</button>`;
    this.video = root.querySelector('video');
    this.iframe = root.querySelector('iframe');
    this.skipBtn = root.querySelector('.skip');
    this.fullscreenBtn = root.querySelector('.player-fullscreen');
    this.nextBtn = root.querySelector('.next');
    this.msgEl = root.querySelector('.pl-msg');
    this.quality = null; // <select> set via bindQuality()

    this.skipBtn.onclick = () => this.skipIntro();
    this.fullscreenBtn.onclick = () => this.enterFullscreen();
    this.nextBtn.onclick = () => this.opts.onNext?.();

    this.onTime = () => this.tick();
    this.onMessage = (event) => this.handleEmbedMessage(event);
    window.addEventListener('message', this.onMessage);
    this.onEnd = () => {
      this.save(true);
      this.opts.onEnded?.();
    };
    this.video.addEventListener('timeupdate', this.onTime);
    this.video.addEventListener('ended', this.onEnd);
    this.video.addEventListener('pause', () => this.save(true));
  }

  bindQuality(select) {
    this.quality = select;
    select.onchange = () => {
      if (this.hls) this.hls.currentLevel = Number(select.value);
    };
  }

  msg(text) {
    this.msgEl.textContent = text;
    this.msgEl.hidden = !text;
  }

  reset() {
    this.save(true);
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    const v = this.video;
    v.pause();
    v.querySelectorAll('track').forEach((t) => t.remove());
    v.removeAttribute('src');
    v.load();
    this.skipBtn.hidden = true;
    this.fullscreenBtn.hidden = true;
    this.nextBtn.hidden = true;
    this.retries = 0;
    this.msg('');
    this.iframe.hidden = true;
    this.iframe.removeAttribute('src');
    this.video.hidden = false;
    this.embedTime = 0;
    this.embedLastSave = 0;
    this.embedOrigin = null;
    if (this.quality) { this.quality.disabled = false; this.quality.innerHTML = '<option value="-1">Auto</option>'; }
  }

  /** @param {{sources:Array,tracks?:Array,intro?:object,outro?:object}} data */
  load(data, { startAt = 0, meta = {} } = {}) {
    this.reset();
    this.data = data;
    this.meta = meta;
    if (data.embedUrl) {
      this.video.hidden = true;
      this.iframe.hidden = false;
      this.fullscreenBtn.hidden = false;
      this.embedOrigin = data.embedOrigin || new URL(data.embedUrl).origin;
      this.iframe.src = data.embedUrl;
      if (this.quality) this.quality.disabled = true;
      this.msg('');
      return;
    }
    const v = this.video;
    const src = (data.sources || [])[0];
    if (!src) return this.msg('No video source for this episode.');

    for (const t of data.tracks || []) {
      const el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = t.label || t.lang;
      el.srclang = t.lang || 'und';
      el.src = t.url;
      if (t.default) el.default = true;
      v.appendChild(el);
    }

    const start = () => {
      if (startAt > 5 && (!v.duration || startAt < v.duration - 15)) v.currentTime = startAt;
      v.play().catch(() => { /* autoplay blocked; user presses play */ });
    };

    const Hls = window.Hls;
    if (src.type === 'hls' && Hls && Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30 });
      this.hls = hls;
      hls.loadSource(src.url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.fillQualities();
        start();
      });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (this.retries++ >= 3) {
          this.msg('This stream failed to load. Try another server.');
          hls.destroy();
          this.hls = null;
          return;
        }
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else this.msg('Playback error. Try another server.');
      });
    } else if (src.type !== 'hls' || v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src.url;
      v.addEventListener('loadedmetadata', start, { once: true });
      v.addEventListener('error', () => this.msg('This stream failed to load. Try another server.'), { once: true });
    } else {
      this.msg('Your browser can’t play this stream.');
    }
  }

  async enterFullscreen() {
    const target = this.iframe.hidden ? this.video : this.iframe;
    try {
      if (target.requestFullscreen) await target.requestFullscreen();
      else await this.root.querySelector('.player').requestFullscreen();
    } catch {
      this.msg('Fullscreen was blocked by the browser. Use the embedded player controls if available.');
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
    if (data.event === 'time' && Number.isFinite(Number(data.time))) {
      this.embedTime = Math.max(0, Number(data.time));
      const duration = Number(data.duration) || 0;
      this.saveEmbed(false, duration);
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
    if (data.event === 'error') this.msg('The embedded player reported a playback error. Try another language/server.');
  }

  saveEmbed(force, duration = 0) {
    const now = Date.now();
    if (!force && now - this.embedLastSave < 5000) return;
    this.embedLastSave = now;
    this.opts.onProgress?.({ time: this.embedTime, duration, ...this.meta });
  }

  getCurrentTime() { return this.iframe.hidden ? (this.video.currentTime || 0) : this.embedTime; }

  fillQualities() {
    if (!this.quality || !this.hls) return;
    const levels = this.hls.levels
      .map((l, i) => ({ i, h: l.height }))
      .filter((l) => l.h)
      .sort((a, b) => b.h - a.h);
    this.quality.innerHTML = '<option value="-1">Auto</option>' +
      levels.map((l) => `<option value="${l.i}">${l.h}p</option>`).join('');
  }

  inIntro(t) {
    const intro = this.data?.intro;
    return intro && t >= intro.start && t < intro.end - 1;
  }

  skipIntro() {
    if (this.data?.intro) this.video.currentTime = this.data.intro.end;
  }

  tick() {
    const v = this.video;
    const t = v.currentTime;
    const intro = this.inIntro(t);
    if (intro && this.opts.autoskip?.()) this.skipIntro();
    this.skipBtn.hidden = !intro;

    const outro = this.data?.outro;
    const nearEnd = v.duration && (outro ? t >= outro.start : v.duration - t < 25);
    this.nextBtn.hidden = !(nearEnd && this.opts.hasNext?.());

    this.save(false);
  }

  save(force) {
    const v = this.video;
    if (!this.data || !v || !v.duration || !Number.isFinite(v.duration)) return;
    const now = Date.now();
    if (!force && now - this.lastSave < 5000) return;
    this.lastSave = now;
    this.opts.onProgress?.({ time: v.currentTime, duration: v.duration, ...this.meta });
  }

  destroy() {
    this.reset();
    this.video.removeEventListener('timeupdate', this.onTime);
    this.video.removeEventListener('ended', this.onEnd);
    window.removeEventListener('message', this.onMessage);
    this.data = null;
  }
}
