-- "Episode didn't play" counters (functions/_lib/reports.js). One small row per
-- (show, episode, server, language, reason, day) with a count; rows older than 30 days are pruned.
-- The Worker also creates this table on first use, so applying this migration is optional.
-- reason: 0 auto server switch, 1 video won't play, 2 wrong episode, 3 subtitles, 4 audio, 5 other
-- cat: 0 sub, 1 dub. day: days since 1970-01-01 (UTC).

CREATE TABLE IF NOT EXISTS reports (
  anime_id INTEGER NOT NULL,
  ep       INTEGER NOT NULL,
  provider TEXT    NOT NULL,
  cat      INTEGER NOT NULL,
  reason   INTEGER NOT NULL,
  day      INTEGER NOT NULL,
  n        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (anime_id, ep, provider, cat, reason, day)
) WITHOUT ROWID;
