#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Every source file says its licence in its first lines (SPDX, GPL-3.0-or-later).
#   scripts/check-headers.sh         list files without it, fail if any
#   scripts/check-headers.sh --fix   add the line where it is missing
# Migrations (.sql) are left alone: they are the database's history.
set -euo pipefail
cd "$(dirname "$0")/.."

spdx="SPDX-License-Identifier: GPL-3.0-or-later"
missing=0
while IFS= read -r f; do
  head -n 3 "$f" | grep -q "$spdx" && continue
  if [[ ${1:-} != --fix ]]; then
    echo "no licence header: $f"
    missing=1
    continue
  fi
  case $f in
    *.css) line="/* $spdx */" ;;
    *.sh) line="# $spdx" ;;
    *) line="// $spdx" ;;
  esac
  # After a shebang, before everything else.
  if [[ $(head -c 2 "$f") == "#!" ]]; then
    sed -i "1a $line" "$f"
  else
    sed -i "1i $line" "$f"
  fi
done < <(git ls-files 'crates/*.rs' 'ui/*.ts' 'ui/*.tsx' 'ui/*.css' 'scripts/*.sh')
exit $missing
