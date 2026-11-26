#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Dependency audit of the Rust crates: cargo-deny with deny.toml
# (advisories, licences, bans, sources). Needs cargo-deny on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo deny check
