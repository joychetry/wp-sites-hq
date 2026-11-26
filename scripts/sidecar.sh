#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Build the `wpshq` command and put it where Tauri's externalBin expects it
# (crates/app/binaries/wpshq-<target triple>[.exe]). The app crate does not
# build without it, so run this once after a fresh clone, before cargo build.
#
#   scripts/sidecar.sh             debug build, for this computer
#   scripts/sidecar.sh --release   release build (scripts/bundle.sh)
#   TARGET=aarch64-apple-darwin scripts/sidecar.sh --release
#   TARGET=universal-apple-darwin scripts/sidecar.sh --release   (macOS, needs lipo)
#
# A universal Mac build needs three: tauri-build checks each arch's
# (wpshq-aarch64-apple-darwin, wpshq-x86_64-apple-darwin) while cargo builds
# that arch, and the bundler puts wpshq-universal-apple-darwin in the .app.
set -euo pipefail
cd "$(dirname "$0")/.."

triple=${TARGET:-$(rustc -vV | sed -n 's/^host: //p' | tr -d '\r')}
ext=""
[[ $triple == *windows* ]] && ext=".exe"

if [[ ${TARGET:-} == universal-apple-darwin ]]; then
  for arch in aarch64-apple-darwin x86_64-apple-darwin; do
    TARGET=$arch scripts/sidecar.sh "$@"
  done
  lipo -create -output crates/app/binaries/wpshq-universal-apple-darwin \
    crates/app/binaries/wpshq-aarch64-apple-darwin crates/app/binaries/wpshq-x86_64-apple-darwin
  exit
fi

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
cp "$out/wpshq$ext" "crates/app/binaries/wpshq-$triple$ext"
