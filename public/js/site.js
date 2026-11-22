// Which site this page is: animee (anime), cinemee (movies and TV) or mangee (manga). The worker
// marks the page with <html data-site="cinemee|mangee">; anything else is animee.
const marked = document.documentElement.dataset.site;
export const SITE = marked === 'cinemee' || marked === 'mangee' ? marked : 'animee';
export const IS_CINEMEE = SITE === 'cinemee';
export const IS_MANGEE = SITE === 'mangee';

export const BRAND = IS_CINEMEE
  ? { name: 'cinemee', title: 'cinemee', hub: 'my list', hubNav: 'My List', backup: 'cinemee' }
  : IS_MANGEE
    ? { name: 'mangee', title: 'mangee', hub: 'my manga', hubNav: 'My Manga', backup: 'mangee' }
    : { name: 'animee', title: 'animee space', hub: 'my anime', hubNav: 'My Anime', backup: 'animee-space' };

// Words that differ: an anime has episodes you watch; a manga has chapters you read.
export const WORDS = IS_MANGEE
  ? { ep: 'chapter', Ep: 'Chapter', eps: 'chapters', watch: 'read', Watch: 'Read', watching: 'reading', Watching: 'Reading', short: 'ch.' }
  : { ep: 'episode', Ep: 'Episode', eps: 'episodes', watch: 'watch', Watch: 'Watch', watching: 'watching', Watching: 'Watching', short: 'eps' };

// The sister sites (animee.space, cinemee.animee.space, mangee.animee.space; *.localhost in
// development). SIBLING is the one this site points to first (promo card, Continue on…).
const baseHost = location.host.replace(/^(cinemee|mangee)\./, '');
const site = (sub) => `${location.protocol}//${sub ? `${sub}.` : ''}${baseHost}`;
export const SIBLINGS = {
  animee: { origin: site(''), name: 'animee', what: 'anime', pitch: 'Anime, the same way: your lists, sync, Up next and new-episode pop-ups. In lime.' },
  cinemee: { origin: site('cinemee'), name: 'cinemee', what: 'movies and TV', pitch: 'Movies and TV, the same way: your lists, sync, Up next and new-episode pop-ups. In red.' },
  mangee: { origin: site('mangee'), name: 'mangee', what: 'manga', pitch: 'Manga, the same way: your lists, sync, the page you stopped on and new-chapter pop-ups. In neon yellow.' },
};
export const SIBLING = IS_CINEMEE || IS_MANGEE ? SIBLINGS.animee : SIBLINGS.cinemee;
