# Licence audit

Monks Central is GPL-3.0-or-later (plan D2). Every dependency must be
compatible with it, and no AGPL code may be used anywhere (plan D1). Re-run
before each release:

```sh
scripts/licence-audit.sh      # cargo deny check + license-checker on ui/
scripts/check-headers.sh      # every source file carries the SPDX line
```

## Result (2026-10-28, version 0.1.0)

**Rust** (`cargo deny check`, rules in `deny.toml`): advisories ok, bans ok,
licences ok, sources ok. 596 packages; licences found (a crate can have several):

| Licence | Crates |
|---|---|
| MIT | 508 |
| Apache-2.0 | 385 |
| Zlib | 21 |
| Unicode-3.0 | 19 |
| BSD-3-Clause, ISC | 9 each |
| Apache-2.0 WITH LLVM-exception, Unlicense | 6 each |
| MPL-2.0 | 5 (cssparser, selectors, dtoa-short, option-ext) |
| GPL-3.0-or-later | 3 (our own crates) |
| LGPL-2.1-or-later | 2 (r-efi, UEFI only, dual-licensed MIT/Apache) |
| MIT-0, 0BSD, BSL-1.0, CC0-1.0, CDLA-Permissive-2.0 | 1 or 2 each |

**npm** (`license-checker` over `ui/node_modules`, private package excluded):
MIT 86, Apache-2.0 9, MPL-2.0 4, Apache-2.0 OR MIT 3, MIT-0 2, BSD-2-Clause 2,
ISC 2, BSD-3-Clause 2, BlueOak-1.0.0 1, CC0-1.0 1. Only three packages ship in
the app (`react`, `react-dom`, `@tauri-apps/api`); the rest are build and test
tools.

No AGPL, no GPL-2.0-only, no SSPL, no unknown licence. MPL-2.0 is file-level
copyleft and compatible with GPL-3.0; those files are used unmodified.
TinyMCE is GPL-2.0-or-later (self-hosted, under its GPL licence key), which we take as GPL-3.0-or-later.

**Fonts** bundled in the UI (`ui/src/fonts`) are under the SIL Open Font
Licence, which allows bundling with GPL software.

**Source headers:** every Rust, TypeScript, CSS and shell file starts with
`SPDX-License-Identifier: GPL-3.0-or-later` (`scripts/check-headers.sh`, run in
CI). Migrations (`.sql`) are left as they are.
