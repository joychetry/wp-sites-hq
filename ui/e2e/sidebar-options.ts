// SPDX-License-Identifier: GPL-3.0-or-later
// The three rail palettes tried for light mode (docs/ux/README.md says which won and why).
export const OPTIONS: Record<string, Record<string, string>> = {
  "a-ink": {
    "--bg": "#fbfaf7", "--rail-bg": "#1c1b19", "--rail-raise": "#2e2c29", "--rail-field": "#252421", "--rail-line": "#353330",
    "--rail-line-ui": "#79756d", "--rail-text": "#f2f0eb", "--rail-text-2": "#cbc7be", "--rail-text-3": "#a9a59c",
    "--rail-ok": "#5fcf97", "--rail-warn": "#efb25a", "--rail-danger": "#ff8f84",
  },
  "b-graphite": {
    "--bg": "#f8f8f7", "--rail-bg": "#1e1f20", "--rail-raise": "#303132", "--rail-field": "#27282a", "--rail-line": "#37393b",
    "--rail-line-ui": "#7a7c7f", "--rail-text": "#f0f0ef", "--rail-text-2": "#c7c8c9", "--rail-text-3": "#a4a6a8",
    "--rail-ok": "#5fcf97", "--rail-warn": "#efb25a", "--rail-danger": "#ff8f84",
  },
  "c-umber": {
    "--bg": "#faf6ef", "--rail-bg": "#241d17", "--rail-raise": "#372e26", "--rail-field": "#2c241d", "--rail-line": "#3e342b",
    "--rail-line-ui": "#857868", "--rail-text": "#f5eee4", "--rail-text-2": "#d3c6b6", "--rail-text-3": "#b1a291",
    "--rail-ok": "#62d09a", "--rail-warn": "#f2b45c", "--rail-danger": "#ff9184",
  },
};
