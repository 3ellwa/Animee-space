const fail = (status, message) => Object.assign(new Error(message), { status });

const ALLOWED_HOSTS = {
  animeparadise: ['stream.animeparadise.moe'],
};
const PROVIDER_REFERERS = {
  animeparadise: 'https://animeparadise.moe/',
};

function allowed(provider, hostname) {
  return (ALLOWED_HOSTS[provider] || []).some(host => hostname === host || hostname.endsWith('.' + host));
}

function proxiedUrl(requestUrl, provider, target) {
  const url = new URL('/api/stream-proxy', requestUrl.origin);
  url.searchParams.set('provider', provider);
  url.searchParams.set('url', target);
  return url.toString();
}

function rewriteManifest(body, upstreamUrl, requestUrl, provider) {
  const rewrite = raw => {
    try {
      const absolute = new URL(raw, upstreamUrl);
      if (absolute.protocol !== 'https:' || !allowed(provider, absolute.hostname)) return raw;
      return proxiedUrl(requestUrl, provider, absolute.toString());
    } catch { return raw; }
  };
  return body.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_all, uri) => `URI="${rewrite(uri)}"`);
    }
    return rewrite(trimmed);
  }).join('\n');
}

export async function proxyStream(request) {
  const incoming = new URL(request.url);
  const provider = String(incoming.searchParams.get('provider') || '').toLowerCase();
  const rawTarget = incoming.searchParams.get('url') || '';
  if (!ALLOWED_HOSTS[provider]) throw fail(400, 'Unknown stream proxy provider.');
  if (rawTarget.length > 4096) throw fail(414, 'Stream URL is too long.');

  let target;
  try { target = new URL(rawTarget); } catch { throw fail(400, 'Invalid stream URL.'); }
  if (target.protocol !== 'https:' || target.username || target.password || !allowed(provider, target.hostname)) {
    throw fail(403, 'That stream host is not allowed through the proxy.');
  }

  const headers = new Headers({
    Accept: request.headers.get('Accept') || '*/*',
    Referer: PROVIDER_REFERERS[provider],
  });
  const range = request.headers.get('Range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);

  let upstream;
  try {
    upstream = await fetch(target.toString(), { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch {
    throw fail(502, 'The upstream video server could not be reached.');
  }
  if (!upstream.ok && upstream.status !== 206) throw fail(502, `The upstream video server returned HTTP ${upstream.status}.`);
  const finalUrl = upstream.url ? new URL(upstream.url) : target;
  if (finalUrl.protocol !== 'https:' || !allowed(provider, finalUrl.hostname)) {
    throw fail(502, 'The stream redirected to an unsupported host.');
  }

  const contentType = upstream.headers.get('content-type') || '';
  const looksLikeManifest = /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(finalUrl.pathname + finalUrl.search);
  const responseHeaders = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': looksLikeManifest ? 'private, max-age=15' : 'private, max-age=60',
    'Content-Type': looksLikeManifest ? 'application/vnd.apple.mpegurl; charset=utf-8' : (contentType || 'application/octet-stream'),
  });
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  if (looksLikeManifest) {
    const body = await upstream.text();
    if (!body.trimStart().startsWith('#EXTM3U')) throw fail(502, 'The upstream did not return a valid HLS manifest.');
    responseHeaders.delete('content-length');
    return new Response(rewriteManifest(body, finalUrl.toString(), incoming, provider), {
      status: upstream.status,
      headers: responseHeaders,
    });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
