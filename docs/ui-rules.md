# UI rules

The bar every screen in WP Sites HQ meets. The app is for site owners who
aren't technical, so it has to be easy to read: a light sidebar and white cards
on a soft green-grey ground, one green for the main action and the current page,
Figtree with Outfit headings and mono uppercase labels.

A screen is done when it meets every rule below and `npm test` and `npm run e2e` pass in `ui/`.

## 1. Type

- Three families, bundled in `ui/src/fonts` with their OFL licences: Figtree (`--sans`, body and
  controls), Outfit (`--display`, page titles, stat numbers, sheet titles) and JetBrains Mono (`--mono`).
- Seven sizes, all tokens in `ui/src/styles/tokens.css`, in `rem` so the OS and browser text size
  scale them: `--fs-xs` 12px (labels, meta, keys, counts), `--fs-sm` 13px (details, small buttons,
  versions), `--fs` 14px (body, buttons, nav), `--fs-md` 15px (card titles, the page description),
  `--fs-lg` 20px (sheet and section titles), `--fs-xl` 28px (page title, empty states),
  `--fs-stat` 36px (stat numbers). No other size, and nothing under 12px.
- Body at 14px with a 1.45 line height (`--lh`).
- Tabular figures for counts and versions (`.num`, table cells, counts).
- Mono (`--mono`) for versions, code-like strings (addresses), times in the Latest changes feed,
  and the uppercase spaced labels (`.label`, column heads, nav groups, `--label-track`). Never for
  prose or buttons.

## 2. Spacing and density

- Every padding, margin and gap comes from the 4px scale: `--sp-1` 4 … `--sp-7` 48.
- Rows are comfortable by default (`--row` 48px). Settings > Row height > Compact sets
  `data-density="compact"` (36px rows, 16px gutters) and is remembered on this computer
  (`mc-density` in local storage). Every table must work in both.
- Cards (`--radius-lg` 14px, 20px padding, `--pad`) sit 16px apart on the ground; the page head
  (title, one line of description, the page's main action) sits above them. Buttons are pills
  (`--control` 36px, small 30px); text boxes are `--field` 40px (small 34px).

## 3. Colour and contrast (WCAG 2.2 AA, both themes)

- Text 4.5:1 on every surface it sits on, including muted text (`--text-3`), placeholders,
  and status words. Large text 3:1.
- Icons, control borders (`--line-ui`) and the focus ring (`--focus`) 3:1. Hairlines
  (`--line`, `--line-2`) are decoration only; never let one be the only sign of a control.
- Status colours (`--ok`, `--warn`, `--danger`) reach 4.5:1 on content surfaces and on their own
  tinted backgrounds. Version cells coloured amber or red (Updates, Plugins) use these tokens.
- The green: light uses `#01824C` (`--green`, `--focus`, `--accent`) and `#016B3F` for green words
  (`--brand-text`, `--ok`); dark fills the main action with `#01824C` under white text and uses
  `#3DBF82` for the focus ring, dots and on states. White on either green fill passes 4.5:1.
- `ui/src/contrast.test.ts` checks every pair (142 of them) across `--bg`, `--panel`, `--raise`,
  `--sel`, `--ground`, `--tint-2` and `--warn-paper`. A new token or surface means a new pair in that test.

### Status is never colour alone

Every status has a shape and a word (`<Status>` in `components/ui.tsx`): tick = Healthy,
warning sign = Needs a look / Sign in again / No tools yet, cross = Down, empty ring = Not checked,
"i" = a note (Slow). Later screens follow the same rule: a word next to every coloured cell
("Update", "Risk", "Off"), and symbols explained in words in the legend (for example
"dot = not installed", "struck through = installed but inactive" in the Plugins matrix).
A slow site (over 3 s) is a note on a healthy site, never a warning. The Overview stat bars
(`.mix`) are pictures with a written label (`role="img"`) and a key with every count in words.

## 4. Light theme: a light sidebar

In light mode the
sidebar is white (`--bg`) with a hairline edge, beside the `--ground` content area; in dark mode it
is `#141414` beside the `#0b0b0b` ground. The sidebar uses the content tokens in both themes, so the
`--rail-*` tokens and the rail mapping are gone. The current page is never shown by colour alone:
a `--sel` background, bolder words (green in light), a green icon and `aria-current="page"`. Counts sit in small
badges; the Overview badge for sites that need you is red with the number written out.

## 5. Clarity

- Every table has a one-line legend or column help (`.legend`, `.help`), tied to the table with
  `aria-describedby`. Column names are spelled out ("WordPress", "Last checked", not "WP").
- Every number says what it counts ("Sites down", "5 sites on 7.1.3", "Changes waiting for
  approval on sites").
- Missing values are words: "not known", "none". No "?" or bare dashes.
- Empty, loading and error states say what happened in plain words and offer the next step
  (Add a site, Try again, Clear the filters, Go to Sites).
- Truncated names carry a tooltip with the full text.
- No jargon in the UI: say **connection** (not grant), **permission** or **access** (not scope),
  **tool** (not ability), never "DCR" or "operator" except where we quote the site's own consent
  page. Plain copy, no em dashes, every button says what it does.
- A Classic Monks connection with no tools says so plainly on Sites and Overview: "Connected, but
  this connection can't do anything yet. Sign in again and tick the tool groups." with a Sign in
  again button.

## 6. Accessibility

- A visible 2px focus ring on everything focusable (`:focus-visible`, `--focus`); inputs never set
  `outline: none`.
- A skip link ("Skip to content") is the first Tab stop. Tab order follows the page: sidebar, top bar,
  page head, filters, table, inspector. Dialogs (sheet, palette) keep focus inside and give it back on close.
- Every control works from the keyboard; the Sites grid keeps J/K/X/slash/R/A and is a read-only
  `role="grid"` so the focused row is announced. Icon-only buttons have an `aria-label`.
- A `<select>` wrapped in its `<label>` also gets `aria-label`: Chromium otherwise reads the
  options into its name ("SiteMC ACorner Bakery...").
- Progress and notices sit in live regions (`role="status"`) that exist before they change.
- Hit targets at least 24px (checkboxes and tag remove buttons included); buttons and nav items
  are 30-36px.
- `prefers-reduced-motion` stops all animation. Under 900px wide (a 1440px window at 200% zoom)
  the layout becomes one column with the sidebar on top, nothing cut off; wide tables scroll inside
  their own box, and the Overview's Your sites table wraps instead.

## 6a. Controls

No control draws in the OS look. Use the kit, never a native widget:

| Need | Use | Pattern |
|---|---|---|
| Pick one of a list | `Select` (`components/controls.tsx`), takes `<option>`/`<optgroup>` children like `<select>` | select-only combobox + listbox; arrows, Home/End, Page keys, typeahead, Enter/Space/Tab choose, Esc closes |
| Text with suggestions | `Combobox` (replaces `<input list>` + `<datalist>`) | combobox with list autocomplete |
| Several from a long list | `MultiSelect` (Clients > Their sites) | combobox + multi-select listbox, chips with remove buttons |
| Date, date and time, month | `DateInput type="date" / "datetime-local" / "month"`, native value formats | typed date ("1 Dec 2026") + calendar dialog (grid: arrows a day/week, Page keys a month); time box takes "9:30", arrows step it |
| Number | `NumberInput` | spinbutton with minus and plus |
| Filter or search | `SearchInput` | searchbox, Esc and a clear button empty it |
| Tags | `TagInput` | chips + combobox; Enter or comma adds, Backspace removes |
| Colour | `ColorInput` | swatch + hex box checked as you type + preset swatches dialog |
| File | `FilePicker` | a button and a drop area; the native input is `display: none` |
| On/off that acts at once | `<input type="checkbox" role="switch">` | drawn switch |
| On/off in a form | `<input type="checkbox">`, choose-one `<input type="radio">` | drawn box and dot (`styles/controls.css`) |
| A range | `Slider` (Settings > Text size) | drawn range with the value in words |
| More actions | `Menu` | menu button; arrows, Enter, Esc gives focus back |
| Parts of one screen | `Tabs` | tablist, one Tab stop, arrows choose |
| Done, with a way back | `toast(text, { undo })` + `<Toaster />` | live region; Undo where the site can reverse it; errors and Undo stay until closed or you go to another screen, plain ones go after 5 s; closing a focused one gives focus back to the sheet or the content |
| Full name of something cut short | `data-tip="..."` (never `title`) | custom tooltip on hover and keyboard focus, tied with `aria-describedby`, Esc hides. On text that can't take focus (a cut-off name in a cell), the tip is for the mouse; the full text stays in the page for screen readers and in the inspector or editor for the keyboard |
| Loading | `<Skeleton label="Reading ..." />` | `role="status"` with the words for screen readers |
| Nothing here | `<Empty>` or `.empty` with a heading and the next step | |

States: every control has hover, focus (2px ring), pressed, disabled (`not-allowed`, dashed or faded) and
error (`aria-invalid`, red border and a sentence in `.err` tied with `aria-describedby`). Inline
validation runs when you leave a box, never while you type the first characters.

Nothing moves under the pointer (ui-review, 2026-10-28): the result of an action, a check in progress or a
failed action never appears as a line above a list, table or set of controls. It is a toast (bottom right,
bottom left while a sheet is open), so a quick second click lands on the row it was aimed at. A refresh after
an action keeps the rows on screen (no loading placeholder in their place), and when the row you acted on
leaves, keyboard focus goes on to the row that takes its place. Bars that come with a selection
are always there (disabled when nothing is ticked) or sit under the table, stuck to the bottom (Sites). An
inline error that appears when you leave a box has its line reserved. Errors inline are only for a form's
own fields, or in place of content that didn't load. `e2e/a11y.spec.ts` "results never move the rows"
checks this, and `e2e/perf.spec.ts` keeps every list free of long freezes with 300 sites
(`?fixture=fleet300`).

Motion: `--dur` 150ms and `--ease` on colour, border and shadow; sheets slide in, popovers and the
palette scale in, toasts rise. `prefers-reduced-motion` turns all of it off.

Layout: up to 1300px wide the sidebar is 216px and the inspector 288px, bars wrap; under 900px the existing
one-column layout takes over.

## 7. How it is checked

In `ui/`:

- `npm test`: Vitest, including `contrast.test.ts` (every token pair in both themes).
  `CONTRAST_REPORT=<file> npx vitest run src/contrast.test.ts` writes the table.
- `npm run e2e`: Playwright against a build that swaps the core for `e2e/mock-core.ts` (fake sites,
  no secrets). `e2e/a11y.spec.ts` runs axe (WCAG 2.0-2.2 A/AA and best practice; serious and
  critical fail) on every screen in `e2e/screens.ts`, in both themes and both row heights, plus
  keyboard, focus, 200% zoom and browser text size checks.
- `e2e/native.spec.ts`: no native-looking control or `title` tooltip on any screen.
- Screenshots: `SHOTS=<folder> npx playwright test shots` writes every screen in both themes to
  `ui/screenshots/<folder>/` (not committed).

A new screen adds itself to `e2e/screens.ts`, so it gets axe and screenshots for free.
