#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Build the `monks` command and put it where Tauri's externalBin expects it
# (crates/app/binaries/monks-<target triple>[.exe]). The app crate does not
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
cp "$out/monks$ext" "crates/app/binaries/monks-$triple$ext"
