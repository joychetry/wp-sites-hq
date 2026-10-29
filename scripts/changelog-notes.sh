#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Print one version's section of CHANGELOG.md (without its "## [x.y.z]"
# heading), for latest.json "notes" that the app shows as plain text under
# "What's new". Fails when the version has no section or it is empty.
#
#   scripts/changelog-notes.sh <version> [CHANGELOG.md]
set -euo pipefail
version=$1 file=${2:-CHANGELOG.md}
notes=$(awk -v head="## [$version]" '
  /^## \[/ { on = index($0, head) == 1; next }
  /^\[[^]]+\]: / { next }
  on' "$file" | sed -e '/./,$!d')
if [[ -z $notes ]]; then
  echo "changelog-notes: no section for $version in $file" >&2
  exit 1
fi
printf '%s\n' "$notes"
