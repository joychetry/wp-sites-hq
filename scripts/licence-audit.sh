#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Licence audit of every dependency (plan D1: no AGPL anywhere).
#   Rust: cargo-deny with deny.toml (licences, advisories, sources).
#   npm:  license-checker over ui/node_modules, allowed licences only.
# Needs cargo-deny on PATH; license-checker runs through npx.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo deny check

allowed="MIT;Apache-2.0;Apache-2.0 OR MIT;MIT-0;ISC;BSD-2-Clause;BSD-3-Clause;MPL-2.0;BlueOak-1.0.0;CC0-1.0"
cd ui
# TinyMCE 8 says "SEE LICENSE IN license.md": GPL-2.0-or-later or Tiny's own terms. We use it under
# the GPL (licence key "gpl"), which can be taken as GPL-3.0, our licence. Check that text, then
# leave it out of the SPDX check.
tiny="tinymce@$(node -p 'require("./node_modules/tinymce/package.json").version')"
grep -q "GNU General Public License Version 2 or later" node_modules/tinymce/license.md \
  || { echo "$tiny: licence no longer offers GPL-2.0-or-later" >&2; exit 1; }
npx --yes license-checker@25.0.1 --excludePrivatePackages --excludePackages "$tiny" --onlyAllow "$allowed" --summary
