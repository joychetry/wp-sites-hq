# Monks Central

Every WordPress site you run, in one app on your computer. Free, open source,
nothing to host.

Updates, plugins, themes, content, people, monitoring, client reports and AI
agents for 3 to 300 WordPress sites, from one desktop app on macOS, Windows and
Linux. No account, no cloud, no per-site price: your sites and their keys stay
on your computer ([privacy](PRIVACY.md)).

Status: 0.1.0 beta, not released yet.

## Install

Download the installer for your computer from the
[releases page](https://github.com/joychetry/monks-central/releases/latest).
The builds aren't code-signed yet, so macOS and Windows warn you the first time;
[the install guide](docs/install.md) shows the one-time steps (macOS Open
Anyway, Windows SmartScreen, Linux AppImage, .deb and .rpm). The app updates
itself from GitHub Releases, and checks each update's signature first.

Your sites need WordPress 7.1 or newer. With the
[Classic Monks](https://classicmonks.com) plugin on a site you get everything;
any other site connects in Basic mode (an application password) with fewer
tools.

Documentation: [docs/site](docs/site) (build it with `mdbook serve docs/site`).

## Build from source

- `crates/core`: store, vault, network, core lock, local socket, sites (OAuth and Basic mode)
- `crates/cli`: the `monks` command (`monks doctor`, `monks core`, `monks status`, `monks run`, `monks mcp`)
- `crates/app`: the desktop app (Tauri 2)
- `ui/`: the app's web UI (React + TypeScript)

```sh
cargo test --workspace
cd ui && npm ci && npm test
cargo run -p monks-cli -- doctor https://example.com
ui/node_modules/.bin/tauri dev   # the app, from the repo root
scripts/bundle.sh                # installers for this computer, in target/release/bundle
```

Linux needs the WebKitGTK 4.1 development packages for the app. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the checks every change passes.

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

## Content and business

- **Content.** Schedule entries, edit custom fields, put an earlier version back,
  bring entries back from the trash, change many entries at once, and publish one
  post on several sites in one job. Ctrl K searches every site's posts and pages,
  plus your sites, plugins, themes and clients.
- **Plugins.** Install a plugin or theme from a zip on your computer (Classic Monks
  2.6 or newer), or a saved bundle of plugins in one go.
- **Clients and costs.** Give sites to clients, track what each site costs you and
  what clients pay, and export or import the whole list (JSON or CSV, never
  passwords).
- **Store.** A WooCommerce site's revenue, orders and low stock, and its products'
  prices and stock, changed as a job (Classic Monks Pro).
- **Reports.** Classic Monks' own reports per site (pages not found, searches,
  unused media, logins, two-factor), and a monthly report per client as HTML and
  PDF in Downloads, with your name, footer and colour, and white label.
- **Search numbers, off by default.** Google Search Console through your own Google
  OAuth client (read-only, kept in the keychain), and AgentedSEO on sites that have
  it. Turn either on in Settings.

## More

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md): report problems privately
- [Privacy](PRIVACY.md)

## Licence

GPL-3.0-or-later. See `LICENSE`. Copyright (C) 2026 Classic Monks.
