-- Sites and how to reach them. Secrets live in `credentials` as `site:<id>`.
CREATE TABLE site_groups (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
) STRICT;

CREATE TABLE sites (
    id            INTEGER PRIMARY KEY,
    url           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    mode          TEXT NOT NULL CHECK (mode IN ('classic_monks', 'basic')),
    -- The MCP URL from the protected-resource document, or the REST root in Basic mode.
    api_url       TEXT NOT NULL,
    -- JSON: issuer, token and revocation endpoints, client id. Classic Monks only.
    oauth         TEXT,
    username      TEXT,
    wp_version    TEXT,
    php_version   TEXT,
    cm_version    TEXT,
    capabilities  TEXT NOT NULL DEFAULT '{}',
    sign_in_again INTEGER NOT NULL DEFAULT 0,
    health        TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (health IN ('unknown', 'ok', 'warning', 'down')),
    health_detail TEXT NOT NULL DEFAULT '',
    checked_at    INTEGER,
    group_id      INTEGER REFERENCES site_groups (id) ON DELETE SET NULL,
    added_at      INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE TABLE site_tags (
    site_id INTEGER NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    tag     TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (site_id, tag)
) STRICT;

CREATE TABLE site_notes (
    id       INTEGER PRIMARY KEY,
    site_id  INTEGER NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    body     TEXT NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
