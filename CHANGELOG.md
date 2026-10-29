# Changelog

All notable changes to Monks Central. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org).

## [0.3.0] - 2026-10-29

A media manager, a full-page post editor like classic WordPress, and three
plugins that can each connect a site.

### Media
- Grid and list views, with type and month filters.
- Upload several files with alt text, live progress and Stop.
- Edit alt text, title, caption and description, with Undo.
- Replace a file, with Undo the replace.
- Trash many items at once, with Undo.
- A media picker for the featured image.

### Post editor
- A full-page editor like classic WordPress: title, slug and body.
- Classic content opens in TinyMCE 7, self-hosted with no cloud, with Visual
  and Text tabs, WordPress's toolbar and Add media.
- Block content stays safe: text blocks are edited in place and builder pages
  are locked.
- Custom fields, and every ACF field type with real controls, including group
  and repeater, with required and validation messages.
- A Publish box with status, visibility, schedule, preview, update and trash.
- Every taxonomy, featured image, excerpt, author, page attributes (parent,
  order, template) and earlier versions.
- A conflict check before saving over a change made on the site, a question
  before leaving with unsaved changes, and Ctrl+S to save.

### Connecting sites
- The Monks Central plugin, Classic Monks Free and Classic Monks Pro can each
  connect a site, and the app shows which plugin runs each site's connector.
- Install Monks Central for me in Basic mode: the app gets the plugin from its
  latest GitHub release and connects through it.
- `sites_list` over MCP names the plugin that connects each site.

### Fixes from the review
- A site's content can't take over the window: links in text blocks are not
  live, fixed content stays inside the editor, and the window only opens the
  app's own pages.
- Agents can't upload, replace or restore files through `agent_call`.
- The media library and picker only show the newest answer, so a slow site's
  items never show under another site.
- An upload the site took never reads as failed, and a bulk trash that fails
  part way keeps its Undo.
- An ACF save checks the fields first and doesn't overwrite a value changed on
  the site; its Undo belongs to that entry only.
- ACF repeater rows keep their editors when moved or removed, and the editor
  can't be typed in while a save is on its way.
- Iframes such as maps and forms are kept as the site has them.
- Preview opens over http for local test sites added over http.
- Screen readers hear when Load more adds items, and focus lands in the right
  place when the editor opens and after a row is removed.

## [0.2.0] - 2026-10-28

A new look on every page, pictures for sites, plugins and themes, and fixes for
Windows, macOS and the release build.

### Design
- Joy's design on every page: a light sidebar, the Figtree typeface, a green
  accent, and new layouts for Sites, Overview, Updates, Plugins and Themes,
  Content, People, Reports, Monitoring, Security, AI, Store and Settings.

### Pictures
- Site favicons, found on each check and kept in the data folder.
- WordPress.org plugin icons and theme screenshots in every tile and report
  row that shows a plugin or theme.

### Fixes
- Windows: the background core no longer holds the output of `monks status`,
  so AI apps that run `monks` over MCP don't hang.
- macOS: the app is now ad-hoc signed, so a downloaded copy shows the normal
  "Apple could not verify" message with Open Anyway in System Settings, not
  "damaged". The `xattr -cr` step stays as a fallback.

### Build
- CI runs on Linux, macOS and Windows.
- The release build writes the updater file once, after every installer is
  uploaded, and makes a normal release, so the in-app updater finds it.

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

[0.3.0]: https://github.com/joychetry/monks-central/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/joychetry/monks-central/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joychetry/monks-central/releases/tag/v0.1.0
