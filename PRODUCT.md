# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

A desktop app (Tauri 2) whose interface is a React web UI in the system webview: WebKitGTK on Linux,
WKWebView on macOS, WebView2 on Windows. The design language is the app's own, the same on every OS; it is
not a native wrapper that adopts each platform's controls.

## Users

WordPress agencies and freelancers who look after many client sites, from 3 to 300. They open the app at
their desk, often first thing in the day or before a maintenance window, to answer "what needs me today?",
then act on many sites at once: apply updates, fix a broken sign-in, publish or correct content, answer
comments, add a user, check a vulnerability, send a client their monthly report. Most are technical enough
to run WordPress but are not there to read logs; some are solo operators doing every role themselves.

AI agents (Claude, Cursor, VS Code through `wpshq mcp`) are a second, indirect audience: they read and
propose changes, and the person approves them in the app.

## Product Purpose

WP Sites HQ is every WordPress site you run in one app on your computer: updates, plugins, themes,
content, media, users, comments, monitoring, security, clients and costs, client reports and AI agents.
It exists so a person who runs many sites can see the state of all of them in one place and make a change
across them safely, without logging into each wp-admin.

Success is a calm daily check: the person sees at a glance what needs attention, acts on it in a few
confirmed steps, and trusts that nothing changed on a site without their say-so.

## Positioning

Local-first and free: no account, no cloud, no per-site price, no server to host. Sites, sign-ins and data
stay on the person's computer (sign-ins encrypted, key in the system keychain; see PRIVACY.md). Every change
to many sites, and every change an AI agent proposes, is shown as a plan and runs only after the person
confirms it in the app. With the Classic Monks plugin on a site the app gets its full tool set; any other
WordPress 7.1+ site connects in Basic mode with fewer tools.

## Operating Context

- Desktop window, typically 1280 to 1920 wide; the layout keeps working down to 960 and at 200% zoom.
- Long sessions at a desk, scanning tables of sites, plugins and versions; keyboard use is common
  (command palette on Ctrl/Cmd+K, single-key shortcuts such as `a` to add a site).
- Changes that touch live client sites: updates, rollbacks, deletes, trash, publish to many. Each runs
  as a plan the person reviews, then a job with visible progress and an undo where the site allows one.
- Light and dark themes, plus a compact density for big fleets.

## Capabilities and Constraints

- Screens: Overview, Sites (add, sign in again, details), Updates, Plugins and Themes (matrix, install,
  bundles, rollback), Content (editor for block and classic posts, ACF fields, history, bulk, publish to
  many), Media, Users, Comments, Classic Monks (per-site modules, activity, approvals, reports),
  Monitoring, Security, Clients and costs, Store (WooCommerce prices and stock), Reports (PDF), AI
  (plans, agent access, activity, connect an app), Settings, Search everything, command palette.
- WordPress 7.1 or newer on each site. Basic mode sites show fewer tools and say why.
- 0.4.0 beta. macOS, Windows and Linux builds; not yet code-signed.
- Terms the product uses: site, sign in again, Basic mode, plan, job, undo, approval, bundle.

## Brand Commitments

- Name: the brand reads "WP Sites HQ by Classic Monks".
- Voice: plain and calm. Short sentences in everyday words; say what happened and what to do next; no
  jargon, no hype, no blame. No em dashes in copy.
- Binding visual constraints (set by the owner): Figtree as the UI typeface; one green accent; a light
  sidebar; both light and dark themes. The incumbent design system is recorded in
  docs/design/redesign/spec.md and ui/src/styles/tokens.css.
- Buttons put their words first and the icon on the right, except back or previous buttons, which put the
  left arrow first (checked in ui/src/styles.test.ts).
- No native-looking controls: every control is drawn by the app (checked in ui/e2e/native.spec.ts).

## Evidence on Hand

- README.md, PRIVACY.md and docs/site describe the product truthfully; use them as the source for claims.
- Mock fleet data for screens: ui/e2e/mock-core.ts and ui/e2e/screens.ts (fictional sites such as MC A,
  Corner Bakery). It is test data, not customers.
- No testimonials, customer logos, usage numbers or benchmarks exist. Do not invent them.

## Product Principles

1. Nothing changes on a site without the person seeing the plan and saying yes.
2. Show the fleet's state first; the next action sits next to the thing that needs it.
3. Plain words over WordPress internals; explain a limit (Basic mode, not available) where it shows up.
4. Local and private by default; never imply a cloud, an account or tracking.
5. Fast and steady at 300 sites: dense where scanning matters, calm everywhere else.

## Accessibility & Inclusion

- WCAG 2.2 AA throughout: text contrast 4.5:1, control boundaries 3:1, targets at least 24x24 CSS px.
- Visible focus on every control; everything works by keyboard.
- Status never by colour alone: a word or icon goes with every colour.
- Usable at 200% zoom (a 1440x900 window at 200% is a 720x450 viewport).
- prefers-reduced-motion respected.

<!-- Assumptions (init ran from the owner's brief without an interview): the user description, operating
     context and principles are inferred from the brief, README.md and PRIVACY.md. Confirm or correct. -->
