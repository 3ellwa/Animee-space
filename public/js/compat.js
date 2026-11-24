// Small stand-ins for things older browsers lack, mainly smart TVs (LG webOS 22 runs Chrome 87,
// Samsung Tizen 6.5 Chrome 85). Loaded first by app.js; each one only fills a gap.

// Chrome 92: starting a watch party needs it.
if (globalThis.crypto && !crypto.randomUUID && crypto.getRandomValues) {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

// Chrome 103: request time limits (AniList lookups).
if (globalThis.AbortSignal && !AbortSignal.timeout) {
  AbortSignal.timeout = (ms) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  };
}

// Chrome 92 / 93.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this[n]; },
  });
}
if (!Object.hasOwn) Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
