#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Build the installers for this computer: the `monks` command goes inside each
# one (next to the app), then Tauri bundles the app.
#
#   scripts/bundle.sh [extra tauri build arguments, e.g. --bundles deb]
#   TARGET=aarch64-apple-darwin scripts/bundle.sh --target aarch64-apple-darwin
#
# Linux: AppImage, .deb and .rpm. macOS: .app and .dmg. Windows: .msi and
# setup .exe. Output: target/release/bundle/. Unsigned (plan D7).
#
# Update files (.sig) are signed only when TAURI_SIGNING_PRIVATE_KEY is set
# (the key itself, or a path to it); without it Tauri builds the installers and
# then refuses to sign. The key never goes in the repo.
set -euo pipefail
cd "$(dirname "$0")/.."

# The release workflow's tauri-action calls "<this script> build <args>".
[[ ${1:-} == build ]] && shift

triple=${TARGET:-$(rustc -vV | sed -n 's/^host: //p')}
ext=""
[[ $triple == *windows* ]] && ext=".exe"

if [[ -n ${TARGET:-} ]]; then
  cargo build --release --locked -p monks-cli --target "$TARGET"
  out=target/$TARGET/release
else
  cargo build --release --locked -p monks-cli
  out=target/release
fi
mkdir -p crates/app/binaries
cp "$out/monks$ext" "crates/app/binaries/monks-$triple$ext"

[[ -d ui/node_modules ]] || (cd ui && npm ci)
# From the repo root: Tauri runs beforeBuildCommand (npm run build) in ui/.
ui/node_modules/.bin/tauri build "$@"
