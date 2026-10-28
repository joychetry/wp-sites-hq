# Monks Central

Every WordPress site you run, in one app on your computer. Free, open source,
nothing to host.

Status: Phase 1 (connect sites). Not ready for use.

- `crates/core`: store, vault, network, core lock, local socket, sites (OAuth and Basic mode)
- `crates/cli`: the `monks` command (`monks doctor`, `monks core`, `monks status`, `monks run`, `monks mcp`)
- `crates/app`: the desktop app (Tauri 2)
- `ui/`: the app's web UI (React + TypeScript)

## Build

```sh
cargo test --workspace
cd ui && npm ci && npm test
cargo run -p monks-cli -- doctor https://example.com
ui/node_modules/.bin/tauri dev   # the app, from the repo root
```

Linux needs the WebKitGTK 4.1 development packages for the app.

## AI apps (`monks mcp`)

`monks mcp` is an MCP server on stdio for Claude Code, Claude Desktop, Cursor
and VS Code. It reaches every site through the running app (or starts a core
without a window), always as an agent:

```sh
claude mcp add monks-central -- monks mcp
```

or in an MCP config file: `{"mcpServers": {"monks-central": {"command": "monks", "args": ["mcp"]}}}`.

Five tools: `sites_list`, `site_describe`, `run_ability`, `plan_changes`,
`plan_status`. Agents read every site. A change on one site needs AI agent
access for that site (turned on in the app, under AI) and the site's own
approval. Changes on many sites become a plan that runs only after you
confirm it in the app; no tool can confirm it.

Plans live in `docs/plans/`. Linux notes: `docs/dev-linux.md`.

## Safety and monitoring

- **Safe plugin updates.** With Classic Monks 2.6 or newer on the site, each plugin
  update is checked: the site must work before it, the site checks itself right
  after it in the same request and puts the old version back if the new one fails
  to load, and Monks Central then loads the home page and reads the error log. A
  rolled back update says why in the job.
- **Security.** Once a day each site's WordPress, plugins and themes are looked up
  in [WPVulnerability](https://www.wpvulnerability.net) (free, no key). The same
  answers show plugins WordPress.org closed or nobody released for two years.
  Classic Monks Pro compares files with WordPress.org's checksums.
- **Monitoring.** Every 5 minutes each home page is loaded (up or down, how fast,
  certificate expiry); domains are looked up over RDAP once a day; Google
  PageSpeed runs on request for public sites (no key, so Google's shared daily
  limit applies). Closing the window keeps Monks Central in the tray, still
  checking, with a desktop notice when a site goes down or comes back.

## Licence

GPL-3.0-or-later. See `LICENSE`.
