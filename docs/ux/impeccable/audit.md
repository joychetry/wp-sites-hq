# WP Sites HQ: Impeccable audit and critique (Phase A, planning)

Date: 2026-10-31. Branch: `feat/impeccable-polish`. Scope: the whole UI (`ui/`), both themes, every screen in
`ui/e2e/screens.ts`. Planning only: no UI code changed in this phase.

## 0. Method and evidence

- **Product context:** `PRODUCT.md` (written in this phase from the owner's brief, README and PRIVACY; the
  assumptions are marked at its foot). Visual authority: `docs/design/redesign/spec.md`, `ui/src/styles/tokens.css`.
- **Screenshots:** 87 screens x light and dark, 1440x900 at deviceScaleFactor 2 (174 files) in
  `/home/joy/Pictures/wp-sites-hq-social/impeccable/before/<screen>-<theme>.png`. Keyboard focus crops (Tab through
  Settings, Sites, Add a site, Add a user, the editor) in `before/states/`. 200% zoom spot checks (720x450 viewport)
  in `before/zoom200/`. Screenshot names below drop the folder.
- **Detector:** `impeccable detect` on the mock URL (`?fixture=fleet|empty|first|error`), on `ui/src`, and on every
  screen state in both themes through Chromium's DevTools port (`detect --cdp`, 174 scans). Raw JSON is kept locally in
  `.impeccable/detect/` (git-excluded).
- **Critique:** Assessment A (design review) ran as an isolated sub-agent that saw no detector output. Assessment B
  (detector and browser evidence) ran in the parent, because the brief had me run the detector before the review;
  the browser overlay was skipped because the per-screen CDP scan covers the same rules. Three more sub-agents
  swept every screenshot for visual defects, each covering about a third of the screens. Their findings were then
  checked against source code and the state crops before going into this report. Items I could not verify are marked.
- **Not covered:** the real Tauri window (WebKitGTK exposes no DevTools port, so the rendered checks ran on Chromium
  against the mock core); hover states beyond what the captures show; screen-reader output; performance timings
  (`ui/e2e/perf.spec.ts` already covers them).

## 1. Scores

### Audit health (technical)

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | Fields at rest have 1.5-1.6:1 borders (WCAG 1.4.11); focus leaves the Add a site dialog at step 2; the selected segment is 1.07:1 against its track |
| 2 | Performance | 3 | No issues seen; the reduced-motion rule turns off every animation, including the running-job spinner |
| 3 | Theming | 2 | Dark `--tint` and `--sel` are both neutral #222, so selected rows, update-ready cells and chosen cards lose their state; 60+ raw radius values |
| 4 | Responsive | 3 | 200% zoom works with no sideways scroll; the rail becomes a full screen of links before any content, and at 1440x900 the nav already scrolls |
| 5 | Implementation integrity | 2 | Same component drawn several ways (selects, search, status pills, disabled buttons, bulk bar); fixed-rule breaches in FilePicker and textareas |
| **Total** | | **12/20** | **Acceptable: the system is sound; the drift is in the details** |

### Design health (Nielsen, from Assessment A, reviewed)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | The job meter is solid green when a change failed or was rolled back (`updates-progress`, `ai-confirmed`) |
| 2 | Match with the real world | 3 | Raw vulnerability-feed titles, "200 OK / LCP / CLS / TBT", a raw agent instruction with a URL in AI activity |
| 3 | User control and freedom | 3 | Undo, rollback and retry-failed are strong; deleting a user hides "can't be undone" in a muted line |
| 4 | Consistency and standards | 2 | Control shapes, six date formats, three bulk-bar behaviours, counts that disagree |
| 5 | Error prevention | 3 | The plan step works; the plan title keeps "5 things" after one is unticked |
| 6 | Recognition rather than recall | 3 | Icon-only row actions in Sites and Users |
| 7 | Flexibility and efficiency | 3 | Palette and single keys; no bulk actions in Comments; Users search needs a button press |
| 8 | Aesthetic and minimalist design | 3 | A permanent "None ticked" ink bar; tall Monitoring rows |
| 9 | Error recovery | 3 | "Nothing was changed" is excellent; raw PHP errors are shown inline |
| 10 | Help and documentation | 3 | Good notes in context; no shortcut sheet |
| **Total** | | **29/40** | **Good** |

**Design specificity:** the workflows are product-specific: the Pick, Review, Run plan with rollback, the plugin x
site matrix, "Kept as is" in the block editor, and "Not in this table" explanations. The chrome around them is
generic, so the polish should bring the chrome up to the workflows' standard rather than add decoration.

**Cognitive load:** 3 of 8 checks fail (visual hierarchy on Overview, minimal choices in Install and comment cards,
working memory across the plan steps). Moderate.

**What works:** the copy ("Close without adding", "Nothing runs until you confirm", "Kept as is"); status always
has a word and an icon; keyboard hints sit where they are used.

## 2. Findings by severity

P0: none. Each finding gives what, where, the evidence (screenshot names), and the fix.

### P1: fix in this PR (WCAG AA, fixed rules, or trust at a high-stakes moment)

1. **Fields at rest fail 3:1 (WCAG 1.4.11).** `.input` uses `--control-line` = `--line-2`: #c7cfca on white is 1.59:1
   (1.49:1 on `--panel`), and #343434 on #141414 is 1.48:1. An empty field is found only by that line.
   `ui/src/styles/tokens.css:99`, `ui/src/styles/base.css:47`. Seen on every form, worst on `media-upload`,
   `add-site-basic`, `users-add`, `cost-add`. Fix: fields at rest use `--line-ui`, the token already defined as the 3:1 control line (3.7:1 on white,
   3.5:1 on `--panel`, 4.1:1 in dark), for inputs, textareas, selects in forms, date, number, tag and colour
   fields; hover goes to `--text-2`. Buttons keep `--line-2` because their label identifies them.
2. **Focus escapes the Add a site dialog at step 2.** After Next, the step's content replaces the focused button,
   focus drops to `<body>`, and Tab walks the skip link, sidebar, top bar and table behind the scrim (verified with a
   Tab probe; the other eight sheets keep focus). `ui/src/components/Sheet.tsx` traps Tab only while focus is inside.
   Fix: set `inert` on the app shell while any sheet, dialog or the palette is open, and move focus to the first
   field when a sheet's step changes. Add the step-2 case to `ui/e2e/a11y.spec.ts`.
3. **The selected segment is not visible as a fill.** `.segmented button[aria-pressed="true"]` (`base.css:355`) is
   `--bg` on a `--panel` track: 1.07:1 in both themes. In dark the chosen button is darker than the track. Only the
   600 weight carries the state. Seen on `overview`, `sites`, `settings`, `reports`, `store`, `cost-add`, `comments`,
   `content`, `media`, `updates`, `install`, `search`, and the sidebar theme switch (`.themes`, `base.css:111`).
   Fix: see the segmented spec in section 4 (selected fill `--bg` plus a 1px `--line-ui` edge in light; `--tint-2`
   #2c2c2c plus a 1px `--line-ui` edge in dark).
4. **Words-first rule broken by raw SVG icons.** `FilePicker` puts the upload icon before the label
   (`ui/src/components/controls.tsx:1062`: "Choose files", "Choose a zip file", "Upload a new image",
   "Import a JSON or CSV file" on `media-upload`, `install`, `install-zip`, `media-picker`, `settings-exported`).
   The month picker puts the calendar first (`controls.tsx:664`, `media`). `ui/src/styles.test.ts:59` only checks
   `<Glyph>`, so these pass. Fix: icon after the words; the month field shows its calendar at the right, where a
   select shows its chevron. Extend the test to inline `<svg>` inside `<button>`.
5. **The job meter reports success when changes failed.** `.jobmeter` is one green bar of finished over total
   (`ui/src/components/JobSheet.tsx:289-303`), and the text above it is `aria-hidden`. On `updates-progress` and
   `ai-confirmed` it is fully green with 1 failed and 1 rolled back. Fix: a segmented meter (done in `--green`,
   rolled back in `--warn`, failed in `--danger`, waiting in `--panel`) with a visible key in words, and the
   progressbar's `aria-valuetext` naming the failures.
6. **Native textarea resize grip (fixed rule: no native-looking controls).** `textarea.input { resize: vertical }`
   (`base.css:48`) and `.rte textarea.rte-source` (`ui/src/styles/screens/editor.css:107`) show the browser grip on
   `client-edit`, `comments-reply`, `content-acf`, `content-classic-text`, `publish-many`, `install-bundle-edit`.
   Fix: draw the grip with `::-webkit-resizer` (WebKitGTK, WKWebView and WebView2 all support it) as two 1px
   diagonal lines in `--line-ui`, inside the 10px corner.
7. **Store change may drop the sale-price removal from the review (needs investigation, not a style fix).**
   `store-change` shows Sale price empty while the table shows a sale; the summary says "no sale price, stock 30",
   but `store-confirm` lists only "stock 30". Check `ui/src/screens/Store.tsx` before the polish lands; if the
   review is right, the edit form is wrong.

### P2: fix in this PR (visible inconsistency, a workaround exists)

Controls and states
1. **Three focus looks stacked.** The global `:focus-visible` outline (`base.css:9`) adds to the field ring
   (`controls.css:25`) and the button ring (`controls.css:26`): inputs get a green border, a 3px halo and a 2px
   outline (`states/settings-*-21-*`, `comments-reply`, `content-show-list`); buttons get outline plus halo
   (`states/*-btn*`). The slider's outline is a sharp rectangle around the whole range (`states/settings-*-13-*`).
   The palette draws a framed field inside its framed search row (`palette`). Fix: one look per family (section 4).
2. **Disabled buttons read as enabled.** `button:disabled { opacity: .55 }` (`base.css:8`) turns the dark primary
   into a darker green; in light the disc stays green and the Enter key still shows (`add-site`, `add-site-basic`,
   `cost-calendar`, `settings-search-console`, `content-editor`, `content-builder`, `users-delete` where the
   disabled danger button is pale pink with white text). Fix: section 4 disabled spec.
3. **Dark `--tint` collapses into `--sel`.** Both are #222 (`tokens.css:122-123`), so ticked rows (`content-bulk`,
   `media-list`), update-ready matrix cells (1.1:1 against active cells, patched by a dark-only arrow in
   `ui/src/styles/screens/matrix.css:33`), the chosen rollback version (`plugins-rollback`), the soft "Use
   shop-front" button and the history selection all lose their state. Success callouts turn grey too (`sites`).
   Fix: a dark green-tinted `--tint` (#16261e) and `--tint-2` (#1d3328): `--text` 13.5:1, `--ok` 6.8:1,
   `--text-3` 5.5:1 / 4.7:1 on them; `--sel` stays neutral. The tint restores the hue; the state itself is
   still carried by a word, tick or icon, as now.
4. **Hover wins over the ticked row.** `.t tbody tr:hover td` (`base.css:177`) out-specifies `.t tr.sel td`
   (`base.css:178`), so a ticked row under the pointer looks unticked (`content-bulk`). Fix: `.t tbody tr.sel td`,
   and a hover that darkens the selected tint instead of replacing it.
5. **The header checkbox never shows "some ticked"** on Content and Media (`Content.tsx:299`, `Media.tsx:593` use
   plain `checked`; Sites, Updates and JobSheet use `aria-checked="mixed"`). Seen on `content-bulk`, `media-list`.
6. **The bulk bar has three behaviours.** Content and Media show a permanent ink bar reading "None ticked"
   (`Content.tsx:278`, `Media.tsx:567`; `content`, `media`, `media-replaced`); Sites shows it only when ticked
   (`sites-selected`); its group picker has no chevron and commits only on Enter (`Sites.tsx:402`). Fix: the bar
   appears only when something is ticked, in one position; the group picker is a Select with an Apply button.
7. **A site tile inside a select sits high and touches the text.** `<SiteTile size="sm">` inside an option
   (`ui/src/screens/Store.tsx:134` and the Classic Monks and Add a user pickers); only `.pick .select-v .fav` is
   sized (`ui/src/styles/screens/content.css:7-8`). Seen on `store`, `store-change`, `classic-monks*`, `users-add`,
   `cost-add`; in dark it shows a white frame. Fix: size and gap the tile on `.select-v .fav` and `.lb li .fav`
   everywhere, not only under `.pick`.
8. **Search fields are 32px beside 36px controls** on `content` (`Content.tsx:445`) and `classic-monks`
   (`ClassicMonks.tsx:315`); the Search everything field is a 48px rectangle with a 12px radius
   (`ui/src/styles/screens/search.css:5`, `search`). Fix: toolbar searches at `--control`; the one large query
   field at `--control-lg` (44px), pill.
9. **Underline tabs get a rounded grey box on hover and shift on select.** `.tabs [role=tab]` has
   `border-radius: 8px 8px 0 0` and a hover fill (`controls.css:159-160`); the 600 weight widens the label so the
   tabs to the right move 3-6px (`classic-monks-settings`, `ai-access`). Fix: no fill, no radius, text colour on
   hover; reserve the bold width with a hidden bold copy of the label.
10. **Switch off state is faint.** A 12px grey dot on a grey track (`controls.css:57-58`; `settings`, `classic-monks`).
    It passes 3:1 but reads as disabled. Fix: section 4 switch spec.
11. **Matrix legend swatches look like unticked checkboxes** (14px squares with a border, `matrix.css:38`;
    `plugins`, `themes`) and are five near-identical greys in dark. Fix: each swatch shows the cell's own glyph
    and fill at 12px, round-cornered like the cell.
12. **11.67px text.** A bare `<small>` inherits the browser's "smaller" (detector `tiny-text`,
    `content-classic`, `content-classic-text`). Fix: `small { font-size: var(--fs-sm); }` in `base.css`.
13. **Skipped heading level.** `<h1>` page title then `<h3 class="mx-label">Not in this table</h3>`
    (`ui/src/screens/Matrix.tsx:371`; detector `skipped-heading` on `plugins*`, `themes`, `install*`). Fix: `<h2>`.
14. **The editor's inline toolbar covers the field label above it.** The TinyMCE inline toolbar overlaps
    "Paragraph" and the bottom of the Heading field (`content-block-text`; detector `text-occlusion`). The text
    colour swatch bar is black and vanishes in dark (`content-classic`, `content-new`). TinyMCE icons are heavier
    than the app's line icons and the toolbar wraps with room to spare. Fix: place the inline toolbar above the
    label row (offset by the label's height), recolour `.tox-tbtn__select-chevron` and the colour bar to
    `currentColor`, set `toolbar_mode: 'sliding'` and a 1.5 stroke icon pack override where TinyMCE allows it.
15. **Block fields are drawn darker than every other field.** `.blk-text` and `.rte` use `--line-ui`
    (`editor.css:95`, `:130`) while neighbours use `--line-2`, so they look focused (`content-editor`,
    `content-trashed`). Resolved by P1.1: every field uses `--line-ui`.
16. **Number stepper and date button shapes.** Round 36px stepper buttons beside a 32px rectangular field
    (`controls.css:124`; `content-history` "Order"); the calendar button is an 8px square between 10px fields
    (`content-editor`); the colour swatch is 8px and 33px tall beside a 10px 36px hex field (`settings`). Fix: the
    radius table (field-attached buttons take the field's radius and height).

Layout and states
17. **Scrolled content ends in a hard cut 24px above the window.** `.body` has bottom padding outside the scroller
    (`base.css:127`, `.page` scrolls), so cards end flat on a grey strip (`overview`, `settings`, `clients`,
    `security`, `monitoring`, `comments`, `content-editor`, `content-acf` and more). Fix: move the bottom padding
    inside the scroller (`.page::after` spacer or `padding-bottom` on `.page`/`.page-main`) so the last card ends
    with its own margin.
18. **The sidebar scrolls at 1440x900.** Reports, AI (with "1 plan to confirm") and Settings sit below the fold;
    on `settings`, `reports`, `settings-exported` a cut item peeks under the brand. At 200% the rail is a full
    screen before the content (`zoom200/sites-light-zoom200.png`). Fix: tighten `.navgroup` padding (14px to 8px
    top) and move the "Next check" note out of `.rail .foot` into the status pill's tooltip, which frees about
    90px; under 900px wide, collapse the rail to a "Menu" button that opens the nav as a sheet.
19. **Loading and error states contradict the chrome.** `error` says the app couldn't start while the top bar
    says "Checked just now · 3 need attention" and the description says "One site is down"; `loading` shows
    "All sites (0)" and some sidebar counts. Fix: hide status pills, counts and the generated description until data
    loads or when the core is down; shape the skeleton like the screen it stands in for.
20. **Counts disagree.** Top bar and sidebar say 3 need attention; the Needs attention card says 6 (`overview`).
    Security says "2 on 1 site" then "on 3 sites" (`security`). The plan title keeps "Update 5 things" after one is
    unticked (`updates-confirm`). Plugins inspector lists two sites update-ready but offers "on 1 site"
    (`plugins-inspector`). Fix: one source per count; the plan title follows the ticks.
21. **Calendar popover runs past the sheet edge** (`cost-calendar`, ends at 1432 vs the sheet's 1428). Fix: the
    Popover flips and shifts to stay inside the nearest dialog, 8px from its edge.
22. **Settings segmented tracks run wider than their options** (`settings`, `.settings .segmented` at
    `base.css:455` is `inline-flex` but stretches in the card grid); a 55px gap after "Which sites" on `reports`.
23. **Status shapes split in two:** `.st.pill` (Figtree pill with icon) for health, `.tag` (mono, 6px, no icon)
    for stock, severity, plan state and "update ready" (`store`, `security`, `monitoring`, `ai`, `themes`,
    `plugins-inspector`). Fix: every state uses `.st.pill` (icon plus word); `.tag` stays for neutral labels
    (versions, slugs, "Kept as is").
24. **Dates in six formats and two clocks** ("Today, 10:55 PM", "26 Oct 2026", "Oct 28, 09:30", "Dec 31, 2026",
    "2026-10-27 15:42:00", "2026-09-28 to 2026-10-28"). Fix: one formatter module (`ui/src/format.ts`) with
    `day()`, `dayTime()`, `range()` and `ago()`, 24-hour or 12-hour by the OS locale, used by every screen.
25. **Raw machine text in the UI:** the agent instruction with a URL in AI activity (`ai-activity`), "on 3 sites on
    several sites" (same row), raw PHP errors in job rows (`updates-progress`), raw vulnerability-feed titles
    (`security`, `updates`). Fix: plain summaries with the raw text behind "Show the details".
26. **Empty states have no single shape.** Five variants across `overview-empty`, `clients-empty`,
    `monitoring-empty`, `security-empty` (the monitor icon on Security), `classic-monks-basic`, `ai-none`,
    `content-unavailable` (a dead end with no button). Fix: one `<Empty>` pattern (picture in a tinted disc, a
    title without a full stop, one line, one primary action), each with its own picture.
27. **Four "Add a site" buttons** (`overview`, `overview-empty`, `sites`, `monitoring-empty`). Fix: one primary
    "Add a site" with the plus disc and the A key everywhere it appears.

### P3: polish (fix if the PR has room; listed briefly)

- Addresses break at hyphens in the inspector and toasts (`sites-sign-in-again`, `settings-exported`): use
  `overflow-wrap: anywhere` only on paths in mono, with `hyphens: none`, or truncate with a tooltip.
- Seven wordings for closing without changes; pick two ("Close without saving" for edits, "Close" for views).
- `text-wrap: pretty` on paragraphs and `balance` on headings (detector stragglers on `overview`, `ai-connect`,
  `updates-plan`, `error`, `content-history`).
- Uppercase mono column heads turn "mc-c" into "MC-C" (`plugins`, `themes`, `publish-many-plan`): keep site names
  in their own case inside heads.
- Straight quotes in titles ("Autumn opening hours", `content-trash`): use curly quotes.
- Site tiles stay saturated in dark (`sites-selected`), against the spec's "site tiles go neutral".
- Rows alternate grey in job progress (`updates-progress`) for no reason; the failed row is the least boxed.
- Placeholders that read as values ("120.00" in `cost-add`, a disabled "09:00" in `content-new`, `publish-many`).
- `scrollbar` and toasts: the toast covers fields near the bottom right (`media-replaced`); keep it clear of the
  page's 32px edge.
- Reduced motion turns off the running-job spinner; keep a non-moving "running" glyph instead of hiding motion
  that carries state.

### Detector findings judged false positive or intended

- `side-tab` on `.t tr.focus td:first-child` (row cursor, not a card accent), on `.indent` and `.prose blockquote`
  (quote rule): kept.
- `nested-cards` on `.drop`, `.rte.visual`, `.acf-group`, `.acf-row`, `.rep-page`: fields and previews inside
  cards, intended. The radius table gives them the nested radius so they read as contents, not cards.
- `border-accent-on-rounded` on `.rpreview > div` (the report preview's accent band): intended; the radius table
  changes how it is drawn.
- `low-contrast` on `span.fav.sm` in `content-unavailable`: real (a monogram tile on ink), fixed by P2.7.
- Mock-data artefacts, not UI bugs: identical "now 10.3.0" on several job rows, "Update plugin" labels (they come
  from `i.label`), "v0.0.1" against "0.1.0".

## 3. Radius system

### The rule

**You press pills, you type in boxes, things sit on cards, small squares scale.**

- **Press or filter = pill.** Buttons, chips, segmented controls, status pills, count badges, search fields, and
  any select that filters a view (top bar, toolbars, bulk bar). Icon-only buttons are circles. This keeps the
  redesign's signature and makes an action recognisable by shape.
- **A value you edit = box, 10px.** Text inputs, textareas, selects in forms, date, time, number, tag and colour
  fields. A button attached to a field (calendar, steppers, remove-a-row, colour swatch) takes the field's
  radius and height, so the pair reads as one control.
- **Surfaces nest down.** Card, side panel, popover, menu and toast 14; sheet, dialog and palette 18; anything inside
  a card (callout, well, note, choice card, list row, thumbnail, drop zone) 10; inline marks (tag, kbd, code,
  calendar day, tooltip) 6; text highlights and paper previews 4. An item inside a padded container uses the
  container radius minus the padding (popover 14 with 4px padding gives items 10; palette 18 with 8px gives 10).
- **Small squares scale.** Tiles, favicons, plugin tiles, product thumbs, legend keys and checkboxes use
  `border-radius: 27%` (44px gets 12, 36 gets 10, 30 gets 8, 24 gets 6.5, 18 gets 5): one value instead of nine.
- **Bars are fully round.** Progress, job meter, update-mix and distribution segments, slider track, skeleton lines,
  scrollbar thumbs.
- **No radius where edges meet.** Underline tabs, table cells, and the bulk bar inside the table card (it takes the
  card's bottom corners).

### Tokens after the change (`ui/src/styles/tokens.css`)

| Token | Value | Notes |
|---|---|---|
| `--radius-xs` | 4px | new: highlights, paper previews |
| `--radius-sm` | 6px | inline marks, tooltip, calendar day, editor toolbar buttons |
| `--radius` | 10px | fields and everything nested in a card |
| `--radius-lg` | 14px | cards and floating surfaces |
| `--radius-xl` | 18px | sheets, dialogs, palette |
| `--radius-pill` | 999px | press, filter, bars |
| `--radius-tile` | 27% | new: small squares |
| `--radius-control` | removed | was a context alias for pill; bars now use `--radius-pill` directly |

A new check in `ui/src/styles.test.ts`: every `border-radius` in `ui/src/styles/**` is a `--radius-*` token, `50%`
or `0`. Raw px values today: 71.

### Decision table

| Component family | Current radius | Decision | Reason |
|---|---|---|---|
| Buttons (`.btn`, all kinds and sizes) | pill | **Keep** pill | The brand's action shape; one shape for every action |
| Icon-only buttons (`.icon-btn`, `.sheet-x`, row actions, toast close) | 8px | **Change** to circle | Pressable = round; matches `.srch` clear, tag remove and theme buttons, which are already circles |
| Primary disc (`.btn-disc`) | 50% | Keep | |
| Chips, filter chip (`.chip`), quiet pills (`.pchip`, `.term`) | pill | Keep | Filters press like buttons |
| Segmented track and buttons | pill | Keep | |
| Status pill (`.st.pill`), count badges (`.navitem .n`, `.cm-n`, `.ai .tabs .cnt`) | pill, 10px on 20px | **Change** badges to `--radius-pill` | Same look today, one token |
| Search (`.srch .input`, `.kbar`) | pill; Search everything 12px | **Change** the Search everything field to pill at 44px | A search is a filter everywhere |
| Text input, textarea (`.input`) | 10px | Keep 10px | The field shape |
| Select in forms (`.input.select`) | 10px | Keep 10px | It holds a value |
| Select in a bar (top bar scope, toolbar, bulk bar) | pill | Keep pill | It filters the view or applies an action |
| Date, time, number, tag, colour fields | 10px | Keep 10px | |
| Field-attached buttons (`.dt .dt-cal`, `.num-in .icon-btn`, `.fields .icon-btn.line`, `.swatch`) | 8px, 50%, 10px, 8px | **Change** to 10px and the field's height; pill only inside a bar | The field and its button are one unit |
| Checkbox (`input[type=checkbox]`, `.box::before`, `.lb .mbox`) | 5px | **Change** to `--radius-tile` (about 5px) | Same look, one rule for small squares |
| Radio | 50% | Keep | |
| Switch track | 10px on 20px | **Change** to `--radius-pill` | Same look, one token |
| Slider track and thumb | 2px track, 50% thumb | **Change** track to pill | Bars are round |
| Tabs (`.tabs [role=tab]`, `.tab-more`) | 8px 8px 0 0 with a hover fill | **Remove** radius and fill | Underline tabs meet the line; the box fought the underline |
| Nav items (`.navitem`) | 8px | **Change** to 10px | A list row; one nested value |
| Cards, stat cards, side panel, table card, empty card | 14px | Keep 14px | |
| Popover, listbox, menu, calendar (`.pop`) | 12px | **Change** to 14px | Floating surfaces share the card radius |
| Listbox and menu items (`.lb li`) | 8px | **Change** to 10px | 14 minus the 4px padding |
| Toast | 12px | **Change** to 14px | A floating surface; the toast is too tall for a pill when it wraps |
| Tooltip (`.tip`) | 8px | **Change** to 6px | A small inline label, not a surface |
| Sheet, dialog, palette | 18px | Keep 18px | |
| Palette rows (`.pal-row`) | 10px | Keep | 18 minus the 8px list padding |
| Callouts, alerts, notes, wells (`.callout`, `.alert`, `.notes li`, `.dl.well`, `.site-notes li`, `.upd-notes`, `.comments .reply`) | 10 and 12px | **Change** all to 10px | Nested inside a card |
| Choice cards (`.choice`, `.radios.cards label`, `.mx-vers label`, `.ins-found`, `.ins-bundles li`) | 12px | **Change** to 10px | Nested inside a sheet |
| Drop zone (`.drop`) | 14px | **Change** to 10px | Nested, never a card of its own |
| Job progress rows, AI diff, connect code, ACF groups, vlist rows, media queue | 10px | Keep | |
| Editor fields (`.rte`, `.blk-text`) | 10px | Keep | Fields |
| Matrix cells (`.mx .cell`) | 8px | **Change** to 10px | Nested boxes |
| Image thumbnails (`.media img`, `.mthumb`, `.featured`, `.mpreview`) | 10px; 8px and 6px when small | Keep 10px; **change** thumbs under 64px to 6px | Photos don't scale like tiles |
| Tiles (`.tile`, `.fav`, `.ptile`, `.pthumb`, all sizes) and the favicon image inside | 5, 6, 8, 10px | **Change** to `--radius-tile` | One rule replaces nine values |
| Avatars, discs, step numbers, pulse dots | 50% | Keep | |
| Kbd, tag, inline code, block level (`.kbd`, `.tag`, `.ai-diff code`, `.blk-level`) | 6px, 5px | **Change** all to 6px | Inline marks |
| Code block in prose (`.prose pre`) | 6px | **Change** to 10px | A nested block |
| Search highlight (`mark`) | 3px | **Change** to 4px | |
| Bars: progress, job meter, mix, seg, skeleton, scrollbar thumb, legend dots | 2 to 8px | **Change** to pill; legend keys to circles | Bars are round |
| Report and settings previews (`.rep-page`, `.rpreview > div`) | 6px with a 3px top border | **Change** to 4px; draw the accent as an inset shadow | Paper; the band follows the corner instead of clipping it |
| Bulk bar inside the table card (`.sites .selbar`) | 0 0 14 14 | Keep | Shares the card's corners |
| TinyMCE (toolbar buttons, menus, dialog, fields, buttons) | 6, 10, 14, 10, pill | Toolbar buttons keep 6px (split buttons need straight joins); **change** menus and the floating toolbar to 14px | The editor is an exception for grouped buttons only |

## 4. Control spec

Two heights only, as today: `--control` 36px and `--control-sm` 32px, plus `--control-lg` 44px for the one large
field on a page (the editor title and the Search everything query). Every control in a row shares one height.

### Focus (all controls)

- Fields (input, textarea, select in forms, date, number, tag, colour, rich-text frame): border `--focus`,
  `box-shadow: var(--ring)` (3px, 22% green), **no outline**. The ring is the field's focus.
- Everything else: `outline: 2px solid var(--focus); outline-offset: 2px`, **no ring**. The outline follows the
  element's radius.
- Inside dark fills (primary button, bulk bar, toast): outline in `--btn-on-ink` or `currentColor`.
- Palette: the search row shows focus as its bottom border in `--focus`; the input inside draws no frame.
- Slider: the thumb carries the focus outline, not the whole range.

### Buttons

| Property | Value |
|---|---|
| Height | 36 (sm 32) |
| Padding | 0 16 (sm 0 12); with a trailing disc, right padding 5 (sm 4) |
| Radius | pill |
| Type | 14/500 (sm 13/500), Figtree |
| Icon | 15px glyph (sm 14), after the words; the back arrow comes first |
| Disc | 26px circle (sm 22), `--green` in light, 18% white in dark |
| Gap | 8 (sm 6) |
| Border | 1px `--line-2` (default kind); none on ghost, soft and primary |
| Kinds | default (outline), primary (ink in light, green in dark), soft (tint), ghost, danger (outline, danger text), danger solid |
| Hover | default: `--panel` fill and `--line-ui` border; primary: `--btn-ink-hover` / `--green-hover`; ghost: `--panel` |
| Active | 1px down, and the hover colour one step darker |
| Focus | outline only (see Focus) |
| Disabled | `opacity: .45`, `cursor: not-allowed`, disc drawn in `--line-2` with the icon in `--text-3`, the key hint hidden; primary in dark loses its green (fill `--raise`, text `--text-3`) so it never looks ready |
| Busy | width kept, the icon swaps for a spinning refresh glyph (a static glyph under reduced motion), `aria-busy` |

### Text inputs and textareas

| Property | Value |
|---|---|
| Height | 36 (sm 32; large 44); textarea min 72, grows with content up to 240, then scrolls |
| Padding | 0 12; textarea 10 12 |
| Radius | 10 |
| Border | 1px `--line-ui` (3:1 or better on every surface), `--field-shadow` inset |
| Placeholder | `--text-3`; never a realistic value (use "e.g. 120.00") |
| Hover | border `--text-2` |
| Focus | border `--focus` and the ring |
| Invalid | border `--danger`, an error line under it with an icon and words, `aria-invalid` |
| Disabled | fill `--panel`, border `--line-2`, text `--text-3`, no shadow, `cursor: not-allowed`; an empty disabled field shows "Not set" in `--text-3`, never a value-like placeholder |
| Resize grip | drawn with `::-webkit-resizer` in `--line-ui`, never the OS grip |

### Selects

| Property | Value |
|---|---|
| Box | same as text inputs (height, padding, radius, border, shadow) in forms; pill and `--line-2` border in bars |
| Value | 14/400 (the 500 weight goes), ellipsis; a site tile 20px with 8px gap, centred |
| Chevron | 16px, `--text-2`, 1.8 stroke, at the right; turns 180° when open |
| Hover | border `--text-2` in forms, `--line-ui` in bars (no fill change; matches inputs) |
| Open | border `--focus` and the ring |
| Listbox | popover radius 14, padding 4, `--shadow-pop`; item min-height 36, padding 0 10, radius 10; active `--panel`; chosen = tick + 600 + `--brand-text`; disabled `--text-3`, `not-allowed`; group label mono 12 uppercase |
| Disabled | as text inputs |

### Checkbox and radio

| Property | Value |
|---|---|
| Size | 18px drawn inside a 24px target |
| Radius | checkbox `--radius-tile` (about 5px); radio 50% |
| Border | 1.5px `--line-ui` (3.7:1 light, 4.1:1 dark) |
| Hover | border `--text-2`, a 4px `--panel` halo |
| Checked | fill and border `--green`, white tick (radio: green ring, white inner gap, green dot) |
| Mixed | green fill, white dash, `aria-checked="mixed"` (also on Content and Media headers) |
| Focus | outline 2px offset 2px, following the radius |
| Disabled | dashed border, `opacity: .5`, `not-allowed` |
| Label | 14/400 beside the box, 8px gap, the whole label row is the target |

### Switch

| Property | Value |
|---|---|
| Track | 36 x 20, pill |
| Thumb | 16px circle, 2px inset |
| Off | track `--panel`, 1px `--line-ui` border, thumb `--bg` with a 1px `--line-ui` edge and `--shadow-sm` (a white knob, not a grey dot) |
| On | track `--green`, thumb white, at the right |
| Hover | border `--text-2` (off), `--green-hover` (on) |
| Focus | outline 2px offset 2px |
| Disabled | `opacity: .5`, `not-allowed` |
| Motion | thumb slides 150ms `--ease`; none under reduced motion |

### Segmented control

| Property | Value |
|---|---|
| Track | 36 high, pill, `--panel`, 1px `--line`, 3px padding; as wide as its options, never stretched |
| Option | 28 high, pill, 0 14 padding, 14/500 `--text-2`; count in mono 12 |
| Selected | light: `--bg` fill, 1px `--line-ui` edge, `--shadow-soft`, 600 `--text`; dark: `--tint-2` fill, 1px `--line-ui` edge, 600 `--text` (at least 3:1 between the selected edge and the track) |
| Hover | `--text` |
| Focus | outline 2px offset 2px on the option |

### Tabs

Underline tabs, 42 high, 0 12 padding, 14/500 `--text-2`, no radius, no hover fill (hover = `--text`); selected =
600 `--brand-text` and a 2px `--green` underline; the bold width reserved so nothing shifts; count in mono 12.

### Chips and pills

- Filter chip: 36 high, pill, 1px `--line-2` (dashed `--line-ui` when it adds a filter, as in the spec), 13/500;
  on = `--green` border, `--sel` fill.
- Status pill: 24 high, pill, icon 12px plus word, 13/600, on the state's tinted ground; used for every state.
- Tag: mono 12, 6px radius, `--panel`; neutral labels only (versions, slugs, "Kept as is").
- Count badge: 20 high, min 22 wide, pill, mono 12/600.

### Menus, tooltips, toasts

- Menu: as the listbox; danger items in `--danger` with their icon; separators 1px `--line` with 4px margin.
- Tooltip: 6px radius, `--text` on `--bg` inverted, 13/400, max 320, 6 10 padding, 400ms delay, follows the
  pointer side, never covers its own trigger.
- Toast: 14px radius, ink, min 48 high, icon in the state colour plus words, at most two actions, clear of the
  page's 32px edge and of an open sheet.

### Tables

Head 40 high, mono 12 uppercase on `--panel` (site names keep their case); rows `--row` (48, compact 36); hover
`--panel`; ticked `--sel` (hover darkens it, never replaces it); the open row adds the 3px green cursor; group rows
`--panel` across every cell including the tick column.

## 5. Fix plan: one PR, small commits, in this order

Each commit builds, passes `npm test` and `npx playwright test` (a11y, native, overflow) on its own. Screens are
re-shot into `/home/joy/Pictures/wp-sites-hq-social/impeccable/after/` at the end.

1. **`style(tokens): radius scale, large control, dark tint`**: add `--radius-xs`, `--radius-tile`,
   `--control-lg`; dark `--tint`/`--tint-2` green-tinted; drop `--radius-control`.
   `contrast.test.ts` gains field line 3:1 and selected-segment checks. (P1.1, P1.3, P2.3)
2. **`style: one radius system`**: apply the decision table across `base.css`, `controls.css` and
   `styles/screens/*.css`; add the radius guard to `styles.test.ts`. (Section 3, P2.16)
3. **`fix(controls): one focus look per family`**: fields ring only, the rest outline only; palette, slider and
   dark-fill variants. (P2.1)
4. **`fix(controls): fields`**: `--line-ui` on every field at rest, select hover and weight, `small` size, drawn resize
   grip, value-like placeholders, site tile in select values and options, toolbar search heights, the large
   search pill. (P1.1, P1.6, P2.7, P2.8, P2.12)
5. **`fix(controls): words first for FilePicker and the month field`**, with the `styles.test.ts` check for inline
   SVG. (P1.4)
6. **`fix(controls): states`**: disabled buttons, switch knob, segmented selection, tabs without a hover box or
   shift, checkbox mixed on Content and Media, table hover over ticked rows, matrix legend. (P1.3, P2.2, P2.4, P2.5,
   P2.9, P2.10, P2.11)
7. **`fix(sheets): keep focus in dialogs`**: `inert` shell while a sheet, dialog or palette is open; focus on step
   change; the e2e case for Add a site step 2; Popover collision inside dialogs. (P1.2, P2.21)
8. **`fix(jobs): honest progress`**: segmented meter with a key, `aria-valuetext`, plan title from the ticks, raw
   errors behind "Show the details". (P1.5, P2.20 partly, P2.25 partly)
9. **`fix(layout): page ends, sidebar room, bulk bar`**: bottom padding inside the scroller, rail density and the
   "Next check" note in the status tooltip, the bulk bar only when ticked with an Apply for groups, settings
   segmented width, Reports spacing. (P2.6, P2.17, P2.18, P2.22)
10. **`fix(editor): TinyMCE fits the app`**: inline toolbar placement, colour bar and chevrons in `currentColor`,
    sliding toolbar, icon weight. (P2.14, P2.15)
11. **`fix(states): loading, error and empty`**: chrome hidden when there is no data, a skeleton per screen, one
    empty-state pattern with a next step each, one "Add a site" button. (P2.19, P2.26, P2.27)
12. **`fix(ui): status pills and headings`**: `.st.pill` for every state, `<h2>` for "Not in this table". (P2.13, P2.23)
13. **`fix(copy): dates, counts and plain words`**: `ui/src/format.ts` used everywhere, one source per count, plain
    summaries for agent and vulnerability text, close-button wording, curly quotes, `text-wrap`. Copy that changes
    meaning is listed in the PR for Joy to approve before merge. (P2.20, P2.24, P2.25, P3)
14. **`test(e2e): after screenshots`**: re-shoot every screen in both themes, 200% zoom and 960px sets; compare
    with `before/`.

Before commit 1: investigate P1.7 (Store sale price in the review), since it may be a data bug rather than polish.

Out of scope for this PR (raise separately): Overview leading with "what changed since yesterday", one "Check
everything" in place of four refresh buttons, a per-site matrix view for 40+ sites, bulk actions in Comments.
