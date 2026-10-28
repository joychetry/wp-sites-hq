-- A safe update that broke the site and was put back gets its own state.
-- SQLite can't change a CHECK, so the table is rebuilt with the same rows.
CREATE TABLE job_items_new (
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
              CHECK (state IN ('waiting', 'running', 'done', 'failed', 'rolled_back')),
    message   TEXT NOT NULL DEFAULT ''
) STRICT;
INSERT INTO job_items_new SELECT * FROM job_items;
DROP TABLE job_items;
ALTER TABLE job_items_new RENAME TO job_items;
