#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Print latest.json for the in-app updater from a folder holding a release's
# .sig files (named as GitHub stores the assets). The release workflow runs it
# once, after every build, so no two jobs rewrite latest.json at the same time.
#
#   scripts/latest-json.sh <sig dir> <version> <download base url> <notes>
set -euo pipefail
dir=$1 version=$2 base=$3 notes=$4

# Updater platform key and the asset name ending it points to. The plain keys
# get the same build as in v0.1.0: the AppImage on Linux, setup .exe on Windows.
keys=(
  "linux-x86_64 .AppImage"
  "linux-x86_64-appimage .AppImage"
  "linux-x86_64-deb .deb"
  "linux-x86_64-rpm .rpm"
  "darwin-aarch64 _aarch64.app.tar.gz"
  "darwin-aarch64-app _aarch64.app.tar.gz"
  "darwin-x86_64 _x64.app.tar.gz"
  "darwin-x86_64-app _x64.app.tar.gz"
  "windows-x86_64 -setup.exe"
  "windows-x86_64-nsis -setup.exe"
  "windows-x86_64-msi .msi"
)
platforms='{}'
for entry in "${keys[@]}"; do
  read -r key end <<<"$entry"
  sigs=("$dir"/*"$end".sig)
  if [[ ${#sigs[@]} != 1 || ! -f ${sigs[0]} ]]; then
    echo "latest-json: want one *$end.sig in $dir for $key, found: ${sigs[*]}" >&2
    exit 1
  fi
  name=$(basename "${sigs[0]}" .sig)
  platforms=$(jq --arg k "$key" --rawfile s "${sigs[0]}" --arg u "$base/$name" \
    '.[$k] = {signature: $s, url: $u}' <<<"$platforms")
done
jq -n --arg v "$version" --arg n "$notes" --arg d "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson p "$platforms" '{version: $v, notes: $n, pub_date: $d, platforms: $p}'
