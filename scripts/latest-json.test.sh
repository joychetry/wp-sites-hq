#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Self-test for latest-json.sh on fake .sig files named like v0.1.0's assets.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

for f in WP.Sites.HQ_0.2.0_amd64.AppImage WP.Sites.HQ_0.2.0_amd64.deb \
  WP.Sites.HQ-0.2.0-1.x86_64.rpm WP.Sites.HQ_universal.app.tar.gz \
  WP.Sites.HQ_0.2.0_x64-setup.exe \
  WP.Sites.HQ_0.2.0_x64_en-US.msi; do
  printf 'sig of %s' "$f" > "$tmp/$f.sig"
done
base=https://example.test/download/v0.2.0
out=$("$here/latest-json.sh" "$tmp" 0.2.0 "$base" "Notes")
[ "$(jq -r .version <<<"$out")" = 0.2.0 ] || fail "version"
[ "$(jq '.platforms | length' <<<"$out")" = 11 ] || fail "want 11 platform keys"
[ "$(jq -r '.platforms["linux-x86_64"].url' <<<"$out")" = "$base/WP.Sites.HQ_0.2.0_amd64.AppImage" ] || fail "linux-x86_64 is the AppImage"
[ "$(jq -r '.platforms["windows-x86_64"].url' <<<"$out")" = "$base/WP.Sites.HQ_0.2.0_x64-setup.exe" ] || fail "windows-x86_64 is the setup exe"
for k in darwin-aarch64 darwin-aarch64-app darwin-x86_64 darwin-x86_64-app; do
  [ "$(jq -r ".platforms[\"$k\"].url" <<<"$out")" = "$base/WP.Sites.HQ_universal.app.tar.gz" ] || fail "$k is the universal build"
  [ "$(jq -r ".platforms[\"$k\"].signature" <<<"$out")" = "sig of WP.Sites.HQ_universal.app.tar.gz" ] || fail "$k signature"
done
[ "$(jq -r '.platforms["windows-x86_64-msi"].url' <<<"$out")" = "$base/WP.Sites.HQ_0.2.0_x64_en-US.msi" ] || fail "msi"

rm "$tmp/WP.Sites.HQ_0.2.0_x64_en-US.msi.sig"
"$here/latest-json.sh" "$tmp" 0.2.0 "$base" "Notes" >/dev/null 2>&1 && fail "a missing .sig must fail"
echo "latest-json.sh: all checks passed"

# The release notes in latest.json: one version's CHANGELOG section.
cat > "$tmp/CHANGELOG.md" <<'MD'
# Changelog

## [0.2.0] - 2026-10-28

A new look.

### Fixed
- Windows paths.

## [0.1.0] - 2026-10-27

First release.

[0.2.0]: https://example.test/compare/v0.1.0...v0.2.0
[0.1.0]: https://example.test/releases/tag/v0.1.0
MD
notes=$("$here/changelog-notes.sh" 0.2.0 "$tmp/CHANGELOG.md")
[ "$notes" = $'A new look.\n\n### Fixed\n- Windows paths.' ] || fail "0.2.0 notes: $notes"
[ "$("$here/changelog-notes.sh" 0.1.0 "$tmp/CHANGELOG.md")" = "First release." ] || fail "0.1.0 notes leave out the link lines"
"$here/changelog-notes.sh" 0.3.0 "$tmp/CHANGELOG.md" >/dev/null 2>&1 && fail "a version without a section must fail"
echo "changelog-notes.sh: all checks passed"
