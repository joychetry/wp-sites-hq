// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment node
// One word per idea (audit 2, copy table): words the app no longer uses, and no dashes, in any visible string.
import { readdirSync, readFileSync } from "node:fs";

const dirs = ["./screens/", "./components/", "./"];
const files = dirs.flatMap((d) =>
  readdirSync(new URL(d, import.meta.url))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
    .map((f) => [`${d}${f}`, readFileSync(new URL(`${d}${f}`, import.meta.url), "utf8")] as const),
);
// Words a person reads: JSX text, and string and template literals. Comments are dropped first.
const strings = (s: string) => {
  const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return [...code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g), ...code.matchAll(/"([^"\n]*)"|`([^`]*)`|'([^'\n]*)'/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? "")
    // Not words: import paths, and code caught between a > and a < (a comparison, not JSX text).
    .filter((t) => !/^\.{1,2}\//.test(t) && !/&&|\|\||[;=(]/.test(t));
};

const BANNED: [RegExp, string][] = [
  [/\bTick\b|\bticked\b/, "Select / selected"],
  [/\bentries\b/, "the real noun (posts, pages)"],
  [/\bthings\b/, "the real noun (updates)"],
  [/tool groups/i, "plain words"],
  [/\s.*\boperator\b|\boperator\b.*\s/i, "plain words"],
  [/Monks Central/, "WP Sites HQ"],
  [/\bsnippet\b/i, "plain words"],
  [/(^|[^/])wp-admin/, "the dashboard"],
  [/[–—]/, "no dashes"],
  [/Close without (adding|deleting|publishing)/, "Close without saving / changes"],
  [/^Later$/, "Close"],
  [/\bfleet\b/i, "your sites"],
];

describe("copy", () => {
  it.each(BANNED.map(([re, use]) => [String(re), re, use] as const))("never says %s", (_, re, use) => {
    const hits = files.flatMap(([f, s]) => strings(s).filter((t) => re.test(t)).map((t) => `${f}: "${t.trim().slice(0, 80)}" (use ${use})`));
    expect(hits).toEqual([]);
  });
});
