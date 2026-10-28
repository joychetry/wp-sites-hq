-- Each load of a site's home page (plan 5.8 monitor_results), kept 30 days.
CREATE TABLE uptime (
    site_id INTEGER NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    at      INTEGER NOT NULL DEFAULT (unixepoch()),
    up      INTEGER NOT NULL,
    status  INTEGER NOT NULL,
    ms      INTEGER NOT NULL,
    error   TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX uptime_by_site ON uptime (site_id, at);

-- What changes slowly (plan 5.8 monitors): certificate and domain expiry,
-- and the last PageSpeed result (JSON in the shape of `monitor::PageSpeed`).
CREATE TABLE monitors (
    site_id        INTEGER PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
    cert_expires   INTEGER,
    domain         TEXT,
    domain_expires INTEGER,
    domain_note    TEXT NOT NULL DEFAULT '',
    domain_at      INTEGER,
    pagespeed      TEXT,
    pagespeed_at   INTEGER
) STRICT;
