-- Requests ("Ask us something") with answers from the admin page (functions/_lib/requests.js).
-- Bounded: at most 5,000 rows, answered ones deleted after 90 days. The Worker also creates this
-- table on first use, so applying this migration is optional.
-- kind: 0 add an anime, 1 idea, 2 something is broken, 3 other. Times are unix seconds.

CREATE TABLE IF NOT EXISTS requests (
  id       INTEGER PRIMARY KEY,
  who      TEXT    NOT NULL,
  user_id  INTEGER,
  kind     INTEGER NOT NULL,
  anime    TEXT,
  message  TEXT    NOT NULL,
  answer   TEXT,
  created  INTEGER NOT NULL,
  answered INTEGER
);
CREATE INDEX IF NOT EXISTS requests_who ON requests (who);
