-- What each site runs, as last read: a cache (plan 5.8). JSON in the shape of `fleet::Inventory`.
CREATE TABLE inventory (
    site_id    INTEGER PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
    snapshot   TEXT NOT NULL,
    fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

-- Changes the human confirmed in the app, and how each went.
CREATE TABLE jobs (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    finished_at INTEGER
) STRICT;

CREATE TABLE job_items (
    id        INTEGER PRIMARY KEY,
    job_id    INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    -- Kept when the site is removed later, so the record still reads.
    site_id   INTEGER REFERENCES sites (id) ON DELETE SET NULL,
    site_name TEXT NOT NULL,
    -- JSON `fleet::Action`.
    action    TEXT NOT NULL,
    label     TEXT NOT NULL,
    from_version TEXT,
    to_version   TEXT,
    state     TEXT NOT NULL DEFAULT 'waiting'
              CHECK (state IN ('waiting', 'running', 'done', 'failed')),
    message   TEXT NOT NULL DEFAULT ''
) STRICT;
