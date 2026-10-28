# Changelog

All notable changes to Monks Central. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-10-28

The first public beta. Unsigned installers for macOS, Windows and Linux.

### Sites
- Add a site with Classic Monks (sign in through the browser, OAuth 2.1) or in
  Basic mode (any WordPress 7.1 site, with an application password).
- Groups, tags, notes, clients and costs; health at a glance; one-click login
  to wp-admin as yourself; remove a site and revoke its connection on the site.
- Import and export the site list (JSON or CSV, never passwords).

### Updates, plugins and themes
- Every plugin and theme on every site in one matrix: install from
  WordPress.org, a zip or a saved bundle; turn on or off; delete; auto-updates.
- WordPress, plugin, theme and translation updates per site or in bulk, as a
  plan you review and confirm, with live progress and roll back to a version.
- Safe plugin updates: the site is checked before and after each update and the
  old version comes back by itself if the new one breaks it.

### Content and people
- Posts, pages and every custom post type: list, search, edit with block-safe
  editing, terms, featured image, custom fields, scheduling, earlier versions,
  trash and restore, bulk changes, and publish one post on several sites.
- Media library, users across sites, and one comment inbox for every site.

### Classic Monks
- Features, settings, activity with Undo, approvals and reports for each site.

### Safety and monitoring
- Vulnerabilities (WPVulnerability), closed and abandoned plugins, file
  checksums, uptime, certificate and domain expiry, PageSpeed, and a tray icon
  that keeps watching with the window closed.

### Business
- WooCommerce revenue, orders, low stock and product edits; monthly client
  reports as HTML and PDF with white label; Google Search Console (opt-in).

### AI
- `monks mcp`: one MCP server for every site, for Claude, Cursor and VS Code.
  Agents read every site, change one site only where you allow it and the site
  approves, and plan changes on many sites that run only after you confirm
  them in the app. A plan nobody confirms expires after 7 days.

### App
- Light and dark themes, adjustable text size and row height, a Ctrl K
  palette for every action, full keyboard use, WCAG 2.2 AA.
- Updates itself from GitHub Releases; every update is signed and checked
  before it installs.
- The `monks` command line is installed with the app.

[0.1.0]: https://github.com/joychetry/monks-central/releases/tag/v0.1.0
