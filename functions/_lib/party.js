// Watch party: friends open the same link and follow the host's episode, position and server.
// No account needed: anyone with the link joins under a display name.
//
//   GET /api/party/<CODE>/ws?host=<key>&name=<display name>   WebSocket into the room
//
// One room (a Durable Object) per site and code. The first connection that brings a host key
// becomes the host; only the host's state counts. The room keeps the host key and the last
// state ({ show, ep, t, playing, server, cat, at }) in storage; who is connected (display name,
// host or not) lives only on the open connections. Chat lines are passed on, never stored.
// Everything is deleted 12 hours after the room goes quiet. At most 20 people per room.
// Uses the WebSocket Hibernation API, so an idle room costs nothing between messages.
//
// Messages to the browser: hello { role, state, people, you }, roster { people },
// state { state }, chat { name, text, host }, react { emoji }.
// people: [{ id, name, host }] (id is per connection, so the page can tell "you" apart).

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

/** A display name: letters, numbers, spaces, _ and -, up to 20 characters. */
export function cleanName(raw) {
  return String(raw ?? '').replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Guest';
}

/** A chat line: plain text up to 200 characters; null when empty. */
export function cleanChat(d) {
  const text = String(d?.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  return { name: cleanName(d?.name), text };
}

/**
 * Cleans the host's state message; null when it's not usable. t is null when the host's player
 * doesn't share its position (guests then stay on the same episode but aren't moved).
 */
export function cleanState(d) {
  const show = String(d?.show ?? '');
  const ep = Number(d?.ep);
  const known = d?.t !== null && d?.t !== undefined;
  const t = Number(d?.t);
  if (!/^\d{1,12}$/.test(show) || !Number.isInteger(ep) || ep < 1 || ep > 2000) return null;
  if (known && (!Number.isFinite(t) || t < 0 || t > 86400)) return null;
  const server = /^[a-z0-9_-]{1,40}$/.test(String(d?.server || '')) ? String(d.server) : null;
  const cat = d?.cat === 'dub' ? 'dub' : 'sub';
  return { show, ep, t: known ? Math.round(t * 10) / 10 : null, playing: Boolean(d.playing), server, cat, at: Date.now() };
}

export class PartyRoom {
  constructor(state) {
    this.state = state;
  }

  sockets(except) { return this.state.getWebSockets().filter((ws) => ws !== except); }
  infoOf(ws) {
    const a = (ws.deserializeAttachment?.() || {});
    return { id: a.id || '', name: a.name || 'Guest', host: this.state.getTags(ws).includes('host'), lastChat: a.lastChat || 0 };
  }
  roster(except) { return this.sockets(except).map((ws) => { const { id, name, host } = this.infoOf(ws); return { id, name, host }; }); }
  broadcast(message, except) {
    const text = JSON.stringify(message);
    for (const ws of this.sockets(except)) {
      try { ws.send(text); } catch { /* gone */ }
    }
  }

  async fetch(request) {
    if (this.sockets().length >= MAX_PEOPLE) return new Response('This party is full', { status: 429 });
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
    const id = crypto.randomUUID().slice(0, 8);
    server.serializeAttachment?.({ id, name: cleanName(url.searchParams.get('name')), lastChat: 0 });
    const last = (await this.state.storage.get('state')) || null;
    const people = this.roster();
    server.send(JSON.stringify({ type: 'hello', role, you: id, state: last, people, now: Date.now() }));
    this.broadcast({ type: 'roster', people }, server);
    await this.state.storage.setAlarm(Date.now() + QUIET_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 500) return;
    let d;
    try { d = JSON.parse(message); } catch { return; }
    const me = this.infoOf(ws);
    if (d.type === 'state' && me.host) {
      const state = cleanState(d);
      if (!state) return;
      await this.state.storage.put('state', state);
      this.broadcast({ type: 'state', state, now: Date.now() }, ws);
    } else if (d.type === 'react' && REACTIONS.includes(d.emoji)) {
      this.broadcast({ type: 'react', emoji: d.emoji, name: me.name }, ws);
    } else if (d.type === 'chat') {
      // At most one line a second per person; the name comes from the connection, not the message.
      if (Date.now() - me.lastChat < 1000) return;
      ws.serializeAttachment?.({ id: me.id, name: me.name, lastChat: Date.now() });
      const line = cleanChat({ text: d.text, name: me.name });
      if (line) this.broadcast({ type: 'chat', ...line, host: me.host }, ws);
    } else if (d.type === 'rename') {
      ws.serializeAttachment?.({ id: me.id, name: cleanName(d.name), lastChat: me.lastChat });
      this.broadcast({ type: 'roster', people: this.roster() });
    } else if (d.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', now: Date.now() }));
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* already closed */ }
    this.broadcast({ type: 'roster', people: this.roster(ws) }, ws);
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  // 12 hours after the last person joined: forget the room if nobody is left.
  async alarm() {
    if (this.sockets().length > 0) await this.state.storage.setAlarm(Date.now() + QUIET_MS);
    else await this.state.storage.deleteAll();
  }
}
