# Changelog

All notable changes to WP Sites HQ. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org).

## [Unreleased]

The app drops the last of its old name.

### What changes
- New app identifier `com.goodmonks.wpsiteshq` (publisher Good Monks). On
  the first start, the app moves its data folder and its keychain key from
  the old identifier; the old key is deleted only after the new one reads
  back. Your sites, sign-ins and history stay.
- The `monks` command is gone: use `wpshq` (`wpshq mcp` for AI apps).
- Linux packages no longer replace the old package name, and the Windows
  installer no longer removes an install under the old name.
- Sites exports say `"wp_sites_hq": 1`; exports from older versions need
  that key renamed before import.
- New logo: the green Q mark and the WP Sites HQ wordmark replace the
  Classic Monks mark in the sidebar, the welcome card and the plugin badge.
  The sidebar no longer says "by Classic Monks". The Classic Monks page keeps
  its own mark.
- New app icon (Windows, macOS, Linux and the tray) and favicons.

## [0.4.1] - 2026-11-10

Fixes from the release test, a Classic Monks page like the plugin's own
dashboard, and search in Ctrl K.

### Search
- Search lives in the Ctrl K (Cmd K on a Mac) palette. The Search
  everything page is gone.
- A plugin, theme, client or post found there opens on its own page.

### Classic Monks
- One Controls view laid out like the plugin's dashboard, following each
  site's own tabs.
- A control shows only while the switch it depends on is on.
- All ten tabs fit at 1440 pixels wide, and messages no longer cover the
  Save bar.
- Changes are logged with the control's name, as plain sentences.

### Every page
- A page that hits an error now says so in the page, with the error text,
  Reload this page and Copy details. The sidebar and top bar keep working,
  and opening another page clears it.
- A lighter background behind the content in the light theme.
- Site and package names sort by number: Shop 2 comes before Shop 10.
- At 200% zoom, tables keep their name column and scroll sideways.
- Buttons are named by their words for screen readers, and tooltips use
  the app's own tip.
- Selected rows stand out in the dark theme.
- AI plans name the AI app that proposed them.

### Pages
- **Sites:** bulk actions count and act on only the selected sites that
  are shown. The site panel's Last check reason wraps.
- **Overview:** Needs attention and the sentence count the same sites as
  the top bar. Vulnerable plugins count plugins, not advisories. See all
  activity opens AI on its Activity tab.
- **Monitoring:** the table fits at 1280 pixels wide, a row's Check again
  checks only that site, more than three down sites show as a count, and
  one down site says when it went down. The page draws when no site is
  down.
- **Content and editor:** every post type shows in the toolbar. Trashed
  posts open read-only, and Save is always in reach.
- **Media:** a replacement waits for your OK before it runs, with Undo.
- **Comments:** approve with a reply, and Undo for spam and trash.
- **Users:** search as you type. An email address without @ is named as
  the problem, at the field.
- **Users and Comments:** more than three sites to sign in again are one
  note.
- **Clients:** deleting a cost asks first.
- **Settings:** Search Console turns on only after Save and connect.

### Sites with a PHP fatal error
- A site that shows a PHP fatal error page counts as down, even when it
  answers with status 200, and the check names the error.
- Such a page never costs a site its saved sign-in.

## [0.4.0] - 2026-10-31

The app is now WP Sites HQ. Same app, same data, new name.

### What stays
- Your sites, saved sign-ins, settings and history. The data folder and the
  keychain entry keep their old names, so you never sign in again because of
  the rename.
- No database change: you can go back to 0.3.2 by installing it.

### What changes
- The app, its windows, tray, installers and messages say WP Sites HQ. The
  publisher is Good Monks.
- The command is `wpshq` (`wpshq mcp` for AI apps). `monks` still works
  until 1.0 and prints a one-line note, except for `monks mcp`.
- Sites see the app as WP Sites HQ (sign-ins, User-Agent `WPSitesHQ`). Log
  rows from before the rename still read as You.
- Install the WP Sites HQ plugin fetches `wp-sites-hq.zip` from the new
  plugin repo. Sites that run the plugin under its old name keep working.
- The app icon stays the same until the new brand art is ready.

### Updating from the old name
- **Mac:** the update keeps the app where it is, so Finder may still call it
  by its old name. The Dock, menu bar and About say WP Sites HQ. Quit
  the app and rename it in Finder if you like; it keeps working either way.
- **Windows:** the update installs WP Sites HQ and removes the old install from
  Apps and the Start menu. If you put the old folder on PATH for
  `monks.exe`, use `%LOCALAPPDATA%\WP Sites HQ` now.
- **Linux:** the `wp-sites-hq` package replaces the old package. The
  AppImage updates in place and keeps its old file name.
- Moving each site's plugin to its new folder: update the old plugin on the
  site to 0.1.4, which offers the move in one click.

## [0.3.2] - 2026-10-30

Every screen looks and works the same way.

### Layout
- One page layout on every screen.
- One type scale across the app.
- Tabs that do not fit fold into a More menu.
- Calmer borders on selects and inputs.
- Search is the same height as the buttons next to it.
- Sites to show moved to the top bar.
- The sidebar footer stays pinned to the bottom.
- The side panel is always shown.

### Buttons and top bar
- Every button puts its words first and its icon on the right.
- The top bar button is now Check all sites.
- Short last-check and attention pills in the top bar.

### Speed and polish
- Pages load ahead of the click.
- Sharper site icons.
- Better column widths and spacing on Sites.

## [0.3.1] - 2026-10-29

The app keeps itself up to date.

### Updates
- The app checks for updates when it starts and every 6 hours, and you can
  also check from the tray.
- An Install updates automatically setting, off by default. It installs only
  when no site work or unsaved edit is open.
- Release notes show in Settings and in the update message.
- Update progress shows while the update downloads.

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
- The app's own plugin, Classic Monks Free and Classic Monks Pro can each
  connect a site, and the app shows which plugin runs each site's connector.
- Install the plugin for me in Basic mode: the app gets the plugin from its
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

[Unreleased]: https://github.com/joychetry/wp-sites-hq/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/joychetry/wp-sites-hq/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/joychetry/wp-sites-hq/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/joychetry/wp-sites-hq/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/joychetry/wp-sites-hq/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/joychetry/wp-sites-hq/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/joychetry/wp-sites-hq/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joychetry/wp-sites-hq/releases/tag/v0.1.0
