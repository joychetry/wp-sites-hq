-- Phase 7: clients, what sites cost and earn, plugin bundles and app settings.
CREATE TABLE clients (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email    TEXT NOT NULL DEFAULT '',
    notes    TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

ALTER TABLE sites ADD COLUMN client_id INTEGER REFERENCES clients (id) ON DELETE SET NULL;

-- A cost (hosting, a domain, a licence) or a charge (what the client pays),
-- on one site or on a client. Amounts are in cents so sums stay exact.
CREATE TABLE costs (
    id        INTEGER PRIMARY KEY,
    site_id   INTEGER REFERENCES sites (id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients (id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('cost', 'charge')),
    label     TEXT NOT NULL,
    cents     INTEGER NOT NULL CHECK (cents >= 0),
    currency  TEXT NOT NULL,
    every     TEXT NOT NULL CHECK (every IN ('month', 'year', 'once')),
    -- "2027-03-01", when it renews or is due.
    renews_on TEXT,
    CHECK ((site_id IS NULL) != (client_id IS NULL))
) STRICT;

-- A named set of plugins to install together: WordPress.org slugs or zip links.
CREATE TABLE bundles (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    plugins TEXT NOT NULL DEFAULT '[]'
) STRICT;

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;
