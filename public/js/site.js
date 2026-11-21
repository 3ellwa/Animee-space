// Which site this page is: animee (anime) or cinemee (movies and TV). The worker marks cinemee
// pages with <html data-site="cinemee">; everything else is animee.
export const SITE = document.documentElement.dataset.site === 'cinemee' ? 'cinemee' : 'animee';
export const IS_CINEMEE = SITE === 'cinemee';

export const BRAND = IS_CINEMEE
  ? { name: 'cinemee', title: 'cinemee', hub: 'my list', hubNav: 'My List', backup: 'cinemee' }
  : { name: 'animee', title: 'animee space', hub: 'my anime', hubNav: 'My Anime', backup: 'animee-space' };
