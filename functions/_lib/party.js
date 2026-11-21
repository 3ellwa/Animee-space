// Watch party: friends open the same link and follow the host's episode and position.
//
//   GET /api/party/<CODE>/ws?host=<key>   WebSocket into the room (a Durable Object per code)
//
// The first connection that brings a host key becomes the host; only the host's state counts.
// Rooms keep nothing about people: the host key, the last state ({ show, ep, t, playing, at })
// and that's it (chat lines are passed on, never stored), deleted 12 hours after the room goes quiet. At most 20 people per room.
// Uses the WebSocket Hibernation API, so an idle room costs nothing between messages.

const CODE = /^[A-Z0-9]{6}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const REACTIONS = ['😂', '😮', '❤️', '🔥', '😭', '👏'];
const MAX_PEOPLE = 20;
const QUIET_MS = 12 * 3600e3;

/** Route a party request to its room (one per site and code). */
export async function handleParty(request, env, code, site) {
  if (!CODE.test(code || '')) return new Response('Bad party code', { status: 400 });
  if (!env.PARTY) return new Response('Watch parties are not set up here', { status: 503 });
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return new Response('Bad origin', { status: 403 });
  const stub = env.PARTY.get(env.PARTY.idFromName(`${site}:${code}`));
  return stub.fetch(request);
}

/** A chat line: plain text up to 200 characters and a short display name; null when empty. */
export function cleanChat(d) {
  const text = String(d?.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  const name = String(d?.name ?? '').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 20) || 'Guest';
  return { name, text };
}

/** Cleans the host's state message; null when it's not usable. */
export function cleanState(d) {
  const show = String(d?.show ?? '');
  const ep = Number(d?.ep);
  const t = Number(d?.t);
  if (!/^\d{1,12}$/.test(show) || !Number.isInteger(ep) || ep < 1 || ep > 2000 || !Number.isFinite(t) || t < 0 || t > 86400) return null;
  return { show, ep, t: Math.round(t * 10) / 10, playing: Boolean(d.playing), at: Date.now() };
}

export class PartyRoom {
  constructor(state) {
    this.state = state;
  }

  people() { return this.state.getWebSockets().length; }
  broadcast(message, except) {
    const text = JSON.stringify(message);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch { /* gone */ }
    }
  }

  async fetch(request) {
    if (this.people() >= MAX_PEOPLE) return new Response('This party is full', { status: 429 });
    const url = new URL(request.url);
    const given = url.searchParams.get('host') || '';
    let hostKey = await this.state.storage.get('hostKey');
    let role = 'guest';
    if (KEY.test(given)) {
      if (!hostKey) { hostKey = given; await this.state.storage.put('hostKey', given); }
      if (given === hostKey) role = 'host';
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [role]);
    const last = (await this.state.storage.get('state')) || null;
    server.send(JSON.stringify({ type: 'hello', role, state: last, people: this.people(), now: Date.now() }));
    this.broadcast({ type: 'people', people: this.people() }, server);
    await this.state.storage.setAlarm(Date.now() + QUIET_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 500) return;
    let d;
    try { d = JSON.parse(message); } catch { return; }
    const host = this.state.getTags(ws).includes('host');
    if (d.type === 'state' && host) {
      const state = cleanState(d);
      if (!state) return;
      await this.state.storage.put('state', state);
      this.broadcast({ type: 'state', state, now: Date.now() }, ws);
    } else if (d.type === 'react' && REACTIONS.includes(d.emoji)) {
      this.broadcast({ type: 'react', emoji: d.emoji }, ws);
    } else if (d.type === 'chat') {
      // At most one line a second per person; nothing is kept, it's passed on and gone.
      const last = ws.deserializeAttachment?.()?.lastChat || 0;
      if (Date.now() - last < 1000) return;
      ws.serializeAttachment?.({ lastChat: Date.now() });
      const line = cleanChat(d);
      if (line) this.broadcast({ type: 'chat', ...line, host }, ws);
    } else if (d.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', now: Date.now() }));
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* already closed */ }
    this.broadcast({ type: 'people', people: Math.max(0, this.people() - 1) }, ws);
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  // 12 hours after the last person joined: forget the room if nobody is left.
  async alarm() {
    if (this.people() > 0) await this.state.storage.setAlarm(Date.now() + QUIET_MS);
    else await this.state.storage.deleteAll();
  }
}
