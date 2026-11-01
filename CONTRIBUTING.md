# Contributing to WP Sites HQ

Thanks for helping. Bug reports, fixes, docs and translations of the docs are
all welcome. For a bigger change, open an issue first so we can agree on the
shape before you spend time on it.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening
an issue.

## The code

| Folder | What |
|---|---|
| `crates/core` | The core (Rust): store, vault, network, the local socket, sites, jobs, monitoring |
| `crates/cli` | The `wpshq` command and `wpshq mcp` |
| `crates/app` | The desktop app (Tauri 2) |
| `ui/` | The app's screens (React + TypeScript) |
| `docs/` | Install guide, UI rules (`docs/ui-rules.md`), docs site (`docs/site`) |

## Set up

You need Rust (stable), Node 24, and on Linux the WebKitGTK 4.1 development
packages (see [docs/dev-linux.md](docs/dev-linux.md)).

```sh
cd ui && npm ci && cd ..
ui/node_modules/.bin/tauri dev     # the app, from the repo root
cargo run -p monks-cli -- doctor https://example.com
```

`MONKS_HOME=/tmp/mc-test` gives the app, the CLI and the tests a data folder of
their own, so your real sites stay out of the way.

The UI also runs in a browser with a stand-in core (no Rust, no sites):
`cd ui && npx vite --mode mock`.

## Before you open a pull request

Run the fast checks for what you touched; they take seconds:

```sh
cargo fmt --all --check
cd ui && npx tsc --noEmit && npx vitest run src/<what you changed>   # types, the tests you touched
bash -n scripts/*.sh && scripts/check-headers.sh   # script syntax; every source file says GPL-3.0-or-later
```

CI (`.github/workflows/ci.yml`) runs the full suites on every pull request:
clippy and `cargo test` (Linux; macOS and Windows nightly), shellcheck and the script
tests, the licence audit, the UI build, every Vitest test and the Playwright
checks (axe, keyboard, zoom). To run them locally too:

```sh
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd ui && npm run build && npm test && npx playwright test
scripts/licence-audit.sh        # needs cargo-deny
```

The core keeps at least 80% test coverage
(`cargo llvm-cov -p monks-core --summary-only`).

## How we write code

- One logical change per commit, with a
  [conventional](https://www.conventionalcommits.org) message:
  `fix(ui): ...`, `feat(core): ...`, `docs: ...`. Tests go in the same commit as
  the code.
- New source files start with `// SPDX-License-Identifier: GPL-3.0-or-later`
  (`scripts/check-headers.sh --fix` adds it).
- Match the code around you: names, comment density, error handling.
- UI copy is plain English: short sentences, every button says what it does,
  no jargon and no em dashes. Read [docs/ui-rules.md](docs/ui-rules.md) before
  touching a screen: base text 15px, WCAG 2.2 AA in both themes, status never
  by colour alone, everything by keyboard, nothing moves under the pointer.
- No new dependency for a few lines of code. Rust dependencies must pass
  `cargo deny check` (no AGPL).
- Never put a secret in code, a test, a log or a screenshot.

## Licence

WP Sites HQ is GPL-3.0-or-later. By sending a contribution you agree that it
is released under the same licence.
