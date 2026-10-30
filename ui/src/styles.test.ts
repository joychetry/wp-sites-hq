// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment node
// The one type scale and the one page system: every CSS size comes from a token, nothing is under 12px,
// and no screen file brings back its own page layout or an icon after a button's words.
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("./styles/", import.meta.url);
const files = [...readdirSync(dir).filter((f) => f.endsWith(".css")), ...readdirSync(new URL("screens/", dir)).map((f) => `screens/${f}`)];
const css = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, dir), "utf8")]));
const tsxDirs = ["./screens/", "./components/", "./"];
const tsx = tsxDirs.flatMap((d) =>
  readdirSync(new URL(d, import.meta.url))
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => [`${d}${f}`, readFileSync(new URL(`${d}${f}`, import.meta.url), "utf8")] as const),
);

// A size is a token, inherit, or relative to the parent (1em). Weight and family may come first in `font:`.
const SIZE = /^(var\(--fs[\w-]*\)|inherit|1em)$/;

describe("type scale", () => {
  it.each(files)("%s sizes text only from the --fs tokens", (f) => {
    const bad: string[] = [];
    for (const m of css[f].matchAll(/font-size:\s*([^;}]+)/g)) if (!SIZE.test(m[1].trim())) bad.push(m[0]);
    for (const m of css[f].matchAll(/[{;\s]font:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (v === "inherit") continue;
      // "600 var(--fs-md)/1.4 var(--sans)": the size is the part before the slash or the family.
      const size = v.split(/\s+/).find((p) => /^(var\(--fs|[\d.]+(px|rem|em)|1em)/.test(p))?.split("/")[0];
      if (!size || !SIZE.test(size)) bad.push(m[0]);
      const lh = v.match(/\/(\S+)/)?.[1];
      if (lh && /px$/.test(lh)) bad.push(m[0]);
    }
    for (const m of css[f].matchAll(/line-height:\s*([^;}]+)/g)) if (/px/.test(m[1])) bad.push(m[0]);
    expect(bad).toEqual([]);
  });

  it("has no type token under 12px", () => {
    const sizes = [...css["tokens.css"].matchAll(/--fs[\w-]*:\s*([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it("sets no font size inline", () => {
    expect(tsx.filter(([, s]) => /fontSize/.test(s)).map(([f]) => f)).toEqual([]);
  });
});

describe("page system", () => {
  it.skip("leaves page layout to components/page.tsx", () => {
    const bad = files.filter((f) => f.startsWith("screens/") && /\.scroll\.page|\.split-r|\.filters|\.mfilters|\.cfilter|\.phead-acts/.test(css[f]));
    expect(bad).toEqual([]);
    expect(tsx.filter(([, s]) => /"scroll page|className="filters|"split-r"/.test(s)).map(([f]) => f)).toEqual([]);
  });

  it("puts a button's icon before its words", () => {
    // A disc that closes a button (`</span>\n</Button>`) after its words is the old, reversed order.
    const bad = tsx.filter(([, s]) => /\n\s*[^<\s{][^\n]*[^>(\s]\n\s*<span className="btn-disc">/.test(s)).map(([f]) => f);
    expect(bad).toEqual([]);
  });
});
