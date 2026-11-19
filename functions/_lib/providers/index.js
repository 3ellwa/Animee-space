import * as anilist from './anilist.js';

const PROVIDERS = { anilist };

export function getProvider(env = {}) {
  const key = String(env.PROVIDER || 'anilist').toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) throw Object.assign(new Error(`Unknown provider "${key}"`), { status: 500 });
  return provider;
}
