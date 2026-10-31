# Security

WP Sites HQ holds the keys to every WordPress site you connect, so security
reports come first.

## Reporting a problem

Please don't open a public issue. Use GitHub's private reporting instead:
**Security > Report a vulnerability** on
[the repository](https://github.com/joychetry/wp-sites-hq/security/advisories/new).
Say what you found, how to reproduce it, and what an attacker could do with it.

You'll get an answer within 7 days. Once a fix is released, the advisory is
published with credit to you, unless you'd rather stay anonymous.

Problems in the Classic Monks plugin (the connector on each site) go to the
same place; we pass them on.

## Supported versions

Only the newest release gets security fixes. The app updates itself (Settings >
Updates for WP Sites HQ), so staying current is one click.

## How WP Sites HQ protects your sites

- **Secrets.** Every site sign-in is encrypted (XChaCha20-Poly1305) in the local
  database. The key lives in the system keychain. A record that won't decrypt
  asks you to sign in to that site again.
- **The window is the only operator.** The app window holds the operator role.
  The `wpshq` command and `wpshq mcp` (AI apps) talk to the core over a local
  socket (a 0700 folder on macOS and Linux, an owner-only named pipe on Windows)
  and are always agents: they can read, change one site only where you turned on
  agent access and the site approves the change, and propose plans for many
  sites that run only after you confirm them in the window. An agent's plan
  expires after 7 days.
- **TLS.** Certificates are checked against your operating system's trust store.
- **On each site.** Classic Monks uses OAuth 2.1 with PKCE, short-lived tokens
  and refresh-token rotation, logs every change, and can require approval for
  risky ones.
- **Updates** are signed. The app checks the signature against the public key
  built into it before installing anything.

## Known limits

- The Linux Secret Service has no per-app access control: any program running
  as you can read the master key while your keyring is unlocked. The same is
  true of every Linux app that uses it.
- The installers are not code-signed yet (see [the install guide](https://github.com/joychetry/wp-sites-hq/blob/main/docs/install.md)).
  Download them only from the GitHub releases page.
- The Windows named-pipe owner check is written but not yet tested on Windows.
- Dependabot alert 1 (GHSA-wrw7-89jp-8q8g, glib before 0.20: unsound
  `VariantStrIter` iterators) stays open. glib 0.18 comes in through Tauri's
  Linux stack (gtk 0.18, webkit2gtk 2.0, wry, tao, muda, tray-icon), and Tauri
  2.12.5, the newest Tauri 2, requires `gtk ^0.18`, which requires `glib ^0.18`;
  `cargo update -p glib --precise 0.20.0` fails on that. It is Linux only (the
  macOS and Windows builds don't contain glib), and neither our code nor
  Tauri's crates call `VariantStrIter` (grep over `crates/` and the Tauri, wry,
  tao, gtk and webkit2gtk sources). It moves when Tauri moves off gtk 0.18.
