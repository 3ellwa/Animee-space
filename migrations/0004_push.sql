-- New-episode pop-ups (functions/_lib/push.js). The Worker also creates these tables on first
-- use, so applying this migration is optional.
--   push_subs:    one row per device that turned pop-ups on (its browser push address)
--   push_follows: which shows each of those devices follows
--   push_shows:   last aired episode count per followed show, and when it was checked

CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, alerts INTEGER NOT NULL DEFAULT 0,
  pending TEXT, due INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_follows (
  sub_id INTEGER NOT NULL, anime_id INTEGER NOT NULL, PRIMARY KEY (sub_id, anime_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS push_follows_anime ON push_follows (anime_id);
CREATE TABLE IF NOT EXISTS push_shows (
  anime_id INTEGER PRIMARY KEY, aired INTEGER NOT NULL DEFAULT 0, page INTEGER NOT NULL DEFAULT 1, checked INTEGER NOT NULL DEFAULT 0);
