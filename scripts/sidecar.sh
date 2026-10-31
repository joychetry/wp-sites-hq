#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Build the `wpshq` command and put it where Tauri's externalBin expects it
# (crates/app/binaries/wpshq-<target triple>[.exe]), plus a copy under its
# old name `monks`, shipped until 1.0 for AI app configs that say `monks mcp`
# (the copy prints a one-line note, except for mcp). The app crate does not
# build without it, so run this once after a fresh clone, before cargo build.
#
#   scripts/sidecar.sh             debug build, for this computer
#   scripts/sidecar.sh --release   release build (scripts/bundle.sh)
#   TARGET=aarch64-apple-darwin scripts/sidecar.sh --release
set -euo pipefail
cd "$(dirname "$0")/.."

triple=${TARGET:-$(rustc -vV | sed -n 's/^host: //p' | tr -d '\r')}
ext=""
[[ $triple == *windows* ]] && ext=".exe"

args=(--locked -p monks-cli)
profile=debug
if [[ ${1:-} == --release ]]; then
  args+=(--release)
  profile=release
fi
out=target/$profile
if [[ -n ${TARGET:-} ]]; then
  args+=(--target "$TARGET")
  out=target/$TARGET/$profile
fi

cargo build "${args[@]}"
mkdir -p crates/app/binaries
for name in wpshq monks; do
  cp "$out/wpshq$ext" "crates/app/binaries/$name-$triple$ext"
done
