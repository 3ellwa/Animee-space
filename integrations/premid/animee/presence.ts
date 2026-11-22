// PreMiD activity for animee, cinemee and mangee: "Watching animee · Frieren · Episode 5".
//
// The sites publish what you're watching or reading as JSON in
// <script id="now-playing" type="application/json"> (public/js/nowplaying.js), so this file
// only reads that block. Elsewhere on the sites it shows "Browsing".

import { ActivityType, Assets } from 'premid'

const presence = new Presence({ clientId: '1574094254597341214' })
const browsingTimestamp = Math.floor(Date.now() / 1000)

const LOGOS: Record<string, string> = {
  animee: 'https://animee.space/icons/icon-512.png',
  cinemee: 'https://cinemee.animee.space/icons/icon-512.png',
  mangee: 'https://mangee.animee.space/icons/icon-512.png',
}

interface NowPlaying {
  site: string
  kind: 'watching' | 'reading'
  title: string
  episode: string
  episodeTitle: string
  season: number | null
  number: number | null
  time: number | null
  duration: number | null
  paused: boolean | null
  at: number
  cover: string
  url: string
}

function readNowPlaying(): NowPlaying | null {
  const el = document.querySelector('#now-playing')
  if (!el?.textContent)
    return null
  try {
    return JSON.parse(el.textContent) as NowPlaying
  }
  catch {
    return null
  }
}

function siteOfPage(): string {
  const site = document.documentElement.dataset.site
  return site === 'cinemee' || site === 'mangee' ? site : 'animee'
}

presence.on('UpdateData', async () => {
  const [showTitle, showCover, showButtons] = await Promise.all([
    presence.getSetting<boolean>('showTitle'),
    presence.getSetting<boolean>('showCover'),
    presence.getSetting<boolean>('showButtons'),
  ])
  const site = siteOfPage()
  const now = readNowPlaying()
  const presenceData: PresenceData = {
    name: site,
    type: ActivityType.Watching,
    largeImageKey: LOGOS[site],
    largeImageText: `${site} · animee.space`,
  }

  if (!now || !showTitle) {
    presenceData.details = now ? (now.kind === 'reading' ? 'Reading manga' : 'Watching something') : 'Browsing'
    presenceData.startTimestamp = browsingTimestamp
    presence.setActivity(presenceData)
    return
  }

  presenceData.details = now.title
  if (now.kind === 'reading') {
    presenceData.state = [now.episode, now.time && now.duration ? `page ${now.time} of ${now.duration}` : '']
      .filter(Boolean)
      .join(' · ')
    presenceData.startTimestamp = browsingTimestamp
  }
  else {
    presenceData.state = [now.episode, now.episodeTitle].filter(Boolean).join(' · ') || 'Movie'
    // Discord turns "Season 2, Episode 5" into "S2E5" on the Watching card.
    if (now.number && now.episode)
      presenceData.largeImageText = now.season ? `Season ${now.season}, Episode ${now.number}` : `Episode ${now.number}`
    if (now.paused) {
      presenceData.smallImageKey = Assets.Pause
      presenceData.smallImageText = 'Paused'
    }
    else if (now.time !== null && now.duration) {
      // Where the video is now: the last reading plus the time since (it's sent every 5 s).
      const position = now.time + (now.paused === false ? (Date.now() - now.at) / 1000 : 0)
      const start = Math.floor(Date.now() / 1000 - position)
      presenceData.startTimestamp = start
      presenceData.endTimestamp = start + now.duration
      presenceData.smallImageKey = Assets.Play
      presenceData.smallImageText = 'Playing'
    }
    else {
      presenceData.startTimestamp = browsingTimestamp
    }
  }

  if (showCover && /^https:\/\//.test(now.cover))
    presenceData.largeImageKey = now.cover
  if (showButtons && /^https:\/\//.test(now.url))
    presenceData.buttons = [{ label: now.kind === 'reading' ? 'Read it' : 'Watch it', url: now.url }]

  presence.setActivity(presenceData)
})
