-- Answers from outside services (WPVulnerability), kept a day so sites
-- running the same plugin share one. `key` is the path asked for.
CREATE TABLE lookups (
    key        TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL,
    body       TEXT NOT NULL
) STRICT;

-- Each site's last security scan: JSON in the shape of `security::Report`.
CREATE TABLE security (
    site_id    INTEGER PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
    checked_at INTEGER NOT NULL,
    report     TEXT NOT NULL
) STRICT;
