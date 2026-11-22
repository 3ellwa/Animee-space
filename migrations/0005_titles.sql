-- mangee: MangaDex identifies series by UUID; everything else here (lists, progress, reports,
-- pop-ups, URLs) uses plain numbers. Each MangaDex series seen gets a number, kept forever.
-- (Harmless on animee's and cinemee's databases, which never use it.)
CREATE TABLE IF NOT EXISTS titles (
  id   INTEGER PRIMARY KEY,
  uuid TEXT    NOT NULL UNIQUE
);
