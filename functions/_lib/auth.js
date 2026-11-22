// Password hashing (PBKDF2) and signed session cookies (HMAC). No sessions table needed.
//
// One account for every site (animee, cinemee, mangee): accounts live in animee's database
// (env.USERS_DB, see site.js) and the login cookie is set for the whole animee.space domain, so
// signing in on one site signs you in on all of them. Each site keeps its own list and progress
// (library rows) in its own database, under the same account id.
// The cookie was renamed when accounts were merged (as_session -> am_session): an old per-site
// cookie carried a per-site id and must not count any more.

const enc = new TextEncoder();
const ITERATIONS = 100000; // max allowed by Workers' WebCrypto
const COOKIE = 'am_session';
const SESSION_DAYS = 30;
const SHARED_DOMAIN = 'animee.space';
/** The database that holds accounts (animee's, on every site). */
export const usersDb = (env) => env.USERS_DB || env.DB;
/** "; Domain=animee.space" on the live sites, so the cookie reaches every subdomain; nothing locally. */
function domainAttr(requestUrl) {
  try {
    const host = new URL(requestUrl).hostname;
    return host === SHARED_DOMAIN || host.endsWith('.' + SHARED_DOMAIN) ? `; Domain=${SHARED_DOMAIN}` : '';
  } catch { return ''; }
}

export const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64u.encode(salt)}$${b64u.encode(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored).split('$');
  if (kind !== 'pbkdf2') return false;
  const got = await pbkdf2(password, b64u.decode(salt), Number(iter));
  return equal(got, b64u.decode(hash));
}

async function hmacKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw Object.assign(new Error('SESSION_SECRET is missing or too short (needs 32+ characters).'), { status: 503 });
  }
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(env, data) {
  return b64u.encode(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(data)));
}

export async function sessionCookie(env, user, requestUrl = '') {
  const payload = b64u.encode(enc.encode(JSON.stringify({
    u: user.id, v: user.ver, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  })));
  const token = `${payload}.${await sign(env, payload)}`;
  return `${COOKIE}=${token}; Path=/${domainAttr(requestUrl)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

// Private calendar feed link: user id + a signature over (purpose, id, ver). Nothing is stored,
// and "Sign out everywhere" (ver + 1) turns old links off.
export async function calendarToken(env, user) {
  return `${user.id}.${(await sign(env, `cal:${user.id}:${user.ver}`)).slice(0, 22)}`;
}
export async function userFromCalendarToken(env, token) {
  const m = String(token || '').match(/^(\d{1,12})\.([A-Za-z0-9_-]{22})$/);
  if (!m) return null;
  const user = await usersDb(env).prepare('SELECT id, name, ver FROM users WHERE id = ?').bind(Number(m[1])).first();
  if (!user) return null;
  const expected = (await sign(env, `cal:${user.id}:${user.ver}`)).slice(0, 22);
  return equal(enc.encode(expected), enc.encode(m[2])) ? user : null;
}

export const clearCookie = (requestUrl = '') => `${COOKIE}=; Path=/${domainAttr(requestUrl)}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Returns the logged-in user row or null. One small DB read (also checks "logged out everywhere"). */
export async function currentUser(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const expected = await sign(env, payload);
  if (!equal(enc.encode(expected), enc.encode(sig))) return null;

  let data;
  try { data = JSON.parse(new TextDecoder().decode(b64u.decode(payload))); } catch { return null; }
  if (!data.u || data.exp < Date.now() / 1000) return null;

  const user = await usersDb(env).prepare('SELECT id, name, ver, prefs FROM users WHERE id = ?').bind(data.u).first();
  if (!user || user.ver !== data.v) return null;
  return user;
}
