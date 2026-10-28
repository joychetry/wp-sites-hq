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
npx --yes license-checker@25.0.1 --excludePrivatePackages --onlyAllow "$allowed" --summary
