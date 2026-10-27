-- Encrypted secret records (vault). `blob` is nonce || ciphertext.
CREATE TABLE credentials (
    name       TEXT PRIMARY KEY NOT NULL,
    blob       BLOB NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
