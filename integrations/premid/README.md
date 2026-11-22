# Discord presence (PreMiD)

Shows what you're watching or reading on your Discord profile, for example:

> **Watching animee**
> Frieren: Beyond Journey's End
> Episode 5 · 12:31 left

A website can't talk to the Discord app directly, so this goes through
[PreMiD](https://premid.app), a free browser extension. The sites publish what's playing in
`<script id="now-playing" type="application/json">` (see `public/js/nowplaying.js`); the
activity in `animee/` reads it. One activity covers animee, cinemee and mangee: the card
says "Watching animee", "Watching cinemee" or "Watching mangee".

Settings in PreMiD: hide the title (it then only says you're on the site), hide the cover,
hide the link button.

## Try it on your own machine

1. Create a Discord application at https://discord.com/developers/applications, named
   `animee` (done: id 1574094254597341214 is already in `presence.ts`). Its **Application ID**
   goes in `presence.ts` as the clientId.
2. Put your Discord username and user ID in `metadata.json` (`author`).
3. Install the PreMiD extension, and turn on **Activity Developer Mode** in its settings.
4. Clone https://github.com/PreMiD/Activities, copy `animee/` to `websites/A/animee/`, then
   from that repo run `npx pmd dev animee` (Node 20+). Open an episode on animee.space.

## Publish it for everyone

Run `npx pmd build animee --validate` (it also fixes `$schema` if the version moved on),
then open a pull request to PreMiD/Activities. PreMiD wants the logo and thumbnail hosted on
Imgur (512×512 logo). Their reviewers decide what sites they accept; if they decline, the
local developer-mode setup above keeps working for you.
