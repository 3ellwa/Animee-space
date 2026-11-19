import * as anikoto from './anikoto.js';

const PROVIDERS = { anikoto };

export function getProvider(env = {}) {
  const key = String(env.PROVIDER || 'anikoto').toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) throw Object.assign(new Error(`Unknown provider "${key}"`), { status: 500 });
  return provider;
}
