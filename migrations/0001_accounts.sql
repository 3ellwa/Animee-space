-- animee space accounts + synced library
-- Kept deliberately tiny: one row per (user, anime), integers only, watched episodes as a bitset.
-- A typical row is ~40-60 bytes, so 1,000 users x 100 anime each is only ~5 MB.

CREATE TABLE IF NOT EXISTS users (
  id      INTEGER PRIMARY KEY,
  name    TEXT    NOT NULL UNIQUE,      -- lowercase username
  pass    TEXT    NOT NULL,             -- pbkdf2$iterations$salt$hash
  ver     INTEGER NOT NULL DEFAULT 1,   -- bump to log out every device
  prefs   INTEGER NOT NULL DEFAULT 1,   -- bit flags: 1 autoplay, 2 autoskip, 4 prefer dub, 8 prefer AnimeParadise
  created INTEGER NOT NULL              -- unix seconds
);

CREATE TABLE IF NOT EXISTS library (
  user_id  INTEGER NOT NULL,
  anime_id INTEGER NOT NULL,            -- AniList id (titles/posters are fetched from AniList, never stored)
  s        INTEGER NOT NULL DEFAULT 0,  -- list status: 0 none, 1 watching, 2 planning, 3 completed, 4 on hold, 5 dropped
  ep       INTEGER NOT NULL DEFAULT 0,  -- last episode opened (0 = not in continue watching)
  t        INTEGER NOT NULL DEFAULT 0,  -- seconds into that episode
  d        INTEGER NOT NULL DEFAULT 0,  -- that episode's length in seconds
  w        TEXT,                        -- watched episodes, base64 bitset (1 bit per episode)
  u        INTEGER NOT NULL,            -- last change, unix seconds
  PRIMARY KEY (user_id, anime_id)
) WITHOUT ROWID;
