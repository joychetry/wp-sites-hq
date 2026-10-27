#!/usr/bin/env bash
# Self-test for test-sites.sh helpers on a temp hosts file. No Studio needed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export TEST_SITES_LIB=1 HOSTS="$tmp/hosts" SUDO=""
# shellcheck source-path=SCRIPTDIR source=test-sites.sh
. "$here/test-sites.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

printf '127.0.0.1 localhost\n# BEGIN WordPress Studio\n127.0.0.1 other.local # Port 8883\n# END WordPress Studio\n' > "$HOSTS"
hosts_add mc-a 8885 >/dev/null
hosts_add mc-a 8885 >/dev/null
[ "$(grep -c 'mc-a.local # Port 8885' "$HOSTS")" = 2 ] || fail "expected one v4 and one v6 line"
sed -n '/BEGIN WordPress Studio/,/END WordPress Studio/p' "$HOSTS" | grep -q '^::1 mc-a.local' || fail "entry outside Studio block"
hosts_remove mc-a >/dev/null
grep -q mc-a "$HOSTS" && fail "entry not removed"
grep -q 'other.local # Port 8883' "$HOSTS" || fail "removed someone else's entry"

printf '127.0.0.1 localhost\n' > "$HOSTS"
hosts_add mc-b 8886 >/dev/null
sed -n '/BEGIN WordPress Studio/,/END WordPress Studio/p' "$HOSTS" | grep -q '^127.0.0.1 mc-b.local # Port 8886' || fail "block not created"

version_ge 7.1 7.1 || fail "7.1 >= 7.1"
version_ge 7.1.3 7.1 || fail "7.1.3 >= 7.1"
version_ge 7.10 7.9 || fail "7.10 >= 7.9"
version_ge 7.0.2 7.1 && fail "7.0.2 < 7.1"
echo "test-sites.sh: all checks passed"
