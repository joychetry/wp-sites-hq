-- Who asked for a job (plan 5.6). An AI agent's plan runs only after a person
-- confirms it in the app window; until then it waits, or a person declines it.
ALTER TABLE jobs ADD COLUMN proposed_by TEXT NOT NULL DEFAULT 'human'
    CHECK (proposed_by IN ('human', 'agent'));
ALTER TABLE jobs ADD COLUMN confirmed_at INTEGER;
ALTER TABLE jobs ADD COLUMN declined_at INTEGER;
UPDATE jobs SET confirmed_at = created_at;

-- What was done through Monks Central, and who started it (plan 5.8).
CREATE TABLE activity (
    id        INTEGER PRIMARY KEY,
    at        INTEGER NOT NULL DEFAULT (unixepoch()),
    -- human: the person in the app window; agent: an AI agent or script on the
    -- socket; agent_confirmed: an agent's plan that a person confirmed.
    actor     TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'agent_confirmed')),
    -- Kept when the site is removed later, so the record still reads.
    site_id   INTEGER REFERENCES sites (id) ON DELETE SET NULL,
    site_name TEXT NOT NULL DEFAULT '',
    what      TEXT NOT NULL,
    outcome   TEXT NOT NULL CHECK (outcome IN ('done', 'failed', 'refused', 'waiting')),
    detail    TEXT NOT NULL DEFAULT ''
) STRICT;
