# Monks Central

Every WordPress site you run, in one app on your computer. Free, open source,
nothing to host.

Status: Phase 0 (foundation). Not ready for use.

- `crates/core`: store, vault, network, core lock, local socket
- `crates/cli`: the `monks` command (`monks doctor`, `monks core`, `monks status`)
- `crates/app`: the desktop app (Tauri 2)
- `ui/`: the app's web UI (React + TypeScript)

## Build

```sh
cargo test --workspace
cd ui && npm ci && npm test
cargo run -p monks-cli -- doctor https://example.com
```

Plans live in `docs/plans/`. Linux notes: `docs/dev-linux.md`.

## Licence

GPL-3.0-or-later. See `LICENSE`.
