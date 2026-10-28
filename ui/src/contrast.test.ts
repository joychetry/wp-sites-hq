// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment node
// WCAG 2.2 AA over the token pairs the UI actually draws, in both themes:
// 4.5:1 for text, 3:1 for icons, control borders and the focus ring.
// CONTRAST_REPORT=path writes the results as a Markdown table.
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  // Without this a missing block would quietly reuse the first one and check nothing new.
  if (at < 0) throw new Error(`${selector} is not in tokens.css`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const THEMES = { light: block(":root"), dark: { ...block(":root"), ...block('[data-theme="dark"]') } };

function color(vars: Record<string, string>, name: string): string {
  const v = vars[name];
  if (!v) throw new Error(`${name} is not a token`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  return ref ? color(vars, ref[1]) : v;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const UI = 3;
const pairs = (fgs: string[], bgs: string[], min: number) => fgs.flatMap((fg) => bgs.map((bg) => [fg, bg, min] as const));

// Every surface text and controls sit on; the sidebar uses the same tokens as the content.
const SURFACES = ["--bg", "--panel", "--raise", "--sel", "--ground", "--tint-2", "--warn-paper"];
const PAIRS = [
  ...pairs(["--text", "--text-2", "--text-3"], SURFACES, TEXT),
  ...pairs(["--ok", "--warn", "--danger", "--brand-text"], ["--bg", "--panel", "--sel", "--raise", "--ground"], TEXT),
  // Status words on their own tinted grounds.
  ["--ok", "--ok-bg", TEXT],
  ["--warn", "--warn-bg", TEXT],
  ["--danger", "--danger-bg", TEXT],
  ["--text", "--warn-bg", TEXT],
  ["--text", "--danger-bg", TEXT],
  // Filled buttons, the bulk bar, toasts and tooltips.
  ["--on-green", "--green", TEXT],
  ["--on-green", "--green-hover", TEXT],
  ["--btn-on-ink", "--btn-ink", TEXT],
  ["--btn-on-ink", "--btn-ink-hover", TEXT],
  ["--bg", "--text", TEXT],
  // Control borders, the focus ring, green fills (checkbox, switch) and status dots.
  ...pairs(["--line-ui", "--focus", "--accent", "--green"], ["--bg", "--panel", "--raise", "--ground"], UI),
  ...pairs(["--focus", "--accent"], ["--sel", "--tint-2"], UI),
] as const;

const results = Object.entries(THEMES).flatMap(([theme, vars]) =>
  PAIRS.map(([fg, bg, min]) => {
    const r = ratio(color(vars, fg), color(vars, bg));
    return { theme, fg, bg, min, r, ok: r >= min };
  }),
);

test.each(results)("$theme: $fg on $bg is at least $min:1", ({ r, min }) => {
  expect(r).toBeGreaterThanOrEqual(min);
});

afterAll(() => {
  const out = process.env.CONTRAST_REPORT;
  if (!out) return;
  const rows = results.map((x) => `| ${x.theme} | \`${x.fg}\` | \`${x.bg}\` | ${x.r.toFixed(2)} | ${x.min} | ${x.ok ? "pass" : "FAIL"} |`);
  writeFileSync(out, ["| Theme | Foreground | Background | Ratio | Needs | Result |", "|---|---|---|---|---|---|", ...rows, ""].join("\n"));
});
